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
 *   trial-reminder   — Send trial expiry reminder emails (free tier only)
 *   pending-payment  — Rescue/remind/close accounts stuck awaiting payment
 *   timesheet-compliance — Nudge people who have not logged time (recipient's 16:00)
 *   utilization-coaching — Weekly utilization coaching tips
 *   weekly-review-pack   — Friday review pack for project owners
 *   scheduled-automations — every 5 min: automations with a time trigger (interval/daily/weekly)
 *   calendar-sync        — every 15 min: Google Calendar for users who connected it
 *   storage-sync         — every 15 min: connected document storage
 *   pm-weekly-review     — Weekly PM review (hourly Thu–Sat UTC; runs at Friday 07:00 in each company's zone)
 *   alert-check      — Run infrastructure health checks
 *   deadline-check   — Send deadline approaching notifications (2-day warning)
 *   data-retention   — Purge stale data from webhook_deliveries, dead_letter_queue, etc.
 */

import { databaseService } from '../database/connection';
import { redisService } from '../services/RedisService';
import { config } from '../config';
import { forEachTenant } from '../services/scheduling/cronManager';
import { registerDomainListeners } from '../services/domainListeners';

const JOB_NAME = process.argv[2];

if (!JOB_NAME) {
  console.error('Usage: node dist/server/scripts/runCronJob.js <job-name>');
  console.error('Jobs: agent-scan, overdue-scan, recurrence, digest, reports, health-snapshot, trial-reminder, pending-payment, timesheet-compliance, utilization-coaching, weekly-review-pack, pm-weekly-review, scheduled-automations, calendar-sync, storage-sync, alert-check, deadline-check, schedule-review, data-retention');
  process.exit(1);
}

async function run() {
  const start = Date.now();
  console.log(`[cron-runner] Starting job: ${JOB_NAME}`);
  // Jobs change data too: their changes must reach the same reactions as the app's
  registerDomainListeners();

  try {
    // Verify database connection
    const connected = await databaseService.testConnection();
    if (!connected) throw new Error('Database connection failed'); // recorded as a failed run below

    // Redis: the alert checks (server errors, signup floods) and cooldowns live there. Jobs never
    // connected before, so those alerts could not fire from the timer. Optional, like the app.
    if (config.REDIS_URL) {
      const ok = await redisService.connectAndWait(config.REDIS_URL);
      console.log(`[cron-runner] Redis ${ok ? 'connected' : 'unavailable — Redis-based checks skipped'}`);
    }

    switch (JOB_NAME) {
      case 'agent-scan': {
        if (!config.AGENT_ENABLED) {
          console.log('[cron-runner] Agent scan skipped (AGENT_ENABLED=false)');
          break;
        }
        const { runScanImpl } = await import('../services/scheduling/scanOrchestrator');
        // loading the executor registers it with the proposal service (auto-approved proposals)
        await import('../services/agents/ActionExecutor');
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

      case 'timesheet-compliance': {
        const { runTimesheetCompliance } = await import('../services/scheduling/timesheetComplianceJob');
        await forEachTenant(async (tenant) => {
          const count = await runTimesheetCompliance();
          console.log(`[cron-runner] Timesheet compliance: ${count} reminders (${tenant?.slug ?? 'default'})`);
        });
        break;
      }

      case 'utilization-coaching': {
        const { runUtilizationCoaching } = await import('../services/scheduling/utilizationCoachingJob');
        await forEachTenant(async (tenant) => {
          const count = await runUtilizationCoaching();
          console.log(`[cron-runner] Utilization coaching: ${count} sent (${tenant?.slug ?? 'default'})`);
        });
        break;
      }

      case 'weekly-review-pack': {
        const { runWeeklyReviewPack } = await import('../services/scheduling/weeklyReviewPackJob');
        await forEachTenant(async (tenant) => {
          const count = await runWeeklyReviewPack();
          console.log(`[cron-runner] Weekly review pack: ${count} sent (${tenant?.slug ?? 'default'})`);
        });
        break;
      }

      case 'pm-weekly-review': {
        const { runPmWeeklyReviews } = await import('../services/scheduling/pmWeeklyReviewJob');
        await forEachTenant(async (tenant) => {
          const count = await runPmWeeklyReviews({ orgId: tenant?.orgId ?? null });
          console.log(`[cron-runner] Weekly PM review: ${count} PM(s) notified (${tenant?.slug ?? 'default'})`);
        });
        break;
      }

      case 'pending-payment': {
        const { runPendingPaymentSweep } = await import('../services/scheduling/pendingPaymentJob');
        const res = await runPendingPaymentSweep();
        console.log(`[cron-runner] Pending payment sweep: ${res.rescued} rescued, ${res.reminded} reminded, ${res.purged} closed`);
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

      // These three were only ever started by the in-process scheduler (cronManager.startCronTasks),
      // which nothing calls — so on the servers they never ran (found by the 2026-10-04 audit).
      // Now systemd timers run them like every other job.
      case 'scheduled-automations': {
        const { runDueScheduledAutomations } = await import('../services/automation/scheduledAutomationRunner');
        await forEachTenant(async (tenant) => {
          const count = await runDueScheduledAutomations();
          if (count > 0) console.log(`[cron-runner] Scheduled automations: ${count} run (${tenant?.slug ?? 'default'})`);
        });
        break;
      }

      case 'calendar-sync': {
        const { calendarSyncService } = await import('../services/integrations/CalendarSyncService');
        await forEachTenant(async (tenant) => {
          const result = await calendarSyncService.syncAllUsers();
          if (result.synced > 0) console.log(`[cron-runner] Calendar sync: ${JSON.stringify(result)} (${tenant?.slug ?? 'default'})`);
        });
        break;
      }

      case 'storage-sync': {
        const { runStorageSync } = await import('../services/scheduling/storageSyncJob');
        await forEachTenant(async (tenant) => {
          await runStorageSync();
          console.log(`[cron-runner] Storage sync done (${tenant?.slug ?? 'default'})`);
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
        throw new Error(`Unknown job: ${JOB_NAME}`);
    }

    const elapsed = Date.now() - start;
    console.log(`[cron-runner] Job "${JOB_NAME}" finished in ${elapsed}ms`);

    // Record the run for the ops dashboard and the "jobs stopped" alert. AWAITED: the finally
    // block disconnects Redis, and a fast job (e.g. agent-scan with agents off, ~0.2 s) used to
    // disconnect before this write landed — the record was lost and the alert said the job had
    // stopped running (prod, 2026-09-30).
    if (redisService.isConnected()) {
      const info = JSON.stringify({ status: 'ok', durationMs: elapsed, finishedAt: new Date().toISOString() });
      await redisService.set(`cron:last:${JOB_NAME}`, info, 86400 * 7).catch(() => {});
    }
  } catch (error) {
    console.error(`[cron-runner] Job "${JOB_NAME}" FAILED:`, error);

    // Track failure in Redis (awaited, and exit only after cleanup — exiting here used to drop it)
    if (redisService.isConnected()) {
      const info = JSON.stringify({ status: 'failed', error: String(error).slice(0, 200), finishedAt: new Date().toISOString() });
      await redisService.set(`cron:last:${JOB_NAME}`, info, 86400 * 7).catch(() => {});
    }
    process.exitCode = 1;
  } finally {
    await redisService.disconnect();
    await databaseService.close();
  }
}

run();
