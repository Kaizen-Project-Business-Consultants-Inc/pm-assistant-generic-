import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { trackBackground, settleBackgroundWork } from '../../utils/backgroundWork';

/**
 * A scheduled job closed the database and exited as soon as its own work returned, cutting off the
 * workflows it had set off (overdue scan, tasks it created) — 2026-10-12. Tracked work is now waited
 * for, up to a limit.
 */
describe('background work a scheduled job waits for', () => {
  const later = <T>(ms: number, value: T) => new Promise<T>((resolve) => { setTimeout(() => resolve(value), ms); });

  it('waits for tracked work, including work started while waiting', async () => {
    const done: string[] = [];
    void trackBackground(later(20, 'a').then((v) => {
      done.push(v);
      void trackBackground(later(20, 'b').then((w) => { done.push(w); })); // a workflow setting off another
    }));
    expect(await settleBackgroundWork(2_000)).toBe(0);
    expect(done).toEqual(['a', 'b']);
  });

  it('a failure does not stop the wait or throw', async () => {
    void trackBackground(Promise.reject(new Error('boom')).catch(() => {}));
    void trackBackground(later(10, 'ok'));
    expect(await settleBackgroundWork(2_000)).toBe(0);
  });

  it('gives up at the limit and says how many are still running', async () => {
    let finish: () => void = () => {};
    void trackBackground(new Promise<void>((resolve) => { finish = resolve; }));
    const started = Date.now();
    expect(await settleBackgroundWork(50)).toBe(1);
    expect(Date.now() - started).toBeLessThan(1_000);
    finish();
    expect(await settleBackgroundWork(1_000)).toBe(0);
  });

  it('nothing tracked: returns at once', async () => {
    const started = Date.now();
    expect(await settleBackgroundWork(5_000)).toBe(0);
    expect(Date.now() - started).toBeLessThan(100);
  });

  it('task/project/proposal workflows, workflow field updates, auto-executed proposals and audit entries are tracked, and the job runner waits before closing the database', () => {
    const src = (...p: string[]) => readFileSync(join(__dirname, '../..', ...p), 'utf8');
    expect(src('services', 'domainListeners.ts')).toMatch(/trackBackground\(dagWorkflowService\.evaluateProposalEvent\(/);
    expect(src('services', 'AuditLedgerService.ts')).toMatch(/return trackBackground\(this\.appendNow\(input\)\)/);
    expect(src('services', 'domainListeners.ts')).toMatch(/trackBackground\(dagWorkflowService\.evaluateTaskChange\(/);
    expect(src('services', 'domainListeners.ts')).toMatch(/trackBackground\(dagWorkflowService\.evaluateProjectChange\(/);
    expect(src('services', 'dagWorkflow', 'engine.ts')).toMatch(/trackBackground\(scheduleService\.updateTask\(/);
    expect(src('services', 'agents', 'ActionProposalService.ts')).toMatch(/trackBackground\(this\.tryAutoExecute\(/);
    const runner = src('scripts', 'runCronJob.ts');
    expect(runner.indexOf('settleBackgroundWork(')).toBeGreaterThan(-1);
    expect(runner.indexOf('settleBackgroundWork(')).toBeLessThan(runner.indexOf('databaseService.close()'));
  });
});
