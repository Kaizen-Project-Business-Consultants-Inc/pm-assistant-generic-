import crypto from 'crypto';
import { config } from '../config';
import { userService, type User } from './UserService';
import { stripeService } from './StripeService';
import { organizationService } from './OrganizationService';
import { inviteService } from './InviteService';
import { pricingConfigService } from './PricingConfigService';
import { organizationRepository } from '../database/OrganizationRepository';
import { inviteTokenRepository } from '../database/InviteTokenRepository';
import { databaseService } from '../database/connection';
import { provisionTenantDatabase } from '../database/tenantProvisioner';
import { runWithTenantContext } from '../middleware/requestContext';
import { resolvePriceId } from '../utils/stripePrices';
import logger from '../utils/logger';
import { isDatabaseUnavailable, BUSY_MESSAGE } from '../utils/serviceBusy';

interface NewAccount {
  email: string;
  fullName: string;
  /** '' for an account that signs in with Google only (no password matches an empty hash) */
  passwordHash: string;
  /** true when the email is already confirmed (Google said so) */
  emailVerified: boolean;
  username?: string;
  organizationName?: string;
  inviteToken?: string;
  tier?: 'consultant_basic' | 'consultant_pro' | 'sme' | 'enterprise';
  plan?: 'monthly' | 'annual';
  seats?: number;
}

type Failure = { ok: false; status: number; error: string; message: string };
type NewAccountResult =
  | Failure
  | {
      ok: true;
      user: User;
      /** Joined a company through its invitation (a viewer, no trial) */
      invitedTo: string | null;
      /** Chose a paid plan: awaiting payment at this checkout address */
      checkoutUrl: string | null;
      /** null when the email was already confirmed */
      verificationToken: string | null;
    };

const fail = (status: number, error: string, message = error): Failure => ({ ok: false, status, error, message });

/** People sign in with their email, so the username is made from it — at most 47 characters, and a
 *  fresh suffix if taken, so nobody is refused over a field they never saw */
async function usernameFor(email: string): Promise<string> {
  const base = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40) || 'user';
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = `${base}_${crypto.randomBytes(3).toString('hex')}`;
    // eslint-disable-next-line no-await-in-loop -- at most three tries, each depends on the last
    if (!(await userService.findByUsername(candidate))) return candidate;
  }
  return `${base}_${crypto.randomBytes(6).toString('hex')}`;
}

/** Fire-and-forget: link any pending project memberships + People records with this email to the new user */
function linkPendingMemberships(userId: string, email: string, fullName: string): void {
  organizationService.getAllActiveProvisioned().then(async (orgs: any[]) => {
    for (const org of orgs) {
      try {
        // eslint-disable-next-line no-await-in-loop -- one company at a time: each switches the tenant database (fire-and-forget after signup)
        await runWithTenantContext(org.dbName, org.id, async () => {
          await databaseService.query(
            'UPDATE project_members SET user_id = ?, user_name = ? WHERE LOWER(email) = LOWER(?) AND user_id LIKE ?',
            [userId, fullName || email.split('@')[0], email, 'pending_%'],
          );
          await databaseService.query(
            'UPDATE resources SET user_id = ? WHERE LOWER(email) = LOWER(?) AND user_id IS NULL',
            [userId, email],
          );
        });
      } catch {
        // Ignore errors for individual tenants
      }
    }
  }).catch((err: any) => logger.error('Failed to link pending memberships/resources', { userId, error: err }));
}

/** Their own company (free trial or awaiting payment — SME checkout needs the company first). The
 *  company database is built once the email is confirmed (provisionVerifiedTenant). */
async function createOrgForNewUser(user: User, input: NewAccount, stripeCustomerId: string | null, awaitingPayment: boolean, trialEndsAt?: Date) {
  if (!config.MULTI_TENANT_ENABLED) return;
  const orgName = input.organizationName || input.fullName || input.email.split('@')[0];
  try {
    const org = await organizationService.createOrganization(orgName, user.id, stripeCustomerId || undefined, { awaitingPayment, trialEndsAt });
    await userService.update(user.id, { organizationId: org.id } as any);
  } catch (orgError) {
    // Database busy: the whole sign-up stops (and is undone) — an account with no company is a dead end
    if (isDatabaseUnavailable(orgError)) throw orgError;
    logger.error('Organization creation failed during registration', { userId: user.id, error: orgError });
  }
}

/**
 * The database was too busy to finish a sign-up: remove what was made (the account, and its company
 * if one was started — even when making it reported a failure after the row was written — and
 * reopen an invitation it had already used), so the
 * person can simply try again rather than find "an account with this email already exists" with no
 * company behind it. Best effort: logged loudly if the database refuses even that (2026-10-12).
 */
