import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { userService } from '../../services/UserService';
import { organizationService } from '../../services/OrganizationService';
import { organizationRepository } from '../../database/OrganizationRepository';
import logger from '../../utils/logger';

const SELF_ASSIGNABLE_ROLES = ['project_manager', 'team_member', 'executive', 'scrum_master'] as const;

const profileUpdateSchema = z.object({
  fullName: z.string().min(1).max(200).optional(),
  email: z.string().email().max(255).optional(),
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/, 'Username may only contain letters, numbers, and underscores').optional(),
  organizationName: z.string().min(2).max(255).optional(),
  role: z.enum(SELF_ASSIGNABLE_ROLES).optional(),
});

const categoryPrefSchema = z.object({
  inApp: z.boolean(),
  email: z.boolean(),
  slack: z.boolean().optional().default(true),
});

const notificationPrefsSchema = z.object({
  emailNotificationsEnabled: z.boolean().optional(),
  digestFrequency: z.enum(['none', 'daily', 'weekly']).optional(),
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
});

const userPrefsSchema = z.object({
  timezone: z.string().max(100).optional(),
  locale: z.string().max(10).optional(),
});

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

  fastify.put('/me/profile', {
    preHandler: [requireScope('read')],
    schema: { description: 'Update profile (full name, email, username, organization)', tags: ['users'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const parsed = profileUpdateSchema.parse(request.body);
      const updateData: Record<string, any> = {};
      if (parsed.fullName !== undefined) updateData.fullName = parsed.fullName;
      if (parsed.email !== undefined) updateData.email = parsed.email;

      // Role self-assignment — only allowed during onboarding (when fullName is null)
      if (parsed.role !== undefined) {
        const currentUser = await userService.findById(userId);
        if (currentUser && !currentUser.fullName) {
          updateData.role = parsed.role;
        }
      }

      // Username change — check uniqueness
      if (parsed.username !== undefined) {
        const existing = await userService.findByUsername(parsed.username);
        if (existing && existing.id !== userId) {
          return reply.status(409).send({ error: 'Username taken', message: 'That username is already in use' });
        }
        updateData.username = parsed.username;
      }

      if (Object.keys(updateData).length === 0 && !parsed.organizationName) {
        return reply.status(400).send({ error: 'No fields to update' });
      }

      let updated;
      if (Object.keys(updateData).length > 0) {
        updated = await userService.update(userId, updateData);
        if (!updated) return reply.status(404).send({ error: 'User not found' });
      } else {
        updated = await userService.findById(userId);
      }

      // Update organization name if provided
      if (parsed.organizationName) {
        try {
          const org = await organizationService.findByUserId(userId);
          if (org) {
            await organizationRepository.update(org.id, { name: parsed.organizationName });
          }
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
    preHandler: [requireScope('write')],
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
      if (parsed.typePreferences !== undefined) {
        updateData.notificationTypePreferences = parsed.typePreferences;
      }

      const updated = await userService.update(userId, updateData);
      return {
        emailNotificationsEnabled: updated?.emailNotificationsEnabled ?? true,
        digestFrequency: updated?.digestFrequency ?? 'none',
        notificationTypePreferences: updated?.notificationTypePreferences ?? null,
      };
    } catch (error) {
      logger.error('Update notification preferences error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  fastify.put('/me/preferences', {
    preHandler: [requireScope('write')],
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
    preHandler: [requireScope('write')],
    schema: { description: 'Update accessibility preferences', tags: ['users'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const parsed = accessibilityPrefsSchema.parse(request.body);
      await userService.updateAccessibilityPrefs(userId, parsed);
      return { preferences: parsed };
    } catch (error) {
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
    preHandler: [requireScope('write')],
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
    preHandler: [requireScope('write')],
    schema: { description: 'Update view preferences', tags: ['users'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const parsed = viewPrefsSchema.parse(request.body);
      // Merge with existing prefs so partial updates work
      const existing = await userService.getViewPrefs(userId) || {};
      const merged = { ...existing, ...parsed };
      await userService.updateViewPrefs(userId, merged);
      return { preferences: merged };
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Update view preferences error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
