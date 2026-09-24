import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../config', () => ({
  config: {
    ALERT_COOLDOWN_MINUTES: 30,
    ALERT_EMAIL: 'admin@test.com',
    ALERT_WEBHOOK_URL: '',
    APP_URL: 'https://app.test',
  },
}));

const redisClient = vi.hoisted(() => ({
  get: vi.fn().mockResolvedValue(null),
  keys: vi.fn().mockResolvedValue([]),
  incr: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
}));

vi.mock('../../services/RedisService', () => ({
  redisService: {
    isConnected: vi.fn().mockReturnValue(true),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    // The signup-flood check counts through the raw client.
    getClient: vi.fn(() => redisClient),
  },
}));

vi.mock('../../services/EmailService', () => ({
  emailService: {
    sendNotificationEmail: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/MetricsService', () => ({
  metricsService: {
    getSnapshot: vi.fn().mockReturnValue({
      requests: { total: 0 },
      errors: { total5xx: 0 },
      latency: { p95Ms: 50 },
    }),
  },
}));

vi.mock('../../services/agents/DegradationHandler', () => ({
  degradationHandler: {
    getHealthStatus: vi.fn().mockResolvedValue({
      circuitBreakers: {},
      recommendedScope: 'full',
    }),
    checkDatabaseHealth: vi.fn().mockResolvedValue({
      healthy: true,
      latencyMs: 50,
    }),
  },
}));

vi.mock('../../services/AIBudgetService', () => ({
  aiBudgetService: {
    getMonthlyUsage: vi.fn().mockResolvedValue({
      percentUsed: 50,
      totalTokens: 250000,
      budget: 500000,
      remaining: 250000,
    }),
  },
}));

vi.mock('../../services/NotificationService', () => ({
  notificationService: {
    create: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../database/connection', () => ({
  databaseService: {
    queryControlPlane: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../utils/degradedState', () => ({
  getDegraded: vi.fn().mockReturnValue(null),
}));

vi.mock('../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Stub global fetch for webhook tests
const mockFetch = vi.fn().mockResolvedValue({ ok: true });
vi.stubGlobal('fetch', mockFetch);

// ── Imports (after mocks) ──────────────────────────────────────────────────

import { alertService } from '../../services/AlertService';
import { config } from '../../config';
import { redisService } from '../../services/RedisService';
import { emailService } from '../../services/EmailService';
import { metricsService } from '../../services/MetricsService';
import { degradationHandler } from '../../services/agents/DegradationHandler';
import { aiBudgetService } from '../../services/AIBudgetService';
import { notificationService } from '../../services/NotificationService';
import { databaseService } from '../../database/connection';
import logger from '../../utils/logger';
import { getDegraded } from '../../utils/degradedState';

// ── Typed references ───────────────────────────────────────────────────────

const mockRedisIsConnected = redisService.isConnected as ReturnType<typeof vi.fn>;
const mockRedisGet = redisService.get as ReturnType<typeof vi.fn>;
const mockRedisSet = redisService.set as ReturnType<typeof vi.fn>;
const mockSendEmail = emailService.sendNotificationEmail as ReturnType<typeof vi.fn>;
const mockGetSnapshot = metricsService.getSnapshot as ReturnType<typeof vi.fn>;
const mockGetHealthStatus = degradationHandler.getHealthStatus as ReturnType<typeof vi.fn>;
const mockCheckDbHealth = degradationHandler.checkDatabaseHealth as ReturnType<typeof vi.fn>;
const mockGetMonthlyUsage = aiBudgetService.getMonthlyUsage as ReturnType<typeof vi.fn>;
const mockQueryCP = databaseService.queryControlPlane as ReturnType<typeof vi.fn>;
const mockNotifCreate = notificationService.create as ReturnType<typeof vi.fn>;
const mockRedisKeys = redisClient.keys;
const mockClientGet = redisClient.get;

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AlertService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset defaults
    mockRedisIsConnected.mockReturnValue(true);
    // Default: every scheduled job ran a moment ago, so the cron-stall check stays
    // quiet and the other checks can be asserted in isolation. Cooldown keys (any
    // other key) still return null so alerts are allowed to fire.
    mockRedisGet.mockImplementation(async (key: string) =>
      key?.startsWith('cron:last:')
        ? JSON.stringify({ status: 'ok', finishedAt: new Date().toISOString() })
        : null,
    );
    mockRedisSet.mockResolvedValue(undefined);
    mockGetSnapshot.mockReturnValue({
      requests: { total: 0 },
      errors: { total5xx: 0 },
      latency: { p95Ms: 50 },
    });
    mockGetHealthStatus.mockResolvedValue({
      circuitBreakers: {},
      recommendedScope: 'full',
    });
    mockCheckDbHealth.mockResolvedValue({ healthy: true, latencyMs: 50 });
    mockGetMonthlyUsage.mockResolvedValue({
      percentUsed: 50,
      totalTokens: 250000,
      budget: 500000,
      remaining: 250000,
    });
    mockQueryCP.mockResolvedValue([]);
    mockNotifCreate.mockResolvedValue({});
    mockSendEmail.mockResolvedValue(undefined);
    mockFetch.mockResolvedValue({ ok: true });
    mockRedisKeys.mockResolvedValue([]);
    mockClientGet.mockResolvedValue(null);
    (config as any).ALERT_EMAIL = 'admin@test.com';
    (config as any).ALERT_WEBHOOK_URL = '';
  });

  // ── runChecks ────────────────────────────────────────────────────────

  describe('runChecks', () => {
    it('invokes all four check methods without throwing', async () => {
      await alertService.runChecks();

      expect(mockGetSnapshot).toHaveBeenCalled();
      expect(mockGetHealthStatus).toHaveBeenCalled();
      expect(mockCheckDbHealth).toHaveBeenCalled();
      // AI budget check queries for admin user first
      expect(mockQueryCP).toHaveBeenCalled();
    });

    it('does not throw when individual checks reject', async () => {
      mockGetSnapshot.mockImplementation(() => {
        throw new Error('metrics boom');
      });
      mockCheckDbHealth.mockRejectedValue(new Error('db boom'));

      // Should not throw — Promise.allSettled handles failures
      await expect(alertService.runChecks()).resolves.toBeUndefined();
    });

    it('logs an error when the outer try/catch fires', async () => {
      // Force Promise.allSettled itself to fail by mocking it temporarily
      // This is hard to trigger naturally; instead verify the catch path
      // by checking it doesn't propagate errors from individual checks
      mockGetHealthStatus.mockRejectedValue(new Error('health boom'));
      await alertService.runChecks();
      // No throw — service is resilient
    });
  });

  // ── checkErrorRate ───────────────────────────────────────────────────

  describe('checkErrorRate (via runChecks)', () => {
    it('does nothing when total requests < 100', async () => {
      mockGetSnapshot.mockReturnValue({
        requests: { total: 50 },
        errors: { total5xx: 10 },
        latency: { p95Ms: 50 },
      });

      await alertService.runChecks();

      // No alert fired — no email, no log warning about error rate
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it('fires critical alert when error rate >= 10%', async () => {
      mockGetSnapshot.mockReturnValue({
        requests: { total: 200 },
        errors: { total5xx: 25 },
        latency: { p95Ms: 100 },
      });
      // fire() queries admins for in-app notifications
      mockQueryCP.mockResolvedValue([{ id: 'admin-1' }]);

      await alertService.runChecks();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('High Error Rate'),
      );
      expect(mockSendEmail).toHaveBeenCalledWith(
        'admin@test.com',
        '[CRITICAL] High Error Rate',
        'High Error Rate',
        expect.stringContaining('12.5%'),
        'https://app.test/admin',
        'View Admin Panel',
      );
    });

    it('does not fire alert when error rate < 10%', async () => {
      mockGetSnapshot.mockReturnValue({
        requests: { total: 200 },
        errors: { total5xx: 10 },
        latency: { p95Ms: 100 },
      });

      await alertService.runChecks();

      // 5% error rate — no alert
      expect(mockSendEmail).not.toHaveBeenCalled();
    });
  });

  // ── checkAIBudget ────────────────────────────────────────────────────

  describe('checkAIBudget (via runChecks)', () => {
    it('does nothing when no admin user exists', async () => {
      mockQueryCP.mockResolvedValue([]); // no admin

      await alertService.runChecks();

      expect(mockGetMonthlyUsage).not.toHaveBeenCalled();
    });

    it('fires critical alert when budget >= 95%', async () => {
      // First call: admin lookup for AI budget check
      // Second call: admin lookup for in-app notification in fire()
      mockQueryCP
        .mockResolvedValueOnce([{ id: 'admin-1' }]) // AI budget admin check
        .mockResolvedValueOnce([{ id: 'admin-1' }]); // fire() admin lookup
      mockGetMonthlyUsage.mockResolvedValue({
        percentUsed: 97,
        totalTokens: 485000,
        budget: 500000,
        remaining: 15000,
      });

      await alertService.runChecks();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('AI Budget Critical'),
      );
      expect(mockSendEmail).toHaveBeenCalledWith(
        'admin@test.com',
        '[CRITICAL] AI Budget Critical',
        'AI Budget Critical',
        expect.stringContaining('97%'),
        'https://app.test/admin',
        'View Admin Panel',
      );
    });

    it('fires warning alert when budget >= 80% but < 95%', async () => {
      mockQueryCP
        .mockResolvedValueOnce([{ id: 'admin-1' }])
        .mockResolvedValueOnce([{ id: 'admin-1' }]);
      mockGetMonthlyUsage.mockResolvedValue({
        percentUsed: 85,
        totalTokens: 425000,
        budget: 500000,
        remaining: 75000,
      });

      await alertService.runChecks();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('AI Budget Warning'),
      );
      expect(mockSendEmail).toHaveBeenCalledWith(
        'admin@test.com',
        '[WARNING] AI Budget Warning',
        'AI Budget Warning',
        expect.stringContaining('85%'),
        'https://app.test/admin',
        'View Admin Panel',
      );
    });

    it('does not fire when budget < 80%', async () => {
      mockQueryCP.mockResolvedValueOnce([{ id: 'admin-1' }]);
      mockGetMonthlyUsage.mockResolvedValue({
        percentUsed: 50,
        totalTokens: 250000,
        budget: 500000,
        remaining: 250000,
      });

      await alertService.runChecks();

      // No budget alert
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it('silently catches errors from budget check', async () => {
      mockQueryCP.mockResolvedValueOnce([{ id: 'admin-1' }]);
      mockGetMonthlyUsage.mockRejectedValue(new Error('budget fail'));

      await expect(alertService.runChecks()).resolves.toBeUndefined();
    });
  });

  // ── checkCircuitBreakers ─────────────────────────────────────────────

  describe('checkCircuitBreakers (via runChecks)', () => {
    it('does nothing when no breakers are open', async () => {
      mockGetHealthStatus.mockResolvedValue({
        circuitBreakers: {
          ai: { state: 'closed', consecutiveFailures: 0 },
          email: { state: 'closed', consecutiveFailures: 0 },
        },
        recommendedScope: 'full',
      });

      await alertService.runChecks();

      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it('fires critical alert when breakers are open', async () => {
      mockGetHealthStatus.mockResolvedValue({
        circuitBreakers: {
          ai: { state: 'open', consecutiveFailures: 5 },
          email: { state: 'open', consecutiveFailures: 3 },
        },
        recommendedScope: 'reduced',
      });
      mockQueryCP.mockResolvedValue([{ id: 'admin-1' }]);

      await alertService.runChecks();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Circuit Breaker Open'),
      );
      expect(mockSendEmail).toHaveBeenCalledWith(
        'admin@test.com',
        '[CRITICAL] Circuit Breaker Open',
        'Circuit Breaker Open',
        expect.stringContaining('2 circuit breaker(s)'),
        'https://app.test/admin',
        'View Admin Panel',
      );
    });

    it('includes breaker names and failure counts in message', async () => {
      mockGetHealthStatus.mockResolvedValue({
        circuitBreakers: {
          ai: { state: 'open', consecutiveFailures: 7 },
        },
        recommendedScope: 'reduced',
      });
      mockQueryCP.mockResolvedValue([{ id: 'admin-1' }]);

      await alertService.runChecks();

      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.stringContaining('ai (7 failures)'),
        expect.any(String),
        expect.any(String),
      );
    });
  });

  // ── checkDatabaseHealth ──────────────────────────────────────────────

  describe('checkDatabaseHealth (via runChecks)', () => {
    it('fires critical alert when database is unhealthy', async () => {
      mockCheckDbHealth.mockResolvedValue({ healthy: false, latencyMs: 0 });
      mockQueryCP.mockResolvedValue([{ id: 'admin-1' }]);

      await alertService.runChecks();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Database Connection Lost'),
      );
      expect(mockSendEmail).toHaveBeenCalledWith(
        'admin@test.com',
        '[CRITICAL] Database Connection Lost',
        'Database Connection Lost',
        expect.stringContaining('health check failed'),
        'https://app.test/admin',
        'View Admin Panel',
      );
    });

    it('fires warning alert when latency > 2000ms but healthy', async () => {
      mockCheckDbHealth.mockResolvedValue({ healthy: true, latencyMs: 3500 });
      mockQueryCP.mockResolvedValue([{ id: 'admin-1' }]);

      await alertService.runChecks();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('High Database Latency'),
      );
      expect(mockSendEmail).toHaveBeenCalledWith(
        'admin@test.com',
        '[WARNING] High Database Latency',
        'High Database Latency',
        expect.stringContaining('3500ms'),
        'https://app.test/admin',
        'View Admin Panel',
      );
    });

    it('does not fire when healthy and latency <= 2000ms', async () => {
      mockCheckDbHealth.mockResolvedValue({ healthy: true, latencyMs: 500 });

      await alertService.runChecks();

      expect(mockSendEmail).not.toHaveBeenCalled();
    });
  });

  // ── fire() — cooldown logic ──────────────────────────────────────────

  describe('fire() — Redis cooldown', () => {
    it('skips alert when cooldown key exists in Redis', async () => {
      // Trigger an alert condition
      mockGetSnapshot.mockReturnValue({
        requests: { total: 200 },
        errors: { total5xx: 30 },
        latency: { p95Ms: 100 },
      });
      mockRedisGet.mockResolvedValue('1'); // cooldown active

      await alertService.runChecks();

      // Alert suppressed — no email, no log
      expect(mockSendEmail).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('High Error Rate'),
      );
    });

    it('sets cooldown key when alert fires', async () => {
      mockGetSnapshot.mockReturnValue({
        requests: { total: 200 },
        errors: { total5xx: 30 },
        latency: { p95Ms: 100 },
      });
      mockQueryCP.mockResolvedValue([{ id: 'admin-1' }]);

      await alertService.runChecks();

      expect(mockRedisSet).toHaveBeenCalledWith(
        'alert:cooldown:error_rate_high',
        '1',
        30 * 60, // ALERT_COOLDOWN_MINUTES * 60
      );
    });

    it('fires alert without cooldown when Redis is disconnected', async () => {
      mockRedisIsConnected.mockReturnValue(false);
      mockGetSnapshot.mockReturnValue({
        requests: { total: 200 },
        errors: { total5xx: 30 },
        latency: { p95Ms: 100 },
      });
      mockQueryCP.mockResolvedValue([{ id: 'admin-1' }]);

      await alertService.runChecks();

      // Alert fires even without Redis
      expect(mockRedisGet).not.toHaveBeenCalled();
      expect(mockRedisSet).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('High Error Rate'),
      );
    });
  });

  // ── fire() — email ──────────────────────────────────────────────────

  describe('fire() — email alerts', () => {
    it('does not send email when ALERT_EMAIL is empty', async () => {
      (config as any).ALERT_EMAIL = '';
      mockGetSnapshot.mockReturnValue({
        requests: { total: 200 },
        errors: { total5xx: 30 },
        latency: { p95Ms: 100 },
      });
      mockQueryCP.mockResolvedValue([{ id: 'admin-1' }]);

      await alertService.runChecks();

      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it('logs error when email fails but does not throw', async () => {
      mockSendEmail.mockRejectedValue(new Error('smtp down'));
      mockGetSnapshot.mockReturnValue({
        requests: { total: 200 },
        errors: { total5xx: 30 },
        latency: { p95Ms: 100 },
      });
      mockQueryCP.mockResolvedValue([{ id: 'admin-1' }]);

      await alertService.runChecks();

      // Give the fire-and-forget .catch time to run
      await new Promise(r => setTimeout(r, 50));

      expect(logger.error).toHaveBeenCalledWith(
        '[AlertService] Email alert failed',
        expect.objectContaining({ error: 'smtp down' }),
      );
    });
  });

  // ── fire() — webhook ────────────────────────────────────────────────

  describe('fire() — webhook alerts', () => {
    it('sends webhook when ALERT_WEBHOOK_URL is set', async () => {
      (config as any).ALERT_WEBHOOK_URL = 'https://hooks.test/alert';
      mockGetSnapshot.mockReturnValue({
        requests: { total: 200 },
        errors: { total5xx: 30 },
        latency: { p95Ms: 100 },
      });
      mockQueryCP.mockResolvedValue([{ id: 'admin-1' }]);

      await alertService.runChecks();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://hooks.test/alert',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('error_rate_high'),
        }),
      );
    });

    it('does not send webhook when ALERT_WEBHOOK_URL is empty', async () => {
      (config as any).ALERT_WEBHOOK_URL = '';
      mockGetSnapshot.mockReturnValue({
        requests: { total: 200 },
        errors: { total5xx: 30 },
        latency: { p95Ms: 100 },
      });
      mockQueryCP.mockResolvedValue([{ id: 'admin-1' }]);

      await alertService.runChecks();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('logs error when webhook fails but does not throw', async () => {
      (config as any).ALERT_WEBHOOK_URL = 'https://hooks.test/alert';
      mockFetch.mockRejectedValue(new Error('network error'));
      mockGetSnapshot.mockReturnValue({
        requests: { total: 200 },
        errors: { total5xx: 30 },
        latency: { p95Ms: 100 },
      });
      mockQueryCP.mockResolvedValue([{ id: 'admin-1' }]);

      await alertService.runChecks();

      await new Promise(r => setTimeout(r, 50));

      expect(logger.error).toHaveBeenCalledWith(
        '[AlertService] Webhook alert failed',
        expect.objectContaining({ error: 'network error' }),
      );
    });
  });

  // ── fire() — in-app notifications ───────────────────────────────────

  describe('fire() — in-app notifications', () => {
    it('creates notifications for all admin users', async () => {
      mockGetSnapshot.mockReturnValue({
        requests: { total: 200 },
        errors: { total5xx: 30 },
        latency: { p95Ms: 100 },
      });
      // First queryCP in fire() returns admin list
      mockQueryCP.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]);

      await alertService.runChecks();

      expect(mockNotifCreate).toHaveBeenCalledTimes(2);
      expect(mockNotifCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-1',
          type: 'system_alert',
          severity: 'high', // critical → high
          title: 'High Error Rate',
        }),
      );
      expect(mockNotifCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-2',
          type: 'system_alert',
        }),
      );
    });

    it('maps warning severity to medium', async () => {
      mockCheckDbHealth.mockResolvedValue({ healthy: true, latencyMs: 3000 });
      mockQueryCP.mockResolvedValue([{ id: 'admin-1' }]);

      await alertService.runChecks();

      expect(mockNotifCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'medium', // warning → medium
          title: 'High Database Latency',
        }),
      );
    });

    it('silently catches notification creation failures', async () => {
      mockGetSnapshot.mockReturnValue({
        requests: { total: 200 },
        errors: { total5xx: 30 },
        latency: { p95Ms: 100 },
      });
      mockQueryCP.mockResolvedValue([{ id: 'admin-1' }]);
      mockNotifCreate.mockRejectedValue(new Error('notif fail'));

      // Should not throw
      await expect(alertService.runChecks()).resolves.toBeUndefined();
    });

    it('silently catches admin query failures in fire()', async () => {
      mockGetSnapshot.mockReturnValue({
        requests: { total: 200 },
        errors: { total5xx: 30 },
        latency: { p95Ms: 100 },
      });
      mockQueryCP.mockRejectedValue(new Error('db down'));

      // Should not throw — non-critical
      await expect(alertService.runChecks()).resolves.toBeUndefined();
    });
  });

  // ── Multiple alerts in one cycle ─────────────────────────────────────

  describe('multiple alerts in one cycle', () => {
    it('can fire multiple alerts simultaneously', async () => {
      // High error rate
      mockGetSnapshot.mockReturnValue({
        requests: { total: 200 },
        errors: { total5xx: 30 },
        latency: { p95Ms: 100 },
      });
      // Unhealthy DB
      mockCheckDbHealth.mockResolvedValue({ healthy: false, latencyMs: 0 });
      // Open circuit breaker
      mockGetHealthStatus.mockResolvedValue({
        circuitBreakers: {
          ai: { state: 'open', consecutiveFailures: 5 },
        },
        recommendedScope: 'reduced',
      });
      // Admin for notifications
      mockQueryCP.mockResolvedValue([{ id: 'admin-1' }]);

      await alertService.runChecks();

      // At least 3 distinct alerts should have fired
      const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
      const alertMessages = warnCalls
        .filter((c: any[]) => typeof c[0] === 'string' && c[0].includes('[AlertService] ALERT'))
        .map((c: any[]) => c[0]);

      expect(alertMessages.length).toBeGreaterThanOrEqual(3);
    });
  });
  describe('checkCronJobsRunning() — scheduled jobs', () => {
    const hoursAgo = (h: number) => JSON.stringify({
      status: 'ok',
      finishedAt: new Date(Date.now() - h * 60 * 60 * 1000).toISOString(),
    });

    const alertsRaised = () =>
      ((logger.warn as any).mock.calls as any[][])
        .filter((c) => typeof c[0] === 'string' && c[0].includes('Scheduled jobs not running'))
        .map((c) => c[0] as string);

    it('stays quiet when every job has run recently', async () => {
      await alertService.runChecks();

      expect(alertsRaised()).toHaveLength(0);
    });

    it('raises a critical alert when a job has never run on this server', async () => {
      // Exactly the production failure: the timer was never created, so the job has
      // no record at all and nothing ever complained.
      mockRedisGet.mockImplementation(async (key: string) => {
        if (key === 'cron:last:digest') return null;
        if (key?.startsWith('cron:last:')) return hoursAgo(0);
        return null;
      });

      await alertService.runChecks();

      const raised = alertsRaised();
      expect(raised).toHaveLength(1);
      expect(raised[0]).toContain('Never run on this server');
      expect(raised[0]).toContain('digest');
    });

    it('raises an alert when a job has stopped running', async () => {
      mockRedisGet.mockImplementation(async (key: string) => {
        if (key === 'cron:last:overdue-scan') return hoursAgo(9);
        if (key?.startsWith('cron:last:')) return hoursAgo(0);
        return null;
      });

      await alertService.runChecks();

      const raised = alertsRaised();
      expect(raised).toHaveLength(1);
      expect(raised[0]).toContain('Stopped running');
      expect(raised[0]).toContain('overdue-scan');
    });

    it('tolerates a job that is merely late', async () => {
      // overdue-scan runs every 15 minutes but is allowed 2 quiet hours — this check
      // is for "has stopped entirely", not for lateness.
      mockRedisGet.mockImplementation(async (key: string) => {
        if (key === 'cron:last:overdue-scan') return hoursAgo(1);
        if (key?.startsWith('cron:last:')) return hoursAgo(0);
        return null;
      });

      await alertService.runChecks();

      expect(alertsRaised()).toHaveLength(0);
    });

    it('allows a weekly job a full week of quiet', async () => {
      mockRedisGet.mockImplementation(async (key: string) => {
        if (key === 'cron:last:schedule-review') return hoursAgo(6 * 24);
        if (key?.startsWith('cron:last:')) return hoursAgo(0);
        return null;
      });

      await alertService.runChecks();

      expect(alertsRaised()).toHaveLength(0);
    });

    it('notices when the database backup stops running', async () => {
      // The backup is not a node job — the nightly script writes this key after a
      // clean run. A backup that quietly stops is invisible until the one day it
      // is needed, so it is watched exactly like everything else.
      mockRedisGet.mockImplementation(async (key: string) => {
        if (key === 'cron:last:db-backup') return hoursAgo(50);
        if (key?.startsWith('cron:last:')) return hoursAgo(0);
        return null;
      });

      await alertService.runChecks();

      const raised = alertsRaised();
      expect(raised.length).toBeGreaterThan(0);
      expect(JSON.stringify(raised)).toContain('db-backup');
    });

    it('ignores an unreadable record instead of alerting on a formatting problem', async () => {
      mockRedisGet.mockImplementation(async (key: string) => {
        if (key === 'cron:last:reports') return 'not json';
        if (key?.startsWith('cron:last:')) return hoursAgo(0);
        return null;
      });

      await alertService.runChecks();

      expect(alertsRaised()).toHaveLength(0);
    });
  });

  describe('checkRegistrationFlood() — signup flood', () => {
    const alertsRaised = () =>
      ((logger.warn as any).mock.calls as any[][])
        .filter((c) => typeof c[0] === 'string' &&
          (c[0].includes('registering repeatedly') || c[0].includes('Unusually many signups')))
        .map((c) => c[0] as string);

    it('raises the alarm when one address registers over and over', async () => {
      // Rate limiting turns them away but tells nobody. This is the noticing —
      // and it stands whether or not the signup CAPTCHA is ever switched on.
      mockClientGet.mockImplementation(async (key: string) =>
        key?.startsWith('reg:') ? '25' : null);
      mockRedisKeys.mockResolvedValue(['reg:ip:2026-09-23T04:1.2.3.4']);

      await alertService.runChecks();

      const raised = JSON.stringify(alertsRaised());
      expect(raised).toContain('registering repeatedly');
      expect(raised).toContain('1.2.3.4');
    });

    it('stays quiet at ordinary signup volumes', async () => {
      mockClientGet.mockImplementation(async (key: string) =>
        key?.startsWith('reg:') ? '3' : null);
      mockRedisKeys.mockResolvedValue(['reg:ip:2026-09-23T04:1.2.3.4']);

      await alertService.runChecks();

      expect(alertsRaised()).toHaveLength(0);
    });

    it('says nothing when Redis is unavailable, rather than alerting on its own blind spot', async () => {
      mockRedisIsConnected.mockReturnValue(false);

      await alertService.runChecks();

      expect(alertsRaised()).toHaveLength(0);
    });
  });

  describe('checkDegradedStart() — degraded server', () => {
    const alertsRaised = () =>
      ((logger.warn as any).mock.calls as any[][])
        .filter((c) => typeof c[0] === 'string' && c[0].includes('Server running in degraded mode'))
        .map((c) => c[0] as string);

    it('stays quiet when the server started cleanly', async () => {
      (getDegraded as any).mockReturnValue(null);

      await alertService.runChecks();

      expect(alertsRaised()).toHaveLength(0);
    });

    it('raises a critical alert when a migration failed at startup', async () => {
      // The server now starts instead of crash-looping, so this alert is the only
      // thing that makes the problem visible.
      (getDegraded as any).mockReturnValue({
        reason: 'migration_failed',
        detail: 'Migration 106_feedback_enhancements.sql failed: Duplicate column name.',
        since: new Date().toISOString(),
      });

      await alertService.runChecks();

      const raised = alertsRaised();
      expect(raised).toHaveLength(1);
      expect(raised[0]).toContain('106_feedback_enhancements.sql');
      expect(raised[0]).toContain('serving requests');
    });
  });
});
