import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { userService } from '../../services/UserService';
import { organizationRepository } from '../../database/OrganizationRepository';
import logger from '../../utils/logger';
import { heavyActionLimit } from '../../middleware/rateLimiter';

const SELF_ASSIGNABLE_ROLES = ['project_manager', 'team_member', 'executive', 'scrum_master'] as const;

const profileUpdateSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required').max(200).optional(),
  email: z.string().email().max(255).optional(),
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/, 'Username may only contain letters, numbers, and underscores').optional(),
  organizationName: z.string().min(2).max(255).optional(),
  role: z.enum(SELF_ASSIGNABLE_ROLES).optional(),
  // needed to change your email or username (audit 2026-10-09 H2)
  currentPassword: z.string().max(200).optional(),
});

const categoryPrefSchema = z.object({
  inApp: z.boolean(),
  email: z.boolean(),
  slack: z.boolean().optional().default(true),
});

const notificationPrefsSchema = z.object({
  emailNotificationsEnabled: z.boolean().optional(),
  digestFrequency: z.enum(['none', 'daily', 'weekly']).optional(),
  digestPreferredHour: z.number().int().min(0).max(23).optional(),
  digestSections: z.array(z.enum(['overdue', 'deadlines', 'action_items', 'meetings', 'sprint', 'changes', 'notifications'])).optional(),
  typePreferences: z.record(
    z.enum(['agent_proposals', 'risks_issues', 'budget_finance', 'meetings', 'system_alerts', 'deadlines', 'tasks', 'collaboration']),
    categoryPrefSchema,
  ).optional(),
});

const accessibilityPrefsSchema = z.object({
  highContrast: z.boolean().optional(),
  fontSize: z.number().min(12).max(32).optional(),
  reducedMotion: z.boolean().optional(),
  simplificationLevel: z.enum(['off', 'mild', 'strong']).optional(),
  narrationEnabled: z.boolean().optional(),
  keyboardShortcutsEnabled: z.boolean().optional(),
});

const userPrefsSchema = z.object({
  timezone: z.string().max(100).optional(),
  locale: z.string().max(10).optional(),
});

/**
 * Your own settings (notifications, time zone and language, accessibility, dashboard, screen
 * layout): every signed-in person saves their OWN, whatever their role — a team member, viewer or
 * executive can't change project data but still chooses their digest or reduced motion (2026-10-08:
 * these needed 'write' and gave such roles a 403). The row is always the caller's: no id in the
 * path, and the body's fields are validated, so an id in it is ignored. Same as PUT /me/profile.
 */
const ownSettings = [requireScope('read')];

/** Changing your profile through a key needs a key that may write; a signed-in person passes */
const keyMayWrite = requireScope('write');
async function keyNeedsWrite(request: FastifyRequest, reply: FastifyReply) {
  if (request.apiKeyScopes) return keyMayWrite(request, reply);
}

type ProfileInput = z.infer<typeof profileUpdateSchema>;

/** Why a profile save is refused — checked before anything is written — or null */
async function profileRefusal(
  userId: string,
  parsed: ProfileInput,
  current: { passwordHash: string },
  c: { emailChanges: boolean; usernameChanges: boolean; onboarding: boolean; orgOwner?: string },
): Promise<{ status: number; body: { error: string; message: string } } | null> {
  if (c.emailChanges || (c.usernameChanges && !c.onboarding)) {
    const what = c.emailChanges ? 'email' : 'username';
    if (!parsed.currentPassword) {
      return { status: 400, body: { error: 'Password required', message: `Enter your current password to change your ${what}.` } };
    }
    if (!(await bcrypt.compare(parsed.currentPassword, current.passwordHash))) {
      return { status: 400, body: { error: 'Invalid password', message: `Your current password isn't right, so your ${what} wasn't changed.` } };
    }
  }
  if (c.orgOwner !== undefined && c.orgOwner !== userId) {
    return { status: 403, body: { error: 'Forbidden', message: 'Only the company owner can rename the company.' } };
  }
  if (c.usernameChanges) {
    const existing = await userService.findByUsername(parsed.username!);
    if (existing && existing.id !== userId) return { status: 409, body: { error: 'Username taken', message: 'That username is already in use' } };
  }
  if (c.emailChanges) {
    // a plain answer, not "Internal server error" from the unique key (2026-10-10 review)
    const existing = await userService.findByEmail(parsed.email!);
    if (existing && existing.id !== userId) return { status: 409, body: { error: 'Email taken', message: 'That email is already used by another account.' } };
  }
  return null;
}

