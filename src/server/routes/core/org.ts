import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { authMiddleware } from '../../middleware/auth';
import { organizationService } from '../../services/OrganizationService';
import { userService } from '../../services/UserService';
import { emailService } from '../../services/EmailService';
import { rateLimiter } from '../../middleware/rateLimiter';
import { resourceService } from '../../services/ResourceService';
import { isConsultantTier } from '../../utils/tierUtils';
import logger from '../../utils/logger';

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum([
    'admin', 'executive', 'project_manager', 'team_member', 'scrum_master',
    'finance_officer', 'risk_manager', 'pmo', 'ba', 'qa', 'tester', 'devops', 'claude_sme', 'viewer',
  ]).default('team_member'),
});

export async function orgRoutes(fastify: FastifyInstance) {
  // All org routes require authentication
  fastify.addHook('preHandler', authMiddleware);

  fastify.post('/invite', {
    schema: { description: 'Invite a user to your organization', tags: ['org'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Rate limit: 10 invites per minute
      const rl = rateLimiter.check(`org:invite:${request.user!.userId}`, 10, 60_000);
      if (!rl.allowed) {
        return reply.status(429).send({ error: 'Too many invite attempts. Please try again later.' });
      }

      const { email, role } = inviteSchema.parse(request.body);
      const inviterId = request.user!.userId;

      // Look up the inviter's organization
      const org = await organizationService.findByUserId(inviterId);
      if (!org) {
        return reply.status(403).send({ error: 'No organization', message: 'You are not part of an organization.' });
      }

      // Only org owner or admin can invite
      const inviter = await userService.findById(inviterId);
      if (!inviter) {
        return reply.status(401).send({ error: 'User not found' });
      }
      if (org.ownerUserId !== inviterId && inviter.role !== 'admin') {
        return reply.status(403).send({ error: 'Forbidden', message: 'Only the organization owner or an admin can invite users.' });
      }

      // Consultant tiers can only invite viewers
      if (isConsultantTier(org.subscriptionTier) && role !== 'viewer') {
        return reply.status(403).send({ error: 'Tier restriction', message: 'Your plan only allows viewer invites. Upgrade to SME or Enterprise for team member seats.' });
      }

      // Per-seat orgs: non-viewer invites consume a seat — auto-add if needed
      if (role !== 'viewer' && org.billingModel === 'per_seat') {
        const { seatService } = await import('../../services/SeatService');
        const seatInfo = await seatService.getOrgSeatInfo(org.id);
        if (seatInfo.availableSeats < 1) {
          await seatService.addSeats(org.id, 1);
        }
      }

      // Check max users limit
      const currentCount = await organizationService.countUsers(org.id);
      if (currentCount >= org.maxUsers) {
        return reply.status(400).send({
          error: 'User limit reached',
          message: `Your organization can have up to ${org.maxUsers} users. Upgrade your plan for more.`,
        });
      }

      // Check if user already exists
      const existingUser = await userService.findByEmail(email);
      if (existingUser) {
        // If already in this org, nothing to do
        const existingOrg = await organizationService.findByUserId(existingUser.id);
        if (existingOrg && existingOrg.id === org.id) {
          return reply.status(409).send({ error: 'Already a member', message: 'This user is already in your organization.' });
        }
        if (existingOrg) {
          return reply.status(409).send({ error: 'User in another organization', message: 'This user already belongs to another organization.' });
        }

        // Add existing user to this org
        await userService.update(existingUser.id, { organizationId: org.id, role } as any);
        organizationService.invalidateUserCache(existingUser.id);

        // Create a resource record so they appear in resource management
        try {
          await resourceService.createResource({
            name: existingUser.fullName || existingUser.username || email.split('@')[0],
            role,
            email,
            capacityHoursPerWeek: 40,
            skills: [],
            isActive: true,
            costRateHourly: null,
            overtimeRateHourly: null,
            resourceGroup: null,
            userId: existingUser.id,
            calendarTemplateId: null,
          });
        } catch (resErr) {
          logger.warn('Failed to create resource for invited user', { email, error: resErr });
        }

        logger.info('User added to organization via invite', { userId: existingUser.id, orgId: org.id });

        return {
          message: `${email} has been added to your organization.`,
          status: 'added',
        };
      }

      // User doesn't exist yet — auto-create account with temp password
      const tempPassword = crypto.randomBytes(6).toString('base64url'); // 8-char readable
      const passwordHash = await bcrypt.hash(tempPassword, 12);
      const username = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '') + '_' + crypto.randomBytes(3).toString('hex');

      try {
        const newUser = await userService.create({
          username,
          email,
          passwordHash,
          fullName: email.split('@')[0],
          role: role as any,
          emailVerified: true, // admin vouches for them
        });

        // Set must_change_password flag and org membership
        await userService.update(newUser.id, {
          mustChangePassword: true,
          organizationId: org.id,
          subscriptionStatus: 'none',
        } as any);
        organizationService.invalidateUserCache(newUser.id);

        // Create resource record
        try {
          await resourceService.createResource({
            name: email.split('@')[0],
            role,
            email,
            capacityHoursPerWeek: 40,
            skills: [],
            isActive: true,
            costRateHourly: null,
            overtimeRateHourly: null,
            resourceGroup: null,
            userId: newUser.id,
            calendarTemplateId: null,
          });
        } catch (resErr) {
          logger.warn('Failed to create resource for auto-created user', { email, error: resErr });
        }

        // Send welcome email with temp password
        const appUrl = process.env.APP_URL || 'https://kovarti.com';
        try {
          await emailService.sendOrgInviteEmail(email, org.name, inviter.fullName, {
            tempPassword,
            loginUrl: `${appUrl}/login`,
          });
        } catch (emailErr) {
          logger.warn('Failed to send org invite email', { email, error: emailErr });
        }

        logger.info('User auto-created via org invite', { userId: newUser.id, orgId: org.id, email });

        return {
          message: `Account created for ${email} and added to your organization. They will be asked to change their password on first login.`,
          status: 'created',
          tempPassword,
        };
      } catch (createErr: any) {
        logger.error('Failed to auto-create user on invite', { email, error: createErr });
        return reply.status(500).send({ error: 'Failed to create user account', message: createErr.message || 'Unknown error' });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', message: error.issues[0]?.message || 'Invalid input' });
      }
      logger.error('Org invite error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to invite user' });
    }
  });

  // List organization members
  fastify.get('/members', {
    schema: { description: 'List organization members', tags: ['org'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const org = await organizationService.findByUserId(request.user!.userId);
      if (!org) {
        return reply.status(403).send({ error: 'No organization', message: 'You are not part of an organization.' });
      }

      const members = await userService.listByOrganization(org.id);
      return {
        organization: { id: org.id, name: org.name, slug: org.slug },
        members: members.map(m => ({
          id: m.id,
          username: m.username,
          email: m.email,
          fullName: m.fullName,
          role: m.role,
          isActive: m.isActive,
          lastLoginAt: m.lastLoginAt,
        })),
        maxUsers: org.maxUsers,
      };
    } catch (error) {
      logger.error('List org members error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to list members' });
    }
  });

  // Update a member's role
  const updateMemberSchema = z.object({
    role: z.enum([
      'admin', 'executive', 'project_manager', 'team_member', 'scrum_master',
      'finance_officer', 'risk_manager', 'pmo', 'ba', 'qa', 'tester', 'devops', 'claude_sme', 'viewer',
    ]),
  });

  fastify.patch('/members/:memberId', {
    schema: { description: 'Update a member role', tags: ['org'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { memberId } = request.params as { memberId: string };
      const { role } = updateMemberSchema.parse(request.body);
      const requesterId = request.user!.userId;

      const org = await organizationService.findByUserId(requesterId);
      if (!org) {
        return reply.status(403).send({ error: 'No organization' });
      }

      // Only org owner or admin can change roles
      const requester = await userService.findById(requesterId);
      if (org.ownerUserId !== requesterId && requester?.role !== 'admin') {
        return reply.status(403).send({ error: 'Forbidden', message: 'Only the organization owner or an admin can change roles.' });
      }

      // Verify target user is in same org
      const targetOrg = await organizationService.findByUserId(memberId);
      if (!targetOrg || targetOrg.id !== org.id) {
        return reply.status(404).send({ error: 'Member not found in your organization' });
      }

      // Cannot change own role (prevent locking yourself out)
      if (memberId === requesterId) {
        return reply.status(400).send({ error: 'Cannot change your own role' });
      }

      // Consultant tiers can only have viewers (no promotions to non-viewer)
      if (isConsultantTier(org.subscriptionTier) && role !== 'viewer') {
        return reply.status(403).send({ error: 'Tier restriction', message: 'Your plan only allows viewer roles. Upgrade to SME or Enterprise for team member seats.' });
      }

      // Per-seat orgs: promoting viewer to non-viewer consumes a seat
      if (role !== 'viewer' && org.billingModel === 'per_seat') {
        const target = await userService.findById(memberId);
        if (target?.role === 'viewer') {
          const { seatService } = await import('../../services/SeatService');
          const seatInfo = await seatService.getOrgSeatInfo(org.id);
          if (seatInfo.availableSeats < 1) {
            await seatService.addSeats(org.id, 1);
          }
        }
      }

      await userService.update(memberId, { role } as any);
      organizationService.invalidateUserCache(memberId);

      return { message: 'Role updated', memberId, role };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', message: error.issues[0]?.message || 'Invalid input' });
      }
      logger.error('Update member role error', { error });
      return reply.status(500).send({ error: 'Failed to update member role' });
    }
  });

  // Invite a guest collaborator
  const guestInviteSchema = z.object({
    email: z.string().email(),
    projectId: z.string().min(1),
    permissions: z.object({
      canComment: z.boolean().default(true),
      canUpdateAssigned: z.boolean().default(true),
      canViewBudget: z.boolean().default(false),
      canViewRisks: z.boolean().default(false),
      canUploadFiles: z.boolean().default(false),
    }).optional(),
    expiresAt: z.string().optional(),
  });

  fastify.post('/invite-guest', {
    schema: { description: 'Invite a guest collaborator to a project', tags: ['org'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const rl = rateLimiter.check(`org:guest-invite:${request.user!.userId}`, 10, 60_000);
      if (!rl.allowed) {
        return reply.status(429).send({ error: 'Too many invite attempts' });
      }

      const { email, projectId, permissions, expiresAt } = guestInviteSchema.parse(request.body);
      const inviterId = request.user!.userId;

      const org = await organizationService.findByUserId(inviterId);
      if (!org) return reply.status(403).send({ error: 'No organization' });

      const inviter = await userService.findById(inviterId);
      if (!inviter) return reply.status(401).send({ error: 'User not found' });
      if (org.ownerUserId !== inviterId && inviter.role !== 'admin' && inviter.role !== 'project_manager') {
        return reply.status(403).send({ error: 'Only admin/PM/owner can invite guests' });
      }

      let guestUser = await userService.findByEmail(email);
      if (guestUser && !guestUser.isGuest) {
        return reply.status(409).send({ error: 'This email belongs to a full member, not a guest' });
      }

      if (!guestUser) {
        const tempPassword = crypto.randomBytes(6).toString('base64url');
        const passwordHash = await bcrypt.hash(tempPassword, 12);
        const username = 'guest_' + email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '') + '_' + crypto.randomBytes(3).toString('hex');

        guestUser = await userService.create({
          username,
          email,
          passwordHash,
          fullName: email.split('@')[0],
          role: 'viewer' as any,
          emailVerified: true,
        });

        await userService.update(guestUser.id, {
          mustChangePassword: true,
          organizationId: org.id,
          isGuest: true,
          guestInvitedBy: inviterId,
          guestExpiresAt: expiresAt || null,
        } as any);
        organizationService.invalidateUserCache(guestUser.id);

        const appUrl = process.env.APP_URL || 'https://kovarti.com';
        try {
          await emailService.sendOrgInviteEmail(email, org.name, inviter.fullName, {
            tempPassword,
            loginUrl: `${appUrl}/login`,
          });
        } catch (emailErr) {
          logger.warn('Failed to send guest invite email', { email, error: emailErr });
        }
      }

      // Add project membership as viewer
      const { projectMemberService } = await import('../../services/ProjectMemberService');
      try {
        await projectMemberService.addMember(projectId, {
          userId: guestUser.id,
          userName: guestUser.username || email.split('@')[0],
          email,
          role: 'viewer' as any,
        });
      } catch {
        // May already be a member
      }

      // Create guest permissions record
      const { v4: uuidv4 } = await import('uuid');
      const perms = permissions || { canComment: true, canUpdateAssigned: true, canViewBudget: false, canViewRisks: false, canUploadFiles: false };
      const { databaseService } = await import('../../database/connection');
      await databaseService.query(
        `INSERT INTO guest_project_permissions (id, user_id, project_id, can_comment, can_update_assigned, can_view_budget, can_view_risks, can_upload_files, invited_by, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE can_comment=VALUES(can_comment), can_update_assigned=VALUES(can_update_assigned), can_view_budget=VALUES(can_view_budget), can_view_risks=VALUES(can_view_risks), can_upload_files=VALUES(can_upload_files), expires_at=VALUES(expires_at)`,
        [
          uuidv4(), guestUser.id, projectId,
          perms.canComment !== false ? 1 : 0,
          perms.canUpdateAssigned !== false ? 1 : 0,
          perms.canViewBudget ? 1 : 0,
          perms.canViewRisks ? 1 : 0,
          perms.canUploadFiles ? 1 : 0,
          inviterId,
          expiresAt || null,
        ],
      );

      return { message: `Guest invite sent to ${email}`, guestUserId: guestUser.id };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', message: error.issues[0]?.message });
      }
      logger.error('Guest invite error', { error });
      return reply.status(500).send({ error: 'Failed to invite guest' });
    }
  });

  // GET /guests — list all guest users in org
  fastify.get('/guests', {
    schema: { description: 'List guest collaborators', tags: ['org'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const org = await organizationService.findByUserId(request.user!.userId);
      if (!org) return reply.status(403).send({ error: 'No organization' });

      const { databaseService } = await import('../../database/connection');
      const guests = await databaseService.queryControlPlane(
        `SELECT id, username, email, full_name as fullName, is_active as isActive, guest_expires_at as guestExpiresAt, created_at as createdAt
         FROM users WHERE organization_id = ? AND is_guest = 1 ORDER BY created_at DESC`,
        [org.id],
      );

      // Get permissions for each guest
      const guestIds = guests.map((g: any) => g.id);
      let permissions: any[] = [];
      if (guestIds.length > 0) {
        const placeholders = guestIds.map(() => '?').join(',');
        permissions = await databaseService.query(
          `SELECT * FROM guest_project_permissions WHERE user_id IN (${placeholders})`,
          guestIds,
        );
      }

      const permByUser = new Map<string, any[]>();
      for (const p of permissions) {
        const list = permByUser.get(p.user_id) || [];
        list.push(p);
        permByUser.set(p.user_id, list);
      }

      return {
        guests: guests.map((g: any) => ({
          ...g,
          isActive: !!g.isActive,
          permissions: permByUser.get(g.id) || [],
        })),
      };
    } catch (error) {
      logger.error('List guests error', { error });
      return reply.status(500).send({ error: 'Failed to list guests' });
    }
  });

  // PATCH /guests/:guestId — update guest permissions
  fastify.patch('/guests/:guestId', {
    schema: { description: 'Update guest permissions', tags: ['org'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { guestId } = request.params as { guestId: string };
      const body = z.object({
        projectId: z.string().optional(),
        canComment: z.boolean().optional(),
        canUpdateAssigned: z.boolean().optional(),
        canViewBudget: z.boolean().optional(),
        canViewRisks: z.boolean().optional(),
        canUploadFiles: z.boolean().optional(),
        expiresAt: z.string().nullable().optional(),
      }).parse(request.body);

      if (body.expiresAt !== undefined) {
        await userService.update(guestId, { guestExpiresAt: body.expiresAt } as any);
      }

      if (body.projectId) {
        const { databaseService } = await import('../../database/connection');
        const sets: string[] = [];
        const params: any[] = [];
        if (body.canComment !== undefined) { sets.push('can_comment = ?'); params.push(body.canComment ? 1 : 0); }
        if (body.canUpdateAssigned !== undefined) { sets.push('can_update_assigned = ?'); params.push(body.canUpdateAssigned ? 1 : 0); }
        if (body.canViewBudget !== undefined) { sets.push('can_view_budget = ?'); params.push(body.canViewBudget ? 1 : 0); }
        if (body.canViewRisks !== undefined) { sets.push('can_view_risks = ?'); params.push(body.canViewRisks ? 1 : 0); }
        if (body.canUploadFiles !== undefined) { sets.push('can_upload_files = ?'); params.push(body.canUploadFiles ? 1 : 0); }
        if (body.expiresAt !== undefined) { sets.push('expires_at = ?'); params.push(body.expiresAt); }

        if (sets.length > 0) {
          params.push(guestId, body.projectId);
          await databaseService.query(
            `UPDATE guest_project_permissions SET ${sets.join(', ')} WHERE user_id = ? AND project_id = ?`,
            params,
          );
        }
      }

      return { message: 'Guest updated' };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error' });
      logger.error('Update guest error', { error });
      return reply.status(500).send({ error: 'Failed to update guest' });
    }
  });

  // DELETE /guests/:guestId — revoke guest access
  fastify.delete('/guests/:guestId', {
    schema: { description: 'Revoke guest access', tags: ['org'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { guestId } = request.params as { guestId: string };

      const org = await organizationService.findByUserId(request.user!.userId);
      if (!org) return reply.status(403).send({ error: 'No organization' });

      const guest = await userService.findById(guestId);
      if (!guest || !guest.isGuest) {
        return reply.status(404).send({ error: 'Guest not found' });
      }

      await userService.update(guestId, { isActive: false } as any);
      organizationService.invalidateUserCache(guestId);

      const { databaseService } = await import('../../database/connection');
      await databaseService.query('DELETE FROM guest_project_permissions WHERE user_id = ?', [guestId]);

      return { message: 'Guest access revoked' };
    } catch (error) {
      logger.error('Revoke guest error', { error });
      return reply.status(500).send({ error: 'Failed to revoke guest' });
    }
  });

  // Remove a member from the organization
  fastify.delete('/members/:memberId', {
    schema: { description: 'Remove a member from the organization', tags: ['org'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { memberId } = request.params as { memberId: string };
      const requesterId = request.user!.userId;

      const org = await organizationService.findByUserId(requesterId);
      if (!org) {
        return reply.status(403).send({ error: 'No organization' });
      }

      const requester = await userService.findById(requesterId);
      if (org.ownerUserId !== requesterId && requester?.role !== 'admin') {
        return reply.status(403).send({ error: 'Forbidden', message: 'Only the organization owner or an admin can remove members.' });
      }

      // Cannot remove yourself
      if (memberId === requesterId) {
        return reply.status(400).send({ error: 'Cannot remove yourself from the organization' });
      }

      // Cannot remove the org owner
      if (memberId === org.ownerUserId) {
        return reply.status(400).send({ error: 'Cannot remove the organization owner' });
      }

      // Verify target is in same org
      const targetOrg = await organizationService.findByUserId(memberId);
      if (!targetOrg || targetOrg.id !== org.id) {
        return reply.status(404).send({ error: 'Member not found in your organization' });
      }

      // Remove org association (set organization_id to NULL)
      await userService.update(memberId, { organizationId: null } as any);
      organizationService.invalidateUserCache(memberId);

      return { message: 'Member removed', memberId };
    } catch (error) {
      logger.error('Remove member error', { error });
      return reply.status(500).send({ error: 'Failed to remove member' });
    }
  });
}