async function undoNewAccount(userId: string): Promise<void> {
  try {
    await organizationRepository.deleteUnbuiltOwnedBy(userId);
    await inviteTokenRepository.reopenAcceptedBy(userId); // an invitation it used works again for the retry
    await userService.delete(userId);
    logger.warn('Sign-up stopped (database busy) and undone', { userId });
  } catch (err) {
    logger.error('Sign-up stopped (database busy) and could NOT be undone — half-made account', {
      userId, message: err instanceof Error ? err.message : String(err),
    });
  }
}

/** The Stripe checkout for a paid sign-up (SME pays per seat on the company) */
async function checkoutFor(user: User, input: NewAccount, stripeCustomerId: string): Promise<string | Failure> {
  const priceId = resolvePriceId(input.tier!, input.plan || 'monthly');
  if (!priceId) return fail(500, 'Stripe not configured', 'Pricing is not configured for this tier');
  if (input.tier !== 'sme') {
    // Flat-rate checkout for consultant tiers
    return stripeService.createCheckoutSession(stripeCustomerId, priceId, user.id, '/onboarding');
  }
  const org = await organizationRepository.findByUserId(user.id);
  if (!org) return fail(500, 'Organization not found', 'SME signup requires an organization');
  let orgStripeCustomerId = org.stripeCustomerId;
  if (!orgStripeCustomerId) {
    orgStripeCustomerId = await stripeService.createCustomer(input.email, org.name, user.id);
    if (orgStripeCustomerId) await organizationRepository.update(org.id, { stripeCustomerId: orgStripeCustomerId });
  }
  if (!orgStripeCustomerId) return fail(500, 'Failed to create Stripe customer for organization');
  return stripeService.createSeatCheckoutSession(orgStripeCustomerId, priceId, Math.max(3, input.seats || 3), org.id);
}

/**
 * Create a Kovarti account the way sign-up always has — used by the sign-up form and by
 * "Sign up with Google" (2026-10-12), so both follow the same rules:
 * - a username is made from the email (people sign in with their email);
 * - an invitation makes them a viewer in the inviting company (no trial);
 * - an address that had an account before gets no second trial;
 * - a paid plan waits for payment (no trial) and gets its checkout;
 * - otherwise the free trial (the trial plan's length) with their own company;
 * - pending project memberships and People records with this email are linked to them.
 * The company database is built once the email is confirmed (provisionVerifiedTenant).
 */