export async function userRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  fastify.get('/me', {
    preHandler: [requireScope('read')],
    schema: { description: 'Get current user profile', tags: ['users'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const reqUser = request.user!;
      const dbUser = await userService.findById(reqUser.userId);

      return {
        user: {
          id: reqUser.userId,
          username: reqUser.username,
          role: reqUser.role,
          email: dbUser?.email,
          fullName: dbUser?.fullName,
          emailNotificationsEnabled: dbUser?.emailNotificationsEnabled ?? true,
          digestFrequency: dbUser?.digestFrequency ?? 'none',
          digestPreferredHour: dbUser?.digestPreferredHour ?? 7,
          digestSections: dbUser?.digestSections ?? null,
          notificationTypePreferences: dbUser?.notificationTypePreferences ?? null,
          timezone: dbUser?.timezone ?? 'UTC',
          locale: dbUser?.locale ?? 'en',
        },
      };
    } catch (error) {
      logger.error('Get user profile error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to fetch user profile' });
    }
  });

  /**
   * Your own profile (audit 2026-10-09 H2). A key needs 'write' — a read-only key could change
   * the account email — while a signed-in person always edits their own (a viewer's role is
   * read-only). A new email or username needs the current password (except picking a username
   * during onboarding), and only the company owner renames the company. Everything is checked
   * before anything is saved, so a refused save changes nothing.
   */
  fastify.put('/me/profile', {
    // the email/username change checks the current password: at most 20 saves per 10 minutes, so
    // the save can't be used to guess passwords (2026-10-10)
    preHandler: [keyNeedsWrite, heavyActionLimit('profile-save', 20)],
    schema: { description: 'Update profile (full name, email, username, organization)', tags: ['users'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const parsed = profileUpdateSchema.parse(request.body);
      if (Object.entries(parsed).every(([k, v]) => k === 'currentPassword' || v === undefined)) {
        return reply.status(400).send({ error: 'No fields to update' });
      }
      const current = await userService.findById(userId);
      if (!current) return reply.status(404).send({ error: 'User not found' });
      const onboarding = !current.fullName;
      const emailChanges = parsed.email !== undefined && parsed.email !== current.email;
      const usernameChanges = parsed.username !== undefined && parsed.username !== current.username;
      const org = parsed.organizationName ? await organizationRepository.findByUserId(userId) : null;
      const refusal = await profileRefusal(userId, parsed, current, { emailChanges, usernameChanges, onboarding, orgOwner: org?.ownerUserId });
      if (refusal) return reply.status(refusal.status).send(refusal.body);

      const updateData: Record<string, any> = {};
      if (parsed.fullName !== undefined) updateData.fullName = parsed.fullName;
      if (emailChanges) updateData.email = parsed.email;
      if (usernameChanges) updateData.username = parsed.username;
      // Role self-assignment — only allowed during onboarding (when fullName is null)
      if (parsed.role !== undefined && onboarding) updateData.role = parsed.role;

      let updated = current;
      if (Object.keys(updateData).length > 0) {
        const saved = await userService.update(userId, updateData);
        if (!saved) return reply.status(404).send({ error: 'User not found' });
        updated = saved;
      }

      // Rename the company (the owner only — checked above)
      if (org && parsed.organizationName) {
        try {
          await organizationRepository.update(org.id, { name: parsed.organizationName });
        } catch (orgErr) {
          logger.error('Failed to update organization name', { userId, error: orgErr });
        }
      }

      return {
        fullName: updated?.fullName,
        email: updated?.email,
        username: updated?.username,
      };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Update profile error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  fastify.put('/me/notification-preferences', {
    preHandler: ownSettings,
    schema: { description: 'Update notification preferences', tags: ['users'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const parsed = notificationPrefsSchema.parse(request.body);

      const updateData: Record<string, any> = {};
      if (parsed.emailNotificationsEnabled !== undefined) {
        updateData.emailNotificationsEnabled = parsed.emailNotificationsEnabled;
      }
      if (parsed.digestFrequency !== undefined) {
        updateData.digestFrequency = parsed.digestFrequency;
      }
      if (parsed.digestPreferredHour !== undefined) {
        updateData.digestPreferredHour = parsed.digestPreferredHour;
      }
      if (parsed.digestSections !== undefined) {
        updateData.digestSections = parsed.digestSections;
      }
      if (parsed.typePreferences !== undefined) {
        updateData.notificationTypePreferences = parsed.typePreferences;
      }

      const updated = await userService.update(userId, updateData);
      return {
        emailNotificationsEnabled: updated?.emailNotificationsEnabled ?? true,
        digestFrequency: updated?.digestFrequency ?? 'none',
        digestPreferredHour: updated?.digestPreferredHour ?? 7,
        digestSections: updated?.digestSections ?? null,
        notificationTypePreferences: updated?.notificationTypePreferences ?? null,
      };
    } catch (error) {
      // Bad input is the caller's mistake: the app's error handler answers 400 with the field
      if (error instanceof z.ZodError) throw error;
      logger.error('Update notification preferences error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  fastify.put('/me/preferences', {
    preHandler: ownSettings,
    schema: { description: 'Update user preferences (timezone, locale)', tags: ['users'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const parsed = userPrefsSchema.parse(request.body);
      const updateData: Record<string, any> = {};

      if (parsed.timezone !== undefined) {
        updateData.timezone = parsed.timezone;
      }
      if (parsed.locale !== undefined) {
        updateData.locale = parsed.locale;
      }

      const updated = await userService.update(userId, updateData);
      return {
        timezone: updated?.timezone ?? 'UTC',
        locale: updated?.locale ?? 'en',
      };
    } catch (error) {
      // Bad input is the caller's mistake: the app's error handler answers 400 with the field
      if (error instanceof z.ZodError) throw error;
      logger.error('Update user preferences error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Accessibility preferences
  fastify.get('/me/accessibility', {
    preHandler: [requireScope('read')],
    schema: { description: 'Get accessibility preferences', tags: ['users'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const prefs = await userService.getAccessibilityPrefs(userId);
      return { preferences: prefs };
    } catch (error) {
      logger.error('Get accessibility preferences error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  fastify.put('/me/accessibility', {
    preHandler: ownSettings,
    schema: { description: 'Update accessibility preferences', tags: ['users'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const parsed = accessibilityPrefsSchema.parse(request.body);
      await userService.updateAccessibilityPrefs(userId, parsed);
      return { preferences: parsed };
    } catch (error) {
      // Bad input is the caller's mistake: the app's error handler answers 400 with the field
      if (error instanceof z.ZodError) throw error;
      logger.error('Update accessibility preferences error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Dashboard preferences
  const dashboardPrefsSchema = z.object({
    enabledWidgets: z.array(z.string().max(50)).max(50),
    widgetOrder: z.array(z.string().max(50)).max(50),
    scope: z.enum(['mine', 'portfolio']),
  });

  fastify.get('/me/dashboard-preferences', {
    preHandler: [requireScope('read')],
    schema: { description: 'Get dashboard widget preferences', tags: ['users'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const prefs = await userService.getDashboardPrefs(userId);
      return { preferences: prefs };
    } catch (error) {
      logger.error('Get dashboard preferences error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  fastify.put('/me/dashboard-preferences', {
    preHandler: ownSettings,
    schema: { description: 'Update dashboard widget preferences', tags: ['users'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const parsed = dashboardPrefsSchema.parse(request.body);
      await userService.updateDashboardPrefs(userId, parsed);
      return { preferences: parsed };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Update dashboard preferences error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // View preferences (cross-device UI state)
  const columnStateSchema = z.object({
    visibleKeys: z.array(z.string()).optional(),
    columnOrder: z.array(z.string()).optional(),
    colWidths: z.record(z.string(), z.number()).optional(),
  });

  const viewPrefsSchema = z.object({
    theme: z.enum(['light', 'dark']).optional(),
    sidebarCollapsed: z.boolean().optional(),
    scheduleViewMode: z.enum(['gantt', 'kanban', 'table', 'calendar', 'network', 'burndown']).optional(),
    projectsViewMode: z.enum(['card', 'table']).optional(),
    aiPanelOpen: z.boolean().optional(),
    columnStates: z.record(z.string(), columnStateSchema).optional(),
    favoriteReportIds: z.array(z.string()).max(10).optional(),
  });

  fastify.get('/me/view-preferences', {
    preHandler: [requireScope('read')],
    schema: { description: 'Get view preferences', tags: ['users'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const prefs = await userService.getViewPrefs(userId);
      return { preferences: prefs };
    } catch (error) {
      logger.error('Get view preferences error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  fastify.put('/me/view-preferences', {
    preHandler: ownSettings,
    schema: { description: 'Update view preferences', tags: ['users'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const parsed = viewPrefsSchema.parse(request.body);
      // only what changed, merged in the database (two tabs saving at once no longer lose a change)
      const merged = await userService.mergeViewPrefs(userId, parsed);
      return { preferences: merged ?? {} };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Update view preferences error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
