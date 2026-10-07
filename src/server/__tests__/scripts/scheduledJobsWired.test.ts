import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Guard (2026-10-05, audit high "scheduled jobs never run"): on the servers, scheduled work runs
 * ONLY as systemd timers (deploy/systemd/pm-cron@<job>.timer → scripts/runCronJob.ts <job>).
 * Scheduled automations, calendar sync and storage sync lived only in the in-process scheduler
 * (cronManager.startCronTasks), which nothing calls — so they never ran. Every job needs both a
 * runner case and a timer; deploy.sh installs and enables every timer file it finds.
 */
const repo = join(__dirname, '..', '..', '..', '..');
const runner = readFileSync(join(repo, 'src', 'server', 'scripts', 'runCronJob.ts'), 'utf-8');
const cases = [...runner.matchAll(/case '([a-z-]+)':/g)].map(m => m[1]).sort();
const timers = readdirSync(join(repo, 'deploy', 'systemd'))
  .map(f => /^pm-cron@([a-z-]+)\.timer$/.exec(f)?.[1]).filter((x): x is string => !!x).sort();

describe('every scheduled job actually runs on the servers', () => {
  it('each runner job has a timer, and each timer has a runner job', () => {
    expect(cases.filter(c => !timers.includes(c))).toEqual([]);
    expect(timers.filter(t => !cases.includes(t))).toEqual([]);
  });

  it('scheduled automations, calendar sync and storage sync are wired', () => {
    for (const job of ['scheduled-automations', 'calendar-sync', 'storage-sync']) {
      expect(cases).toContain(job);
      expect(timers).toContain(job);
    }
  });

  it('scheduled automations are checked every 5 minutes, so 5 is the shortest interval', () => {
    expect(readFileSync(join(repo, 'deploy', 'systemd', 'pm-cron@scheduled-automations.timer'), 'utf-8')).toMatch(/OnCalendar=\*:0\/5/);
    expect(readFileSync(join(repo, 'src', 'server', 'services', 'automation', 'computeNextRun.ts'), 'utf-8')).toMatch(/Math\.max\(5, Math\.min\(1440, config\.intervalMinutes\)\)/);
  });
});

describe('a finished job ends at once (systemd counts until the process exits)', () => {
  it('the runner exits after clean-up, and agent time-limit timers are cleared', () => {
    const svc = readFileSync(join(repo, 'src', 'server', 'services', 'AgentRegistryService.ts'), 'utf-8');
    expect(runner).toMatch(/run\(\)\.finally\(\(\) => process\.exit\(process\.exitCode \?\? 0\)\);/);
    expect(svc).toMatch(/finally \{\s*if \(timer\) clearTimeout\(timer\);/);
  });
});