export async function createAccount(input: NewAccount): Promise<NewAccountResult> {
  const { email, fullName, passwordHash, emailVerified, inviteToken, tier } = input;
  const username = input.username || await usernameFor(email);

  let inviteData: { valid: boolean; email?: string; orgName?: string; projectId?: string | null } | null = null;
  if (inviteToken) {
    inviteData = await inviteService.validateToken(inviteToken);
    if (!inviteData.valid) return fail(400, 'Invalid invite', 'This invitation link is invalid or has expired.');
  }
  if (await userService.findByUsername(username)) return fail(409, 'User already exists', 'Username is already taken');
  if (await userService.findByEmail(email)) return fail(409, 'Email already exists', 'An account with this email already exists');

  // An address that had an account before gets no second trial
  const [previousAccount] = await databaseService.query<{ email: string }>(
    'SELECT email FROM deleted_emails WHERE email = ? LIMIT 1',
    [email.toLowerCase()],
  );

  const verificationToken = emailVerified ? null : crypto.randomUUID();
  const isInvitedViewer = !!inviteData?.valid;
  const isPlanSignup = !!tier && !isInvitedViewer;

  // Stripe customer (if configured) — not for invited viewers
  const stripeCustomerId = isInvitedViewer ? null : await stripeService.createCustomer(email, fullName || email, 'pending');

  const user = await userService.create({
    username,
    email,
    passwordHash,
    fullName,
    role: isInvitedViewer ? 'viewer' : 'project_manager',
    emailVerified,
    emailVerificationToken: verificationToken ?? undefined,
    emailVerificationExpires: verificationToken ? new Date(Date.now() + 24 * 60 * 60 * 1000) : undefined,
    stripeCustomerId: stripeCustomerId || undefined,
  });
  // Everything after the account row exists: if the database gets too busy part-way, undo it all
  // and say "busy, try again" (the same for the sign-up form and Google)
  let undone = false;
  const finished = await (async (): Promise<{ checkoutUrl: string | null } | { failure: Failure }> => {
    if (isInvitedViewer) {
      // Viewer: no trial, no subscription, accept the invite
      await userService.update(user.id, { subscriptionStatus: 'none' });
      try {
        await inviteService.acceptInvite(inviteToken!, user.id);
      } catch (inviteErr) {
        if (isDatabaseUnavailable(inviteErr)) throw inviteErr; // stop and undo: a viewer with no company is a dead end
        logger.error('Failed to accept invite during registration', { userId: user.id, error: inviteErr });
      }
    } else if (previousAccount) {
      // Returning user: no free trial — must pick a paid plan
      await userService.update(user.id, { subscriptionStatus: 'none' });
    } else if (isPlanSignup) {
      // Paid signup: NO TRIAL. They sit in 'incomplete' (awaiting payment) with no trial date and no
      // feature access until payment confirms. subscriptionTier stays 'trial' (the "no paid plan" default,
      // since that column grants features); the plan being bought is remembered in pendingTier.
      await userService.update(user.id, {
        subscriptionStatus: 'incomplete',
        pendingTier: tier as any,
        trialEndsAt: null,
        trialStartedAt: null,
      });
      await createOrgForNewUser(user, input, stripeCustomerId, true);
    } else {
      // Free signup: the trial plan's "Duration (days)" setting (Admin → Pricing), 7 unless set
      const now = new Date();
      const trialEndsAt = new Date(now.getTime() + (await pricingConfigService.trialLengthDays()) * 24 * 60 * 60 * 1000);
      await userService.update(user.id, { subscriptionStatus: 'trialing', trialStartedAt: now, trialEndsAt });
      await createOrgForNewUser(user, input, stripeCustomerId, false, trialEndsAt);
    }

    let checkoutUrl: string | null = null;
    if (isPlanSignup && stripeCustomerId) {
      const checkout = await checkoutFor(user, input, stripeCustomerId);
      if (typeof checkout !== 'string') return { failure: checkout };
      checkoutUrl = checkout;
    }
    return { checkoutUrl };
  })().catch(async (err: unknown) => {
    if (!isDatabaseUnavailable(err)) throw err;
    await undoNewAccount(user.id);
    undone = true;
    return { failure: fail(503, 'Service busy', BUSY_MESSAGE) };
  });
  // The account stays unless the sign-up was undone (busy): link pending project memberships +
  // People records with this email to it
  if (!undone) linkPendingMemberships(user.id, email, fullName);
  if ('failure' in finished) return finished.failure;
  const { checkoutUrl } = finished;

  return { ok: true, user, invitedTo: isInvitedViewer ? (inviteData!.orgName ?? null) : null, checkoutUrl, verificationToken };
}

async function createOwnerResource(orgId: string, dbName: string, ownerId: string) {
  try {
    const owner = await userService.findById(ownerId);
    if (!owner) return;
    await runWithTenantContext(dbName, orgId, async () => {
      const { resourceService } = await import('./ResourceService');
      await resourceService.createResource({
        name: owner.fullName || owner.username || owner.email.split('@')[0],
        role: owner.role,
        email: owner.email,
        capacityHoursPerWeek: 40,
        skills: [],
        isActive: true,
        costRateHourly: null,
        overtimeRateHourly: null,
        resourceGroup: null,
        userId: ownerId,
        calendarTemplateId: null,
      });
    });
    logger.info('Created owner resource', { orgId, userId: ownerId });
  } catch (err) {
    logger.error('Failed to create owner resource', {
      orgId, userId: ownerId, error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * A tenant database is only built once the person has verified their email.
 *
 * It used to be built during registration. That made an unverified signup cost
 * 104 tables and 12MB on disk, before anyone had proved the address was real —
 * so a script could fill the disk in about eleven hours at the registration
 * rate limit, and every junk signup left a database behind forever. Five of the
 * first six accounts on production were never verified and each had one.
 *
 * Nothing is lost by waiting: an unverified user cannot log in at all, so there
 * is nothing for them to use the database for. And if anything ever does reach a
 * tenant that was never provisioned, tenantResolver repairs it on the spot.
 */
export async function provisionVerifiedTenant(orgId: string, dbName: string, ownerId: string): Promise<void> {
  try {
    await provisionTenantDatabase(orgId);
    await createOwnerResource(orgId, dbName, ownerId);
  } catch (err) {
    // Never fatal: the person has verified and must be allowed to sign in.
    // tenantResolver will provision on their first request if this failed.
    logger.error('Deferred tenant provisioning failed', {
      orgId, message: err instanceof Error ? err.message : String(err),
    });
  }
}

