import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import os from 'os';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { databaseService } from '../../database/connection';
import { userService } from '../../services/UserService';
import { auditLedgerService } from '../../services/AuditLedgerService';
import { subscriptionEventRepository } from '../../database/SubscriptionEventRepository';
import { redisService } from '../../services/RedisService';
import { pricingConfigService } from '../../services/PricingConfigService';
import { pricingConfigRepository } from '../../database/PricingConfigRepository';
import { organizationRepository } from '../../database/OrganizationRepository';
import { config, getTierBudget } from '../../config';
import logger from '../../utils/logger';
import { sendValidationError } from '../../utils/validationError';
import { selectAcrossCompanies, sumRows, mergeGroups } from '../../utils/acrossCompanies';

import { isPlatformAdmin } from '../../utils/platformAdmin';
import { neverConfirmedSql } from '../../constants/neverConfirmed';
import { clampPagination } from '../../schemas/paginationSchema';
const statusSchema = z.object({
  active: z.boolean(),
});

const changeTierSchema = z.object({
  tier: z.enum(['trial', 'consultant_basic', 'consultant_pro', 'sme', 'enterprise']),
});

function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user!;
  if (!isPlatformAdmin(user)) {
    reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' });
    return false;
  }
  return true;
}

// Pricing edits (2026-10-07): a missing body, text where a number goes, or text longer than its
// column used to reach the database and answer 500. Lengths match the pricing_config columns.
// Unknown keys are dropped (the repository ignores them anyway).
const num = (label: string) => z.number({ message: `${label} must be a number.` }).finite(`${label} must be a number.`);
const text = (label: string, max: number) => z.string({ message: `${label} must be text.` }).max(max, `${label} can be at most ${max} characters.`);
const flag = (label: string) => z.boolean({ message: `${label} must be true or false.` });
const pricingTierUpdateSchema = z.object({
  displayName: text('Display name', 50).min(1, 'Enter a display name.'),
  monthlyPriceCents: num('Monthly price'),
  annualPriceCents: num('Annual price'),
  aiTokensMonthly: num('AI tokens per month'),
  aiTokensLabel: text('AI tokens label', 50),
  aiTokensDescription: text('AI tokens description', 200).nullable(),
  storageMb: num('Storage (MB)'),
  storageLabel: text('Storage label', 20),
  viewerLimit: num('Viewer limit'),
  viewerLimitLabel: text('Viewer limit label', 20),
  maxProjects: num('Max projects'),
  isPerSeat: flag('Per seat'),
  minSeats: num('Minimum seats'),
  durationDays: num('Duration (days)'),
  highlight: flag('Highlight'),
  stripeMonthlyPriceId: text('Stripe monthly price id', 255).nullable(),
  stripeAnnualPriceId: text('Stripe annual price id', 255).nullable(),
  featuresJson: z.array(z.string(), { message: 'The feature list must be a list of text.' }),
  sortOrder: num('Sort order'),
  isActive: flag('Active'),
}).partial();
const tierFeaturesUpdateSchema = z.record(z.string(), z.boolean({ message: 'Each feature must be switched on or off (true or false).' }), {
  message: 'Send the features to switch on or off, e.g. { "ai_assistant": true }.',
});

