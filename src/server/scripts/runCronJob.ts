/**
 * Standalone cron job runner — invoked by systemd timers instead of in-process node-cron.
 *
 * Usage:
 *   node dist/server/scripts/runCronJob.js <job-name>
 *
 * Jobs:
 *   agent-scan       — Run AI agent scan across all projects (gated by AGENT_ENABLED)
 *   overdue-scan     — Detect overdue tasks and trigger workflows (gated by AGENT_ENABLED)
 *   recurrence       — Generate recurring task instances (14-day horizon)
 *   digest           — Send daily/weekly email digests
 *   reports          — Execute due scheduled report deliveries
 *   health-snapshot  — Record daily project health scores
 *   trial-reminder   — Send trial expiry reminder emails
 *   alert-check      — Run infrastructure health checks
 *   deadline-check   — Send deadline approaching notifications (2-day warning)
 *   data-retention   — Purge stale data from webhook_deliveries, dead_letter_queue, etc.
 */

import { databaseService } from '../database/connection';
import { redisService } from '../services/RedisService';
import { config } from '../config';
import { forEachTenant } from '../services/scheduling/cronManager';

const JOB_NAME = process.argv[2];

if (!JOB_NAME) {
  console.error('Usage: node dist/server/scripts/runCronJob.js <job-name>');
  console.error('Jobs: agent-scan, overdue-scan, recurrence, digest, reports, health-snapshot, trial-reminder, alert-check, deadline-check, schedule-review, data-retention');
  process.exit(1);
}

async function run() {
  const start = Date.now();
  console.log(`[cron-runner] Starting job: ${JOB_NAME}`);

  try {
    // Verify database connection
    const connected = await databaseService.testConnection();
    if (!connected) {
      console.error('[cron-runner] Database connection failed');
      process.exit(1);
    }

    switch (JOB_NAME) {
      case 'agent-scan': {
        if (!config.AGENT_ENABLED) {
          console.log('[cron-runner] Agent scan skipped (AGENT_ENABLED=false)');
          break;
        }
        const { runScanImpl } = await import('../services/scheduling/scanOrchestrator');
        const { AgentActivityLogService } = await import('../services/AgentActivityLogService');
        const activityLog = new AgentActivityLogService();
        await forEachTenant(async () => {
          const stats = await runScanImpl(activityLog);
          console.log(`[cron-runner] Agent scan completed`, stats);
        });
        break;
      }

      case 'overdue-scan': {
        if (!config.AGENT_ENABLED) {
          console.log('[cron-runner] Overdue scan skipped (AGENT_ENABLED=false)');
          break;
        }
        const { runOverdueScanImpl } = await import('../services/scheduling/cronManager');
        const flagged = new Map<string, Set<string>>();
        await forEachTenant(async (tenant) => {
          const key = tenant?.slug ?? 'default';
          const count = await runOverdueScanImpl(flagged, key);
          console.log(`[cron-runner] Overdue scan: ${count} tasks triggered (${key})`);
        });
        break;
      }

      case 'recurrence': {
        const { recurrenceService } = await import('../services/RecurrenceService');
        await forEachTenant(async (tenant) => {
          const count = await recurrenceService.generateInstances(14);
          console.log(`[cron-runner] Recurrence: generated ${count} instances (${tenant?.slug ?? 'default'})`);
        });
        break;
      }

      case 'digest': {
        const { digestService } = await import('../services/DigestService');
        await forEachTenant(async (tenant) => {
          await digestService.sendPendingDigests();
          console.log(`[cron-runner] Digest emails sent (${tenant?.slug ?? 'default'})`);
        });
        break;
      }

      case 'reports': {
        const { reportScheduleService } = await import('../services/ReportScheduleService');
        await forEachTenant(async (tenant) => {
          await reportScheduleService.executeDueSchedules();
          console.log(`[cron-runner] Report schedules executed (${tenant?.slug ?? 'default'})`);
        });
        break;
      }

      case 'health-snapshot': {
        const { runHealthSnapshot } = await import('../services/scheduling/healthSnapshotJob');
        await forEachTenant(async (tenant) => {
          await runHealthSnapshot();
          console.log(`[cron-runner] Health snapshot recorded (${tenant?.slug ?? 'default'})`);
        });
        break;
      }

      case 'trial-reminder': {
        const { runTrialReminders } = await import('../services/scheduling/trialReminderJob');
        await runTrialReminders();
        console.log('[cron-runner] Trial reminders sent');
        break;
      }

      case 'alert-check': {
        const { alertService } = await import('../services/AlertService');
        await alertService.runChecks();
        console.log('[cron-runner] Alert checks completed');
        break;
      }

      case 'deadline-check': {
        const { runDeadlineNotifications } = await import('../services/scheduling/deadlineNotificationJob');
        await forEachTenant(async (tenant) => {
          const count = await runDeadlineNotifications();
          console.log(`[cron-runner] Deadline check: ${count} notifications sent (${tenant?.slug ?? 'default'})`);
        });
        break;
      }

      case 'schedule-review': {
        const { runScheduleReview } = await import('../services/scheduling/scheduleReviewJob');
        await forEachTenant(async (tenant) => {
          const count = await runScheduleReview();
          console.log(`[cron-runner] Schedule review: ${count} notifications sent (${tenant?.slug ?? 'default'})`);
        });
        break;
      }

      case 'data-retention': {
        const { dataRetentionService } = await import('../services/DataRetentionService');
        const results = await dataRetentionService.purgeStaleData();
        console.log('[cron-runner] Data retention purge completed', results);
        break;
      }

      default:
        console.error(`[cron-runner] Unknown job: ${JOB_NAME}`);
        process.exit(1);
    }

    const elapsed = Date.now() - start;
    console.log(`[cron-runner] Job "${JOB_NAME}" finished in ${elapsed}ms`);

    // Track in Redis for ops dashboard
    if (redisService.isConnected()) {
      const info = JSON.stringify({ status: 'ok', durationMs: elapsed, finishedAt: new Date().toISOString() });
      redisService.set(`cron:last:${JOB_NAME}`, info, 86400 * 7).catch(() => {});
    }
  } catch (error) {
    console.error(`[cron-runner] Job "${JOB_NAME}" FAILED:`, error);

    // Track failure in Redis
    if (redisService.isConnected()) {
      const info = JSON.stringify({ status: 'failed', error: String(error).slice(0, 200), finishedAt: new Date().toISOString() });
      redisService.set(`cron:last:${JOB_NAME}`, info, 86400 * 7).catch(() => {});
    }
    process.exit(1);
  } finally {
    await redisService.disconnect();
    await databaseService.close();
  }
}

run();
