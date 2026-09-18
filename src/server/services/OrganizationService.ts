import crypto from 'crypto';
import { organizationRepository, Organization } from '../database/OrganizationRepository';
import { redisService } from './RedisService';
import logger from '../utils/logger';

const CACHE_PREFIX = 'org:user:';
const CACHE_TTL = 300; // 5 minutes

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export class OrganizationService {
  async findById(id: string): Promise<Organization | null> {
    return organizationRepository.findById(id);
  }

  async findBySlug(slug: string): Promise<Organization | null> {
    return organizationRepository.findBySlug(slug);
  }

  async findByUserId(userId: string): Promise<Organization | null> {
    // Check Redis cache first
    const cached = await redisService.get(`${CACHE_PREFIX}${userId}`);
    if (cached) {
      try {
        return JSON.parse(cached) as Organization;
      } catch {
        // Fall through to DB
      }
    }

    const org = await organizationRepository.findByUserId(userId);
    if (org) {
      redisService.set(`${CACHE_PREFIX}${userId}`, JSON.stringify(org), CACHE_TTL).catch(() => {});
    }
    return org;
  }

  async resolveDbName(userId: string): Promise<string | null> {
    const org = await this.findByUserId(userId);
    if (!org || !org.isActive || !org.isProvisioned) return null;
    return org.dbName;
  }

  async createOrganization(
    name: string,
    ownerUserId: string,
    stripeCustomerId?: string,
    options?: { awaitingPayment?: boolean },
  ): Promise<Organization> {
    const id = crypto.randomUUID();
    const slug = slugify(name) || `org-${id.slice(0, 8)}`;
    const dbName = `pmassist_t_${slug.replace(/-/g, '_')}`;

    // Check slug uniqueness — append random suffix if taken
    const existing = await organizationRepository.findBySlug(slug);
    const finalSlug = existing ? `${slug}-${id.slice(0, 6)}` : slug;
    const finalDbName = existing ? `pmassist_t_${finalSlug.replace(/-/g, '_')}` : dbName;

    const org = await organizationRepository.create({
      id,
      name,
      slug: finalSlug,
      dbName: finalDbName,
      ownerUserId,
      stripeCustomerId: stripeCustomerId || null,
      stripeSubscriptionId: null,
      stripeSubscriptionItemId: null,
      subscriptionTier: 'trial',
      // An org created for a paid signup is awaiting payment, not on trial. A trial
      // belongs to the free tier only, so it gets no trial date.
      subscriptionStatus: options?.awaitingPayment ? 'incomplete' : 'trialing',
      billingModel: 'flat',
      seatCount: 1,
      seatPriceCents: 3300,
      trialEndsAt: options?.awaitingPayment
        ? null
        : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' '),
      maxUsers: 10,
      viewerLimit: 5,
      isActive: true,
      isProvisioned: false,
    });

    logger.info('Organization created', { orgId: id, slug: finalSlug, dbName: finalDbName });
    return org;
  }

  async markProvisioned(orgId: string): Promise<void> {
    await organizationRepository.update(orgId, { isProvisioned: true });
  }

  async getAllActiveProvisioned(): Promise<Organization[]> {
    return organizationRepository.findAllActiveProvisioned();
  }

  async getAllActive(): Promise<Organization[]> {
    return organizationRepository.findAllActive();
  }

  async countUsers(orgId: string): Promise<number> {
    return organizationRepository.countUsers(orgId);
  }

  invalidateUserCache(userId: string): void {
    redisService.del(`${CACHE_PREFIX}${userId}`).catch(() => {});
  }
}

export const organizationService = new OrganizationService();
