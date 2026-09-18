import { config } from '../config';
import { redisService } from './RedisService';
import { emailService } from './EmailService';
import { metricsService } from './MetricsService';
import { degradationHandler } from './agents/DegradationHandler';
import { aiBudgetService } from './AIBudgetService';
import { notificationService } from './NotificationService';
import { databaseService } from '../database/connection';
import logger from '../utils/logger';

type AlertType =
  | 'error_rate_high'
  | 'ai_budget_warning'
  | 'ai_budget_critical'
  | 'circuit_breaker_open'
  | 'db_latency_high'
  | 'db_connection_lost'
  | 'cron_job_stalled';

/**
 * Scheduled jobs that must have run recently, and how long is too long (hours).
 *
 * This exists because production ran NO scheduled jobs at all from mid-July until
 * 2026-09-18 and nothing noticed. The timers are set up by the deploy now, but a
 * deploy-time check only proves a job was scheduled — not that it still runs. This is
 * the standing check: every job records its last run, and anything that goes quiet for
 * longer than it should raises an alert.
 *
 * Deliberately generous windows — this is for "has stopped entirely", not lateness.
 * alert-check itself is excluded: it is the thing doing the checking.
 */
const EXPECTED_CRON_JOBS: Array<{ job: string; maxQuietHours: number }> = [
  { job: 'overdue-scan', maxQuietHours: 2 },
  { job: 'reports', maxQuietHours: 2 },
  { job: 'agent-scan', maxQuietHours: 30 },
  { job: 'recurrence', maxQuietHours: 30 },
  { job: 'health-snapshot', maxQuietHours: 30 },
  { job: 'data-retention', maxQuietHours: 30 },
  { job: 'digest', maxQuietHours: 30 },
  { job: 'deadline-check', maxQuietHours: 30 },
  { job: 'trial-reminder', maxQuietHours: 30 },
  { job: 'pending-payment', maxQuietHours: 30 },
  { job: 'schedule-review', maxQuietHours: 8 * 24 },
];

interface Alert {
  type: AlertType;
  severity: 'warning' | 'critical';
  title: string;
  message: string;
}

class AlertService {
  // Alert checks are now scheduled externally via systemd timer (pm-cron@alert-check.timer).
  // The start()/stop() methods have been removed to avoid accidental in-process scheduling.

