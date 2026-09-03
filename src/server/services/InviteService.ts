import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { inviteTokenRepository, InviteToken } from '../database/InviteTokenRepository';
import { organizationRepository } from '../database/OrganizationRepository';
import { projectMemberRepository } from '../database/ProjectMemberRepository';
import { emailService } from './EmailService';
import { userService } from './UserService';
import { pricingConfigService } from './PricingConfigService';
import { runWithTenantContext } from '../middleware/requestContext';
import { resourceService } from './ResourceService';
import logger from '../utils/logger';

const VIEWER_LIMITS_FALLBACK: Record<string, number> = {
  trial: 0,
  consultant: 5,
  sme: 999999,
  enterprise: 999999,
};

export class InviteService {
  async getViewerLimit(tier: string): Promise<number> {
    try {
      return await pricingConfigService.getViewerLimit(tier);
    } catch {
      return VIEWER_LIMITS_FALLBACK[tier] ?? 0;
    }
  }

  async createInvite(
    inviterUserId: string,
    email: string,
    projectId?: string | null,
    role: string = 'viewer',
  ): Promise<InviteToken> {
    const inviter = await userService.findById(inviterUserId);
    if (!inviter) throw new Error('Inviter not found');

    const org = await organizationRepository.findByUserId(inviterUserId);
    if (!org) throw new Error('Organization not found');

    // For non-viewer roles on per-seat orgs, check seat availability
    if (role !== 'viewer' && org.billingModel === 'per_seat') {
      const { seatService } = await import('./SeatService');
      await seatService.validateSeatAvailability(org.id);
    }

    // Check viewer limit (skip for per-seat orgs — unlimited viewers)
    if (role === 'viewer' && org.billingModel !== 'per_seat') {
      const currentViewers = await inviteTokenRepository.countActiveViewersByOrg(org.id);
      const limit = org.viewerLimit ?? await this.getViewerLimit(org.subscriptionTier);
      if (currentViewers >= limit) {
        throw new Error(`Viewer limit reached (${limit}). Upgrade your plan for more viewer seats.`);
      }
    }

    const id = uuidv4();
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await inviteTokenRepository.create(
      id, token, inviterUserId, org.id, projectId || null, email, role, expiresAt,
    );

    // Send invite email
    emailService.sendViewerInviteEmail(
      email, org.name, inviter.fullName, projectId || null, token,
    ).catch(err => {
      logger.error('Failed to send viewer invite email', { email, error: err });
    });

    return (await inviteTokenRepository.findById(id))!;
  }

  async acceptInvite(token: string, userId: string): Promise<InviteToken> {
    const invite = await inviteTokenRepository.findByToken(token);
    if (!invite) throw new Error('Invalid or expired invite token');

    await inviteTokenRepository.markAccepted(invite.id, userId);

    // Update user: set organization and role
    const updateData: Record<string, any> = {
      organizationId: invite.organizationId,
      role: invite.role,
    };

    // For non-viewer roles, sync subscription tier/status from org
    if (invite.role !== 'viewer') {
      const org = await organizationRepository.findById(invite.organizationId);
      if (org) {
        updateData.subscriptionTier = org.subscriptionTier;
        updateData.subscriptionStatus = org.subscriptionStatus;
      }
    }

    await userService.update(userId, updateData as any);

    // If invite has a project, add user as project member (in tenant context)
    if (invite.projectId) {
      try {
        const org = await organizationRepository.findById(invite.organizationId);
        if (org?.dbName) {
          const user = await userService.findById(userId);
          await runWithTenantContext(org.dbName, invite.organizationId, () =>
            projectMemberRepository.insert(invite.projectId!, {
              userId,
              userName: user?.username || '',
              email: user?.email || '',
              role: 'viewer',
            }),
          );
        }
      } catch (err) {
        logger.error('Failed to add invited user to project', { projectId: invite.projectId, userId, error: err });
      }
    }

    // Create a resource record for the new user in the tenant DB
    try {
      const org = invite.projectId ? null : await organizationRepository.findById(invite.organizationId);
      const user = await userService.findById(userId);
      const orgForResource = org || await organizationRepository.findById(invite.organizationId);
      if (orgForResource?.dbName && user) {
        await runWithTenantContext(orgForResource.dbName, invite.organizationId, () =>
          resourceService.createResource({
            name: user.fullName || user.username || user.email.split('@')[0],
            role: invite.role,
            email: user.email,
            capacityHoursPerWeek: 40,
            skills: [],
            isActive: true,
            costRateHourly: null,
            overtimeRateHourly: null,
            resourceGroup: null,
            userId,
            calendarTemplateId: null,
          }),
        );
      }
    } catch (resErr) {
      logger.warn('Failed to create resource for invited user', { userId, error: resErr });
    }

    return { ...invite, status: 'accepted' };
  }

  async listInvites(organizationId: string): Promise<InviteToken[]> {
    return inviteTokenRepository.findByOrg(organizationId);
  }

  async revokeInvite(id: string, userId: string, userRole: string): Promise<void> {
    const invite = await inviteTokenRepository.findById(id);
    if (!invite) throw new Error('Invite not found');

    // Verify the revoker belongs to the same org
    const org = await organizationRepository.findByUserId(userId);
    if (!org || org.id !== invite.organizationId) {
      throw new Error('Not authorized to revoke this invite');
    }

    // Only org owner, admin, or project_manager can revoke invites
    if (org.ownerUserId !== userId && userRole !== 'admin' && userRole !== 'project_manager') {
      throw new Error('Not authorized to revoke this invite');
    }

    await inviteTokenRepository.revoke(id);
  }

  async validateToken(token: string): Promise<{ valid: boolean; email?: string; orgName?: string; projectId?: string | null }> {
    const invite = await inviteTokenRepository.findByToken(token);
    if (!invite) return { valid: false };

    const org = await organizationRepository.findById(invite.organizationId);
    return {
      valid: true,
      email: invite.email,
      orgName: org?.name,
      projectId: invite.projectId,
    };
  }
}

export const inviteService = new InviteService();
