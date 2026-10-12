import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The overdue scan ran every 15 minutes in a fresh process with an empty "already done" set, so
 * every overdue task's workflows ran again every time; 1,000 at once overflowed the database pool
 * (2026-10-12 review). Now: once per task and due date (Redis mark), one at a time, with a deadline,
 * and nothing fires when Redis is down.
 */

const marks = vi.hoisted(() => ({ store: new Set<string>(), connected: true, failAfter: Infinity }));
vi.mock('../../services/RedisService', () => ({
  redisService: {
    isConnected: () => marks.connected,
    getClient: () => ({
      set: vi.fn(async (key: string, _v: string, _ex: string, _ttl: number, nx: string) => {
        if (marks.store.size >= marks.failAfter) throw new Error('Connection is closed.');
        if (nx === 'NX' && marks.store.has(key)) return null;
        marks.store.add(key);
        return 'OK';
      }),
    }),
  },
}));
const rows = vi.hoisted(() => ({ list: [] as any[] }));
vi.mock('../../database/connection', () => ({ databaseService: { query: vi.fn(async () => rows.list) } }));
const flow = vi.hoisted(() => ({ running: 0, maxRunning: 0, calls: [] as string[] }));
vi.mock('../../services/DagWorkflowService', () => ({
  dagWorkflowService: {
    evaluateTaskChange: vi.fn(async (task: any) => {
      flow.running++; flow.maxRunning = Math.max(flow.maxRunning, flow.running);
      flow.calls.push(task.id);
      await new Promise((r) => { setTimeout(r, 5); });
      flow.running--;
    }),
  },
}));
vi.mock('../../services/ScheduleService', () => ({ scheduleService: {} }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { runOverdueScanImpl } from '../../services/scheduling/cronManager';

const task = (id: string, end = '2026-10-01') => ({ id, schedule_id: 's1', name: id, status: 'in_progress', end_date: end });

describe('overdue scan: once per overdue task, one at a time', () => {
  beforeEach(() => {
    marks.store.clear(); marks.connected = true; marks.failAfter = Infinity;
    flow.running = 0; flow.maxRunning = 0; flow.calls = [];
    rows.list = [task('t1'), task('t2'), task('t3')];
  });

  it('a second run (the next 15 minutes, a new process) fires nothing again', async () => {
    expect(await runOverdueScanImpl('acme')).toBe(3);
    expect(await runOverdueScanImpl('acme')).toBe(0);
    expect(flow.calls).toEqual(['t1', 't2', 't3']);
  });

  it('a new due date is a new overdue episode; another company is separate', async () => {
    await runOverdueScanImpl('acme');
    rows.list = [task('t1', '2026-10-08'), task('t2')];
    expect(await runOverdueScanImpl('acme')).toBe(1);
    expect(await runOverdueScanImpl('other-co')).toBe(2);
  });

  it('one task at a time, never a burst', async () => {
    rows.list = Array.from({ length: 8 }, (_, i) => task(`t${i}`));
    await runOverdueScanImpl('acme');
    expect(flow.maxRunning).toBe(1);
  });

  it('stops at the deadline; the rest go next run', async () => {
    expect(await runOverdueScanImpl('acme', { deadline: Date.now() - 1 })).toBe(0);
    expect(await runOverdueScanImpl('acme')).toBe(3);
  });

  it('Redis down: nothing fires (it could not tell what already fired)', async () => {
    marks.connected = false;
    expect(await runOverdueScanImpl('acme')).toBe(0);
    expect(flow.calls).toEqual([]);
  });

  it('Redis failing part-way: the scan stops there (no waiting on every remaining task)', async () => {
    marks.failAfter = 1;
    expect(await runOverdueScanImpl('acme')).toBe(1);
    expect(flow.calls).toEqual(['t1']);
  });
});