  async runChecks(): Promise<void> {
    try {
      await Promise.allSettled([
        this.checkErrorRate(),
        this.checkAIBudget(),
        this.checkCircuitBreakers(),
        this.checkDatabaseHealth(),
        this.checkCronJobsRunning(),
      ]);
    } catch (err) {
      logger.error('[AlertService] Check cycle failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Raise an alert for any scheduled job that has gone quiet, or has never run at all.
   *
   * `runCronJob.ts` writes `cron:last:<job>` to Redis after every run. A job that is
   * not scheduled on this server writes nothing, so a missing key means the job has
   * never run here — exactly the state production was in for two months.
   *
   * Needs Redis; skips silently without it rather than alerting on its own blind spot.
   */
  private async checkCronJobsRunning(): Promise<void> {
    if (!redisService.isConnected()) return;

    const now = Date.now();
    const neverRan: string[] = [];
    const stalled: string[] = [];

    for (const { job, maxQuietHours } of EXPECTED_CRON_JOBS) {
      let raw: string | null = null;
      try {
        raw = await redisService.get(`cron:last:${job}`);
      } catch {
        return; // Redis unreliable — do not guess.
      }

      if (!raw) {
        neverRan.push(job);
        continue;
      }

      try {
        const { finishedAt } = JSON.parse(raw) as { finishedAt?: string };
        const last = finishedAt ? new Date(finishedAt).getTime() : NaN;
        if (!Number.isFinite(last)) continue;
        const quietHours = (now - last) / (60 * 60 * 1000);
        if (quietHours > maxQuietHours) {
          stalled.push(`${job} (${Math.round(quietHours)}h ago)`);
        }
      } catch {
        // Unparseable record — ignore rather than alert on a formatting problem.
      }
    }

    if (neverRan.length === 0 && stalled.length === 0) return;

    const parts: string[] = [];
    if (neverRan.length > 0) {
      parts.push(`Never run on this server: ${neverRan.join(', ')}. These are probably not scheduled at all.`);
    }
    if (stalled.length > 0) {
      parts.push(`Stopped running: ${stalled.join(', ')}.`);
    }

    await this.fire({
      type: 'cron_job_stalled',
      severity: neverRan.length > 0 ? 'critical' : 'warning',
      title: 'Scheduled jobs not running',
      message: `${parts.join(' ')} Check the timers on this server: systemctl list-timers 'pm-cron@*'.`,
    });
  }

  private async checkErrorRate(): Promise<void> {
    const snapshot = metricsService.getSnapshot();
    if (snapshot.requests.total < 100) return; // Not enough data

    const errorRate = (snapshot.errors.total5xx / snapshot.requests.total) * 100;
    if (errorRate >= 10) {
      await this.fire({
        type: 'error_rate_high',
        severity: 'critical',
        title: 'High Error Rate',
        message: `Server error rate is ${errorRate.toFixed(1)}% (${snapshot.errors.total5xx} of ${snapshot.requests.total} requests). P95 latency: ${snapshot.latency.p95Ms}ms.`,
      });
    }
  }

  private async checkAIBudget(): Promise<void> {
    try {
      // Get admin users to check global budget
      const rows = await databaseService.queryControlPlane(
        "SELECT id FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1"
      );
      if (rows.length === 0) return;

      const adminId = (rows[0] as any).id;
      const usage = await aiBudgetService.getMonthlyUsage(adminId);

      if (usage.percentUsed >= 95) {
        await this.fire({
          type: 'ai_budget_critical',
          severity: 'critical',
          title: 'AI Budget Critical',
          message: `AI token budget is ${usage.percentUsed}% used (${usage.totalTokens.toLocaleString()} of ${usage.budget.toLocaleString()} tokens). Only ${usage.remaining.toLocaleString()} tokens remaining this month.`,
        });
      } else if (usage.percentUsed >= 80) {
        await this.fire({
          type: 'ai_budget_warning',
          severity: 'warning',
          title: 'AI Budget Warning',
          message: `AI token budget is ${usage.percentUsed}% used (${usage.totalTokens.toLocaleString()} of ${usage.budget.toLocaleString()} tokens). ${usage.remaining.toLocaleString()} tokens remaining this month.`,
        });
      }
    } catch {
      // Non-critical — budget check may fail if no AI usage
    }
  }

  private async checkCircuitBreakers(): Promise<void> {
    const health = await degradationHandler.getHealthStatus();
    const openBreakers = Object.entries(health.circuitBreakers)
      .filter(([, b]) => b.state === 'open')
      .map(([name, b]) => `${name} (${b.consecutiveFailures} failures)`);

    if (openBreakers.length > 0) {
      await this.fire({
        type: 'circuit_breaker_open',
        severity: 'critical',
        title: 'Circuit Breaker Open',
        message: `${openBreakers.length} circuit breaker(s) are open: ${openBreakers.join(', ')}. Recommended scan scope: ${health.recommendedScope}.`,
      });
    }
  }

  private async checkDatabaseHealth(): Promise<void> {
    const health = await degradationHandler.checkDatabaseHealth();

    if (!health.healthy) {
      await this.fire({
        type: 'db_connection_lost',
        severity: 'critical',
        title: 'Database Connection Lost',
        message: 'Database health check failed. The application may be unable to serve requests.',
      });
    } else if (health.latencyMs > 2000) {
      await this.fire({
        type: 'db_latency_high',
        severity: 'warning',
        title: 'High Database Latency',
        message: `Database latency is ${health.latencyMs}ms (threshold: 2000ms). Performance may be degraded.`,
      });
    }
  }

  private async fire(alert: Alert): Promise<void> {
    // Cooldown check via Redis
    const cooldownKey = `alert:cooldown:${alert.type}`;
    if (redisService.isConnected()) {
      const existing = await redisService.get(cooldownKey);
      if (existing) return; // Already alerted within cooldown window
      await redisService.set(cooldownKey, '1', config.ALERT_COOLDOWN_MINUTES * 60);
    }

    logger.warn(`[AlertService] ALERT: ${alert.title} — ${alert.message}`);

    // Send email alert
    if (config.ALERT_EMAIL) {
      emailService.sendNotificationEmail(
        config.ALERT_EMAIL,
        `[${alert.severity.toUpperCase()}] ${alert.title}`,
        alert.title,
        alert.message,
        `${config.APP_URL}/admin`,
        'View Admin Panel',
      ).catch(err => logger.error('[AlertService] Email alert failed', {
        error: err instanceof Error ? err.message : String(err),
      }));
    }

    // Send webhook alert
    if (config.ALERT_WEBHOOK_URL) {
      fetch(config.ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: alert.type,
          severity: alert.severity,
          title: alert.title,
          message: alert.message,
          timestamp: new Date().toISOString(),
          source: 'pm-assistant',
        }),
        signal: AbortSignal.timeout(10_000),
      }).catch(err => logger.error('[AlertService] Webhook alert failed', {
        error: err instanceof Error ? err.message : String(err),
      }));
    }

    // Create in-app notification for admin users
    try {
      const admins = await databaseService.queryControlPlane(
        "SELECT id FROM users WHERE role = 'admin' AND is_active = 1"
      );
      for (const admin of admins as any[]) {
        notificationService.create({
          userId: admin.id,
          type: 'system_alert',
          severity: alert.severity === 'critical' ? 'high' : 'medium',
          title: alert.title,
          message: alert.message,
        }).catch(() => {}); // Fire-and-forget
      }
    } catch {
      // Non-critical
    }
  }
}

export const alertService = new AlertService();