export async function adminRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /api/v1/admin/users
  fastify.get('/users', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(request, reply)) return reply;
    try {
      const query = request.query as { limit?: string; offset?: string; subscriptionStatus?: string };
      const limit = Math.min(Math.max(parseInt(query.limit || '100', 10) || 100, 1), 500);
      const offset = Math.max(parseInt(query.offset || '0', 10) || 0, 0);

      const validSubStatuses = ['active', 'trialing', 'past_due', 'canceled'];
      const subStatusFilter = query.subscriptionStatus && validSubStatuses.includes(query.subscriptionStatus)
        ? query.subscriptionStatus : null;

      const subStatusClause = subStatusFilter ? 'HAVING subscription_status = ?' : '';
      const subStatusParams = subStatusFilter ? [subStatusFilter] : [];

      const rows = await databaseService.queryControlPlane(
        `SELECT
          u.id, u.username, u.email, u.full_name, u.role, u.is_active,
          u.created_at, u.last_login_at, u.subscription_tier,
          u.ai_monthly_token_budget,
          u.email_verified,
          u.login_verification_token IS NOT NULL AS has_pending_login,
          u.login_verification_expires,
          u.organization_id,
          o.name AS organization_name,
          COUNT(DISTINCT p.id) AS project_count,
          COALESCE(ai.tokens_used, 0) AS ai_tokens_used,
          s.status AS subscription_status,
          s.current_period_end AS subscription_period_end
        FROM users u
        LEFT JOIN projects p ON p.created_by = u.id
        LEFT JOIN organizations o ON o.id = u.organization_id
        LEFT JOIN (
          SELECT user_id, SUM(input_tokens + output_tokens) AS tokens_used
          FROM ai_usage_log
          WHERE created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
          GROUP BY user_id
        ) ai ON ai.user_id = u.id
        LEFT JOIN (
          SELECT s1.user_id, s1.status, s1.current_period_end
          FROM subscriptions s1
          INNER JOIN (
            SELECT user_id, MAX(created_at) AS max_created
            FROM subscriptions GROUP BY user_id
          ) s2 ON s1.user_id = s2.user_id AND s1.created_at = s2.max_created
        ) s ON s.user_id = u.id
        GROUP BY u.id
        ${subStatusClause}
        ORDER BY u.created_at DESC
        LIMIT ? OFFSET ?`,
        [...subStatusParams, limit, offset]
      );

      // Compute tier budgets for each user so the frontend can show usage %
      const usersWithBudget = rows.map((u: any) => ({
        ...u,
        ai_tier_budget: getTierBudget(u.subscription_tier || 'trial'),
      }));

      return { users: usersWithBudget };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /api/v1/admin/users/:id/subscription-events
  fastify.get('/users/:id/subscription-events', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(request, reply)) return reply;
    const { id } = request.params as { id: string };
    try {
      const events = await subscriptionEventRepository.findByUser(id);
      return { events };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // PATCH /api/v1/admin/users/:id/status
  fastify.patch('/users/:id/status', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(request, reply)) return reply;
    const requestingUser = request.user!;
    const { id } = request.params as { id: string };

    if (id === requestingUser.userId) {
      return reply.status(400).send({ error: 'Bad request', message: 'Cannot deactivate your own account' });
    }

    const result = statusSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Bad request', message: 'active (boolean) required' });
    }

    try {
      // Block deactivation of users with active Stripe subscriptions
      if (!result.data.active) {
        const [subRow] = await databaseService.queryControlPlane<{ status: string; stripe_customer_id: string | null }>(
          `SELECT s.status, u.stripe_customer_id
           FROM users u
           LEFT JOIN (
             SELECT s1.user_id, s1.status FROM subscriptions s1
             INNER JOIN (SELECT user_id, MAX(created_at) AS mc FROM subscriptions GROUP BY user_id) s2
             ON s1.user_id = s2.user_id AND s1.created_at = s2.mc
           ) s ON s.user_id = u.id
           WHERE u.id = ?`,
          [id]
        );
        if (subRow && ['active', 'trialing', 'past_due'].includes(subRow.status)) {
          return reply.status(409).send({
            error: 'Conflict',
            message: 'Cannot deactivate a user with an active subscription. Cancel their subscription in Stripe first.',
            subscriptionStatus: subRow.status,
          });
        }
      }

      const updated = await userService.update(id, { isActive: result.data.active });
      if (!updated) {
        return reply.status(404).send({ error: 'Not found', message: 'User not found' });
      }
      return { message: 'User status updated', isActive: updated.isActive };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // PATCH /api/v1/admin/users/:id/tier — admin change user tier
  fastify.patch('/users/:id/tier', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(request, reply)) return reply;
    const { id } = request.params as { id: string };
    const result = changeTierSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Bad request', message: 'Valid tier is required' });
    }

    try {
      const user = await userService.findById(id);
      if (!user) return reply.status(404).send({ error: 'Not found', message: 'User not found' });

      const previousTier = user.subscriptionTier || 'trial';
      const newTier = result.data.tier;

      // Update user tier
      await userService.update(id, {
        subscriptionTier: newTier,
        subscriptionStatus: newTier === 'trial' ? 'trialing' : 'active',
      });

      // Sync org tier/billing if user has an org
      const org = await organizationRepository.findByUserId(id);
      if (newTier === 'sme' && org) {
        await organizationRepository.update(org.id, {
          subscriptionTier: 'sme',
          subscriptionStatus: 'active',
          billingModel: 'per_seat',
          seatCount: Math.max(3, await organizationRepository.countNonViewerUsers(org.id) || 3),
        });
      } else if (org) {
        await organizationRepository.update(org.id, {
          subscriptionTier: newTier,
          subscriptionStatus: newTier === 'trial' ? 'trialing' : 'active',
          billingModel: 'flat',
        });
      }

      // Log subscription event
      try {
        await subscriptionEventRepository.create(id, 'tier_changed', previousTier, newTier, null, null, { source: 'admin' });
      } catch (logErr) {
        logger.error('Failed to log tier change event', { userId: id, error: logErr });
      }

      return { message: `Tier changed from ${previousTier} to ${newTier}`, tier: newTier };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // POST /api/v1/admin/users/:id/reset-password
  fastify.post('/users/:id/reset-password', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(request, reply)) return reply;
    const { id } = request.params as { id: string };

    try {
      const user = await userService.findById(id);
      if (!user) {
        return reply.status(404).send({ error: 'Not found', message: 'User not found' });
      }

      const resetToken = crypto.randomUUID();
      const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await userService.update(id, {
        passwordResetToken: resetToken,
        passwordResetExpires: resetExpires,
      });

      return { message: 'Password reset token generated', resetToken };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // POST /api/v1/admin/users/:id/clear-login-token
  fastify.post('/users/:id/clear-login-token', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(request, reply)) return reply;
    const { id } = request.params as { id: string };

    try {
      const user = await userService.findById(id);
      if (!user) {
        return reply.status(404).send({ error: 'Not found', message: 'User not found' });
      }

      await userService.update(id, {
        loginVerificationToken: null,
        loginVerificationExpires: null,
      });

      return { message: 'Login verification token cleared' };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // PATCH /api/v1/admin/users/:id/budget
  fastify.patch('/users/:id/budget', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(request, reply)) return reply;
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { budget?: number | null };

    if (body.budget !== null && body.budget !== undefined) {
      if (typeof body.budget !== 'number' || body.budget < 0 || !Number.isFinite(body.budget)) {
        return reply.status(400).send({ error: 'Bad request', message: 'budget must be a non-negative number or null' });
      }
    }

    try {
      const updated = await userService.update(id, {
        aiMonthlyTokenBudget: body.budget ?? null,
      });
      if (!updated) {
        return reply.status(404).send({ error: 'Not found', message: 'User not found' });
      }
      return { message: 'AI budget updated', ai_monthly_token_budget: body.budget ?? null };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /api/v1/admin/stats
  fastify.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(request, reply)) return reply;
    try {
      const rows = await databaseService.queryControlPlane(
        `SELECT
          (SELECT COUNT(*) FROM users WHERE NOT ${neverConfirmedSql()}) AS total_users,
          (SELECT COUNT(*) FROM users WHERE is_active = 1 AND NOT ${neverConfirmedSql()}) AS active_users,
          (SELECT COUNT(*) FROM users WHERE ${neverConfirmedSql()}) AS never_confirmed_users,
          (SELECT COUNT(*) FROM projects) AS total_projects,
          -- AI usage rows are kept 400 days (DataRetentionService), so these are "last 400 days" totals
          (SELECT COUNT(*) FROM ai_usage_log) AS total_ai_calls,
          (SELECT COALESCE(SUM(cost_estimate), 0) FROM ai_usage_log) AS total_ai_cost,
          (SELECT COALESCE(SUM(input_tokens + output_tokens), 0) FROM ai_usage_log) AS total_tokens`
      );
      return { stats: rows[0] ?? {} };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /api/v1/admin/audit — cross-project audit trail (admin only)
  fastify.get('/audit', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(request, reply)) return reply;
    try {
      const q = request.query as {
        limit?: string; offset?: string;
        action?: string; entityType?: string; since?: string;
      };
      const result = await auditLedgerService.getEntries({
        // A negative limit reached SQL as `LIMIT -5` (a 500); now it falls back to 100 (2026-10-07)
        ...clampPagination(q, { defaultLimit: 100, maxLimit: 500 }),
        action: q.action || undefined,
        entityType: q.entityType || undefined,
        since: q.since || undefined,
      });
      return { entries: result.entries, total: result.total };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /api/v1/admin/ai-usage
  fastify.get('/ai-usage', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(request, reply)) return reply;
    try {
      const q = request.query as { since?: string };
      const sinceClause = q.since ? 'AND a.created_at >= ?' : '';
      const sinceParams = q.since ? [q.since] : [];

      // Per-user breakdown
      const rows = await databaseService.queryControlPlane(
        `SELECT
          u.username, u.email, u.full_name,
          COUNT(a.id) AS call_count,
          COALESCE(SUM(a.input_tokens + a.output_tokens), 0) AS total_tokens,
          COALESCE(SUM(a.cost_estimate), 0) AS total_cost,
          MAX(a.created_at) AS last_used
        FROM users u
        LEFT JOIN ai_usage_log a ON a.user_id = u.id ${sinceClause}
        GROUP BY u.id
        ORDER BY total_cost DESC`,
        sinceParams
      );

      // Summary totals (respecting same filter)
      const summaryRows = await databaseService.queryControlPlane(
        `SELECT
          COUNT(*) AS total_calls,
          COALESCE(SUM(input_tokens + output_tokens), 0) AS total_tokens,
          COALESCE(SUM(cost_estimate), 0) AS total_cost
        FROM ai_usage_log ${q.since ? 'WHERE created_at >= ?' : ''}`,
        sinceParams
      );

      // Daily trend (last 30 days)
      const dailyRows = await databaseService.queryControlPlane(
        `SELECT
          DATE(created_at) AS day,
          COUNT(*) AS calls,
          COALESCE(SUM(cost_estimate), 0) AS cost
        FROM ai_usage_log
        WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        GROUP BY DATE(created_at)
        ORDER BY day`
      );

      return {
        usage: rows,
        summary: summaryRows[0] ?? { total_calls: 0, total_tokens: 0, total_cost: 0 },
        dailyTrend: dailyRows,
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /api/v1/admin/config — System configuration overview
  fastify.get('/config', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(request, reply)) return reply;
    try {
      // Feature flags
      const features = [
        { key: 'AI_ENABLED', label: 'AI / Claude', enabled: config.AI_ENABLED, detail: config.AI_ENABLED ? config.AI_MODEL : undefined },
        { key: 'AI_FALLBACK_ENABLED', label: 'AI Fallback', enabled: config.AI_FALLBACK_ENABLED, detail: config.AI_FALLBACK_ENABLED ? config.AI_FALLBACK_MODEL : undefined },
        { key: 'AGENT_ENABLED', label: 'Autonomous Agents', enabled: config.AGENT_ENABLED },
        { key: 'EMBEDDING_ENABLED', label: 'Embeddings / RAG', enabled: config.EMBEDDING_ENABLED, detail: config.EMBEDDING_ENABLED ? config.EMBEDDING_MODEL : undefined },
        { key: 'MULTI_TENANT_ENABLED', label: 'Multi-Tenant', enabled: config.MULTI_TENANT_ENABLED },
        { key: 'METRICS_ENABLED', label: 'Metrics Collection', enabled: config.METRICS_ENABLED },
        { key: 'ALERT_ENABLED', label: 'Alerting', enabled: config.ALERT_ENABLED, detail: config.ALERT_ENABLED ? (config.ALERT_EMAIL || 'No email set') : undefined },
      ];

      // Service connectivity
      const services = [
        { key: 'redis', label: 'Redis', connected: redisService.isConnected(), detail: config.REDIS_URL ? 'Configured' : 'Not configured (in-memory fallback)' },
        { key: 'email', label: 'Email (Resend)', connected: !!config.RESEND_API_KEY, detail: config.RESEND_API_KEY ? `From: ${config.RESEND_FROM_EMAIL}` : 'RESEND_API_KEY not set' },
        { key: 'stripe', label: 'Stripe Billing', connected: !!config.STRIPE_SECRET_KEY, detail: config.STRIPE_SECRET_KEY ? 'Configured' : 'Not configured' },
        { key: 'anthropic', label: 'Anthropic API', connected: !!config.ANTHROPIC_API_KEY, detail: config.ANTHROPIC_API_KEY ? 'Key set' : 'Key not set' },
        { key: 'openai', label: 'OpenAI (Embeddings)', connected: !!config.OPENAI_API_KEY, detail: config.OPENAI_API_KEY ? 'Key set' : 'Key not set' },
      ];

      // Database connectivity check
      let dbConnected = false;
      let dbVersion = '';
      try {
        const vRows = await databaseService.queryControlPlane<{ version: string }>(`SELECT VERSION() as version`);
        dbConnected = true;
        dbVersion = vRows[0]?.version || '';
      } catch { /* */ }

      // Migration count
      let migrationCount = 0;
      try {
        const mRows = await databaseService.queryControlPlane<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM _migrations`);
        migrationCount = Number(mRows[0]?.cnt || 0);
      } catch { /* table may not exist */ }

      // Agent counts
      let agentTotal = 0, agentEnabled = 0;
      try {
        const aRows = await databaseService.queryControlPlane<{ total: number; enabled: number }>(
          `SELECT COUNT(*) as total, SUM(CASE WHEN is_enabled = 1 THEN 1 ELSE 0 END) as enabled FROM agents`
        );
        agentTotal = Number(aRows[0]?.total || 0);
        agentEnabled = Number(aRows[0]?.enabled || 0);
      } catch { /* */ }

      // Environment info
      const environment = {
        nodeVersion: process.version,
        platform: `${os.type()} ${os.release()} (${os.arch()})`,
        env: config.NODE_ENV,
        port: config.PORT,
        appUrl: config.APP_URL,
        corsOrigin: config.CORS_ORIGIN,
        logLevel: config.LOG_LEVEL,
        dbHost: config.DB_HOST,
        dbName: config.DB_NAME,
        dbConnected,
        dbVersion,
        dbPoolSize: config.DB_CONNECTION_LIMIT,
        migrationCount,
      };

      // AI configuration
      const aiConfig = {
        model: config.AI_MODEL,
        fallbackModel: config.AI_FALLBACK_MODEL,
        temperature: config.AI_TEMPERATURE,
        maxTokens: config.AI_MAX_TOKENS,
        monthlyTokenBudget: config.AI_MONTHLY_TOKEN_BUDGET,
        pricingInput: config.AI_PRICING_INPUT,
        pricingOutput: config.AI_PRICING_OUTPUT,
      };

      // Agent configuration
      const agentConfig = {
        cronSchedule: config.AGENT_CRON_SCHEDULE,
        delayThresholdDays: config.AGENT_DELAY_THRESHOLD_DAYS,
        budgetCpiThreshold: config.AGENT_BUDGET_CPI_THRESHOLD,
        budgetOverrunThreshold: config.AGENT_BUDGET_OVERRUN_THRESHOLD,
        mcConfidenceLevel: config.AGENT_MC_CONFIDENCE_LEVEL,
        overdueScanMinutes: config.AGENT_OVERDUE_SCAN_MINUTES,
        totalAgents: agentTotal,
        enabledAgents: agentEnabled,
      };

      // Upload / storage config
      const storageConfig = {
        uploadDir: config.UPLOAD_DIR,
        maxUploadSizeMB: config.MAX_UPLOAD_SIZE_MB,
      };

      // Tier budget defaults
      const tierBudgets = {
        trial: config.AI_TIER_BUDGET_TRIAL,
        consultant_basic: config.AI_TIER_BUDGET_CONSULTANT_BASIC,
        consultant_pro: config.AI_TIER_BUDGET_CONSULTANT_PRO,
        sme: config.AI_TIER_BUDGET_SME,
        enterprise: config.AI_TIER_BUDGET_ENTERPRISE,
        topUpTokens: config.AI_TOPUP_TOKENS,
        topUpPriceCents: config.AI_TOPUP_PRICE_CENTS,
      };

      return {
        features,
        services,
        environment,
        aiConfig,
        agentConfig,
        storageConfig,
        tierBudgets,
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /api/v1/admin/pricing — all tiers + features
  fastify.get('/pricing', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(request, reply)) return reply;
    try {
      const tiers = await pricingConfigRepository.findAllActive();
      const features = await pricingConfigRepository.getAllFeatures();
      return { tiers, features };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // PUT /api/v1/admin/pricing/:tier — update tier config
  fastify.put('/pricing/:tier', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(request, reply)) return reply;
    const { tier } = request.params as { tier: string };
    const parsed = pricingTierUpdateSchema.safeParse(request.body ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const body = parsed.data;

    try {
      const existing = await pricingConfigRepository.findByTier(tier);
      if (!existing) {
        return reply.status(404).send({ error: 'Tier not found' });
      }

      await pricingConfigRepository.updateTier(tier, body);
      await pricingConfigService.invalidateCache();

      const updated = await pricingConfigRepository.findByTier(tier);
      return { tier: updated };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // PUT /api/v1/admin/pricing/:tier/features — update feature toggles
  fastify.put('/pricing/:tier/features', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(request, reply)) return reply;
    const { tier } = request.params as { tier: string };
    const parsed = tierFeaturesUpdateSchema.safeParse(request.body ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const body = parsed.data;

    try {
      await pricingConfigRepository.setFeaturesBulk(tier, body);
      await pricingConfigService.invalidateCache();

      const features = await pricingConfigRepository.getFeatures(tier);
      return { features };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /api/v1/admin/usage-analytics — Agent & feature usage analytics
  fastify.get('/usage-analytics', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(request, reply)) return reply;
    try {
      const q = request.query as { days?: string };
      const days = Math.min(Math.max(parseInt(q.days || '30', 10) || 30, 1), 365);
      const sinceDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

      // 1. Agent usage frequency
      const agentUsage = await databaseService.queryControlPlane(
        `SELECT agent_id, COUNT(*) AS runs, COUNT(DISTINCT entity_id) AS unique_projects,
                MIN(created_at) AS first_run, MAX(created_at) AS last_run
         FROM agent_memory WHERE memory_type = 'reflection' AND created_at >= ?
         GROUP BY agent_id ORDER BY runs DESC`,
        [sinceDate]
      );

      // 2. Sequential agent patterns (agent B triggered within 30 min of agent A on same project)
      const agentPatterns = await databaseService.queryControlPlane(
        `SELECT a1.agent_id AS first_agent, a2.agent_id AS second_agent, COUNT(*) AS frequency
         FROM agent_memory a1
         JOIN agent_memory a2 ON a1.entity_id = a2.entity_id
           AND a2.created_at BETWEEN a1.created_at AND DATE_ADD(a1.created_at, INTERVAL 30 MINUTE)
           AND a1.agent_id != a2.agent_id
           AND a1.id != a2.id
         WHERE a1.memory_type = 'reflection' AND a2.memory_type = 'reflection'
           AND a1.created_at >= ?
         GROUP BY first_agent, second_agent
         HAVING frequency >= 2
         ORDER BY frequency DESC
         LIMIT 20`,
        [sinceDate]
      );

      // 3. Feature usage (top actions from every company's audit trail — counts only)
      const featureUsage = mergeGroups(
        await selectAcrossCompanies(
          `SELECT action, COUNT(*) AS call_count, COUNT(DISTINCT actor_id) AS unique_users
           FROM audit_ledger WHERE created_at >= ? GROUP BY action`,
          [sinceDate],
        ),
        'action', ['call_count', 'unique_users'],
      ).sort((a, b) => Number(b.call_count) - Number(a.call_count)).slice(0, 25);

      // 4. Mjuzi chat stats (counts across every company; never the conversations themselves)
      const chatTotals = sumRows(
        await selectAcrossCompanies(
          `SELECT COUNT(DISTINCT c.id) AS conversations, COUNT(m.id) AS messages,
                  COUNT(DISTINCT c.user_id) AS active_chatters
           FROM chat_conversations c
           LEFT JOIN chat_messages m ON m.conversation_id = c.id AND m.created_at >= ?
           WHERE c.created_at >= ?`,
          [sinceDate, sinceDate],
        ),
        ['conversations', 'messages', 'active_chatters'],
      );
      const chatStats = [chatTotals];

      // 5. Daily agent runs (for chart)
      const dailyAgentRuns = await databaseService.queryControlPlane(
        `SELECT DATE(created_at) AS day, COUNT(*) AS runs
         FROM agent_memory WHERE memory_type = 'reflection' AND created_at >= ?
         GROUP BY DATE(created_at) ORDER BY day`,
        [sinceDate]
      );

      return {
        agentUsage,
        agentPatterns,
        featureUsage,
        chatStats: chatStats[0] ?? { conversations: 0, messages: 0, active_chatters: 0 },
        dailyAgentRuns,
        period: { days, since: sinceDate },
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
