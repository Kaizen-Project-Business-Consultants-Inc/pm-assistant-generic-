import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The scheduled jobs ask the database and Redis a fixed number of times for their dedup checks,
 * managers and inserts, not once per task / person / project (2026-10-09, batch 6 of the loop
 * clean-up) — and send exactly the notices they sent before.
 */
const h = vi.hoisted(() => {
  const store = new Map<string, string>();
  const client = {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    mget: vi.fn(async (keys: string[]) => keys.map(k => store.get(k) ?? null)),
  };
  return {
    store,
    client,
    connected: true,
    sql: [] as Array<{ sql: string; params: any[] }>,
    answer: (_sql: string, _params: any[]): any => [],
    notify: vi.fn(async (_n: any) => ({})),
    email: vi.fn(async (..._a: any[]) => undefined),
    health: vi.fn(async (id: string) => ({ healthScore: 70, riskLevel: 'low', breakdown: { scheduleHealth: 1, budgetHealth: 2, riskHealth: 3 }, id })),
    weekly: vi.fn(async (_id: string) => ({ totalHours: 10, hoursByUser: [1], anomalyCount: 0, overBudgetTasks: [], compliancePercent: 90 })),
  };
});
vi.mock('../../database/connection', () => {
  const run = async (sql: string, params: any[] = []) => { h.sql.push({ sql, params }); return h.answer(sql, params); };
  return { databaseService: { query: run, queryControlPlane: run } };
});
vi.mock('../../services/RedisService', () => ({
  redisService: {
    isConnected: () => h.connected,
    getClient: () => (h.connected ? h.client : null),
    get: (k: string) => h.client.get(k),
    set: vi.fn(async (k: string, v: string) => { h.store.set(k, v); }),
  },
}));
vi.mock('../../services/NotificationService', () => ({ notificationService: { create: (n: any) => h.notify(n) } }));
vi.mock('../../services/EmailService', () => ({ emailService: { sendTrialExpiredEmail: (...a: any[]) => h.email('expired', ...a), sendTrialReminderEmail: (...a: any[]) => h.email('reminder', ...a), sendVerificationEmail: (...a: any[]) => h.email('verify', ...a) } }));
vi.mock('../../utils/recipientTime', () => ({ isLocalHour: () => true, timezonesFor: async () => new Map() }));
vi.mock('../../utils/assigneeLogins', () => ({ loginsForAssignees: async () => new Map() }));
vi.mock('../../utils/companyCacheKey', () => ({ companyCacheKey: (k: string) => `co:${k}` }));
vi.mock('../../services/TimeAnomalyService', () => ({ timeAnomalyService: { generateWeeklyReview: (id: string) => h.weekly(id), generateCoachingTip: async () => 'tip' } }));
vi.mock('../../services/predictiveIntelligence', () => ({ PredictiveIntelligenceService: class { getProjectHealthScore(id: string) { return h.health(id); } } }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { runDeadlineNotifications } from '../../services/scheduling/deadlineNotificationJob';
import { runTimesheetCompliance } from '../../services/scheduling/timesheetComplianceJob';
import { runUtilizationCoaching } from '../../services/scheduling/utilizationCoachingJob';
import { runTrialReminders } from '../../services/scheduling/trialReminderJob';
import { runHealthSnapshot } from '../../services/scheduling/healthSnapshotJob';
import { runWeeklyReviewPack } from '../../services/scheduling/weeklyReviewPackJob';

const stmts = (re: RegExp) => h.sql.filter(s => re.test(s.sql.replace(/\s+/g, ' ').trim()));
beforeEach(() => {
  h.sql = []; h.answer = () => []; h.store.clear(); h.connected = true; vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe('deadline reminders', () => {
  it('300 tasks: one MGET for the dedup check, no GET each; already-notified tasks are skipped', async () => {
    h.answer = (sql) => /FROM tasks t/.test(sql)
      ? Array.from({ length: 300 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, created_by: 'u1', due_date: '2026-10-10', project_id: 'p1' }))
      : [];
    const day = new Date().toISOString().slice(0, 10);
    h.store.set(`co:deadline-notified:t1:${day}`, '1');
    expect(await runDeadlineNotifications()).toBe(299);
    expect(h.client.mget).toHaveBeenCalledTimes(1);
    expect(h.client.mget.mock.calls[0][0]).toHaveLength(300);
    expect(h.client.get).not.toHaveBeenCalled();
    expect(h.notify.mock.calls.map(c => c[0].linkId).slice(0, 3)).toEqual(['t0', 't2', 't3']);
  });

  it('Redis down: no dedup, every task notified (as before)', async () => {
    h.connected = false;
    h.answer = (sql) => /FROM tasks t/.test(sql) ? [{ id: 't1', name: 'T', created_by: 'u1', due_date: '2026-10-10' }] : [];
    expect(await runDeadlineNotifications()).toBe(1);
    expect(h.client.mget).not.toHaveBeenCalled();
  });
});

describe('timesheet reminders and escalations', () => {
  it('reminders deduped in one MGET; every project\'s managers in one read; escalations as before', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T12:00:00Z')); // Thursday: checks Mon–Thu
    const members = [
      { user_id: 'a', project_id: 'p1', full_name: 'Ann' },
      { user_id: 'a', project_id: 'p2', full_name: 'Ann' },
      { user_id: 'b', project_id: 'p1', full_name: 'Bob' },
      { user_id: 'c', project_id: 'p3', full_name: 'Cy' },
    ];
    h.answer = (sql, params) => {
      if (/SELECT DISTINCT pm.user_id/.test(sql)) return members;
      if (/FROM time_entries/.test(sql)) return [{ user_id: 'c', date: '2026-10-08', total_hours: 8 }];
      if (/FROM project_members/.test(sql)) {
        const mgrs: Record<string, string[]> = { p1: ['m1', 'a'], p2: ['m2'] };
        return params.flatMap((p: string) => (mgrs[p] ?? []).map(u => ({ project_id: p, user_id: u })));
      }
      return [];
    };
    h.store.set('compliance:reminder:b:2026-10-08', '1'); // Bob was reminded already today
    h.store.set('compliance:escalation:a:p2:2026-10-08', '1'); // Ann's p2 managers were told already

    expect(await runTimesheetCompliance()).toBe(1); // only Ann is reminded
    expect(h.client.get).not.toHaveBeenCalled();
    expect(h.client.mget.mock.calls.map(c => c[0])).toEqual([
      ['compliance:reminder:a:2026-10-08', 'compliance:reminder:b:2026-10-08'],
      ['compliance:escalation:a:p1:2026-10-08', 'compliance:escalation:a:p2:2026-10-08'],
    ]);
    const mgrReads = stmts(/FROM project_members WHERE project_id IN/);
    expect(mgrReads).toHaveLength(1);
    expect(mgrReads[0].params).toEqual(['p1']);
    // Ann reminded, then p1's manager told (not Ann herself, not p2 which was already told)
    expect(h.notify.mock.calls.map(c => [c[0].userId, c[0].severity, c[0].projectId])).toEqual([
      ['a', 'medium', 'p1'],
      ['m1', 'high', 'p1'],
    ]);
    expect(h.notify.mock.calls[1][0].message).toBe("Ann hasn't logged time for 4 consecutive weekdays.");
  });
});

describe('utilization coaching', () => {
  it('one MGET for everyone; a person in two projects is coached once (first qualifying row)', async () => {
    h.answer = (sql) => /FROM project_members pm/.test(sql) ? [
      { user_id: 'a', project_id: 'p1', full_name: 'Ann', project_name: 'P1', total_hours: 0, work_days: 0 },
      { user_id: 'a', project_id: 'p2', full_name: 'Ann', project_name: 'P2', total_hours: 0, work_days: 0 },
      { user_id: 'b', project_id: 'p1', full_name: 'Bob', project_name: 'P1', total_hours: 0, work_days: 0 },
      { user_id: 'c', project_id: 'p1', full_name: 'Cy', project_name: 'P1', total_hours: 0, work_days: 0 },
    ] : [];
    // Bob was coached already this week (any week key ending in his id is fine for the fake)
    const origMget = h.client.mget.getMockImplementation()!;
    h.client.mget.mockImplementationOnce(async (keys: string[]) => (await origMget(keys)).map((v, i) => (keys[i].includes(':b:') ? '1' : v)));
    expect(await runUtilizationCoaching()).toBe(2);
    expect(h.client.mget).toHaveBeenCalledTimes(1);
    expect(h.client.get).not.toHaveBeenCalled();
    expect(h.notify.mock.calls.map(c => [c[0].userId, c[0].projectId])).toEqual([['a', 'p1'], ['c', 'p1']]);
  });
});

describe('trial reminders', () => {
  it('one MGET for every person\'s reminder key; a reminder already sent is not sent again', async () => {
    const inDays = (d: number) => new Date(Date.now() + d * 86400000 - 60000).toISOString();
    h.answer = (sql) => /SELECT id, email, full_name/.test(sql) ? [
      { id: 'u1', email: 'a@x', full_name: 'A', trial_ends_at: inDays(3) },
      { id: 'u2', email: 'b@x', full_name: 'B', trial_ends_at: inDays(1) },
      { id: 'u3', email: 'c@x', full_name: 'C', trial_ends_at: inDays(-0.5) },
    ] : /^\s*SELECT/.test(sql) ? [] : { affectedRows: 0 };
    h.store.set('trial-reminder:u2:1day', '1');
    await runTrialReminders();
    expect(h.client.mget.mock.calls).toEqual([[['trial-reminder:u1:3day', 'trial-reminder:u2:1day', 'trial-reminder:u3:expired']]]);
    expect(h.client.get).not.toHaveBeenCalled();
    expect(h.email.mock.calls).toEqual([['reminder', 'a@x', 'A', 3], ['expired', 'c@x', 'C']]);
  });

  it('the trial countdown only goes to people who confirmed their email', async () => {
    await runTrialReminders();
    expect(stmts(/SELECT id, email, full_name/)[0].sql).toMatch(/email_verified = 1/);
  });

  it('unconfirmed sign-ups get a fresh confirm-your-email link at day 1 and day 3, once each', async () => {
    h.answer = (sql) => /SELECT id, email, TIMESTAMPDIFF/.test(sql) ? [
      { id: 'n1', email: 'new@x', late: 0 },
      { id: 'n3', email: 'old@x', late: 1 },
      { id: 'n9', email: 'done@x', late: 0 },
    ] : /^\s*SELECT/.test(sql) ? [] : { affectedRows: 1 };
    h.store.set('verify-reminder:n9:1day', '1');
    await runTrialReminders();

    const pick = stmts(/SELECT id, email, TIMESTAMPDIFF/)[0].sql;
    expect(pick).toMatch(/email_verified = 0/);
    expect(pick).toContain('TIMESTAMPDIFF(HOUR, created_at, NOW()) >= 72 AS late');
    expect(pick).toMatch(/INTERVAL 1 DAY[\s\S]*INTERVAL 4 DAY/);
    expect(h.client.mget.mock.calls[0][0]).toEqual(['verify-reminder:n1:1day', 'verify-reminder:n3:3day', 'verify-reminder:n9:1day']);

    // New link saved for each person (only while still unconfirmed), then emailed as a reminder
    const saves = stmts(/^UPDATE users SET email_verification_token/);
    expect(saves.map(s => s.params[2])).toEqual(['n1', 'n3']);
    expect(saves[0].sql).toMatch(/AND email_verified = 0/);
    expect(saves[0].params[1].getTime()).toBeGreaterThan(Date.now() + 23 * 3600000);
    const sent = h.email.mock.calls.filter(c => c[0] === 'verify');
    expect(sent.map(c => [c[1], c[2], c[3]])).toEqual([
      ['new@x', saves[0].params[0], { reminder: true }],
      ['old@x', saves[1].params[0], { reminder: true }],
    ]);
    expect(saves[0].params[0]).not.toBe(saves[1].params[0]);
    expect(h.store.has('verify-reminder:n1:1day') && h.store.has('verify-reminder:n3:3day')).toBe(true);
  });

  it('a failed send is not marked sent, so tomorrow tries again; the others still go', async () => {
    h.answer = (sql) => /SELECT id, email, TIMESTAMPDIFF/.test(sql) ? [
      { id: 'a', email: 'a@x', late: 0 },
      { id: 'b', email: 'b@x', late: 0 },
    ] : /^\s*SELECT/.test(sql) ? [] : { affectedRows: 1 };
    h.email.mockRejectedValueOnce(new Error('provider down'));
    await runTrialReminders();
    expect(h.store.has('verify-reminder:a:1day')).toBe(false);
    expect(h.store.has('verify-reminder:b:1day')).toBe(true);
  });

  it('if the confirm-your-email step breaks, the trial countdown still goes out', async () => {
    const inDays = (d: number) => new Date(Date.now() + d * 86400000 - 60000).toISOString();
    h.answer = (sql) => {
      if (/TIMESTAMPDIFF/.test(sql)) throw new Error('db hiccup');
      return /SELECT id, email, full_name/.test(sql) ? [{ id: 'u1', email: 'a@x', full_name: 'A', trial_ends_at: inDays(3) }] : { affectedRows: 0 };
    };
    await runTrialReminders();
    expect(h.email.mock.calls).toEqual([['reminder', 'a@x', 'A', 3]]);
  });
});

describe('health snapshots', () => {
  const projects = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));

  it('250 projects: two INSERTs (200 + 50), same values per row as the one-row INSERT', async () => {
    h.answer = (sql) => /FROM projects/.test(sql) ? projects(250) : [];
    expect(await runHealthSnapshot()).toBe(250);
    const ins = stmts(/^INSERT INTO project_health_history/);
    expect(ins.map(s => s.params.length / 7)).toEqual([200, 50]);
    expect(ins[0].sql).toMatch(/VALUES \(\?, \?, \?, \?, \?, \?, \?, NOW\(\)\), \(/);
    expect(ins[1].params.slice(1, 7)).toEqual(['p200', 70, 'low', 1, 2, 3]);
  });

  it('a project whose score fails is skipped; if the INSERT fails, each row is saved alone so only the bad one is lost', async () => {
    h.health.mockRejectedValueOnce(new Error('no data'));
    let failedBatch = false;
    h.answer = (sql, params) => {
      if (/FROM projects/.test(sql)) return projects(4);
      if (/^INSERT/.test(sql.trim())) {
        if (params.length > 7) { failedBatch = true; throw new Error('one bad row'); }
        if (params[1] === 'p2') throw new Error('bad row');
      }
      return [];
    };
    expect(await runHealthSnapshot()).toBe(2); // p0 had no score; p2 could not be saved
    expect(failedBatch).toBe(true);
    expect(stmts(/^INSERT/).filter(s => s.params.length === 7).map(s => s.params[1])).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('weekly review pack', () => {
  it('every project\'s managers in one read; each project\'s managers notified, quiet weeks skipped', async () => {
    h.answer = (sql, params) => {
      if (/FROM projects/.test(sql)) return [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }, { id: 'p3', name: 'Three' }];
      if (/FROM project_members/.test(sql)) return params.flatMap((p: string) => (p === 'p3' ? [] : [{ project_id: p, user_id: `m-${p}` }]));
      return [];
    };
    h.weekly.mockImplementation(async (id: string) => ({ totalHours: id === 'p2' ? 0 : 10, hoursByUser: [1], anomalyCount: 0, overBudgetTasks: [], compliancePercent: 90 }));
    expect(await runWeeklyReviewPack()).toBe(1);
    expect(stmts(/FROM project_members/)).toHaveLength(1);
    expect(stmts(/FROM project_members/)[0].params).toEqual(['p1', 'p2', 'p3']);
    expect(h.notify.mock.calls.map(c => [c[0].userId, c[0].projectId])).toEqual([['m-p1', 'p1']]);
  });

  it('managers can\'t be read: nobody is notified (as when each project\'s read failed)', async () => {
    h.answer = (sql) => {
      if (/FROM projects/.test(sql)) return [{ id: 'p1', name: 'One' }];
      if (/FROM project_members/.test(sql)) throw new Error('down');
      return [];
    };
    expect(await runWeeklyReviewPack()).toBe(0);
    expect(h.notify).not.toHaveBeenCalled();
  });
});
