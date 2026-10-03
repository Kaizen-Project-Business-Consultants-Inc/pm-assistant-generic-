import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve, relative } from 'path';

vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const reactions = vi.hoisted(() => ({
  queueReviewRerun: vi.fn(),
  queueRaidReviewRerun: vi.fn(),
  queueForResource: vi.fn(async () => {}),
  queueAll: vi.fn(async () => {}),
}));
vi.mock('../../services/scheduleReview/autoRerun', () => ({ queueReviewRerun: reactions.queueReviewRerun }));
vi.mock('../../services/raidReview/autoRerun', () => ({ queueRaidReviewRerun: reactions.queueRaidReviewRerun }));
vi.mock('../../services/TaskBudgetService', () => ({ taskBudgetService: { queueForResource: reactions.queueForResource, queueAll: reactions.queueAll } }));

import {
  onDomainEvent, publishDomainEvent, planChanged, personRatesChanged, rateCardChanged, raidChanged,
  listenerCounts, _resetDomainEventsForTests,
} from '../../services/domainEvents';
import { registerDomainListeners, _resetDomainListenersForTests } from '../../services/domainListeners';
import { asyncLocalStorage, getRequestContext } from '../../middleware/requestContext';

/**
 * "Something changed" notices (code health step 1B, 2026-10-03). Posting a notice must give
 * exactly the reactions the direct calls used to give — Schedule Review re-runs, budgets
 * re-price, RAID Review re-runs — in the poster's request context.
 */
describe('the notice board', () => {
  beforeEach(() => { _resetDomainEventsForTests(); vi.clearAllMocks(); });

  it('delivers a notice to every listener for it, and only those', () => {
    const a = vi.fn(), b = vi.fn(), other = vi.fn();
    onDomainEvent('plan.changed', a);
    onDomainEvent('plan.changed', b);
    onDomainEvent('raid.changed', other);
    planChanged('s1');
    expect(a).toHaveBeenCalledWith({ type: 'plan.changed', scheduleId: 's1' });
    expect(b).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it('a listener that fails never breaks the change that posted the notice, nor the other listeners', () => {
    const after = vi.fn();
    onDomainEvent('plan.changed', () => { throw new Error('boom'); });
    onDomainEvent('plan.changed', after);
    expect(() => planChanged('s1')).not.toThrow();
    expect(after).toHaveBeenCalled();
  });

  it('no schedule / project id → no notice (the old calls ignored those too)', () => {
    const h = vi.fn();
    onDomainEvent('plan.changed', h);
    onDomainEvent('raid.changed', h);
    planChanged(null); planChanged(undefined); planChanged(''); raidChanged(null);
    expect(h).not.toHaveBeenCalled();
  });

  it('listeners run inside the poster\'s request context (right company database, right user)', () => {
    let seen: string | undefined;
    onDomainEvent('plan.changed', () => { seen = getRequestContext()?.userId; });
    asyncLocalStorage.run({ userId: 'u-42' } as any, () => planChanged('s1'));
    expect(seen).toBe('u-42');
  });
});

describe('startup wiring: every notice reaches its reaction', () => {
  beforeEach(() => { _resetDomainEventsForTests(); _resetDomainListenersForTests(); vi.clearAllMocks(); registerDomainListeners(); });

  it('plan changed → Schedule Review re-run queued for that schedule', () => {
    planChanged('s1');
    expect(reactions.queueReviewRerun).toHaveBeenCalledWith('s1');
  });
  it("a person's rates changed → their plans re-priced", () => {
    personRatesChanged('r1');
    expect(reactions.queueForResource).toHaveBeenCalledWith('r1');
  });
  it('rate card changed → every plan re-priced', () => {
    rateCardChanged();
    expect(reactions.queueAll).toHaveBeenCalled();
  });
  it('RAID changed → RAID Review re-run queued for that project', () => {
    raidChanged('p1');
    expect(reactions.queueRaidReviewRerun).toHaveBeenCalledWith('p1');
  });
  it('registering twice does not double the reactions', () => {
    registerDomainListeners();
    expect(listenerCounts()).toEqual({ 'plan.changed': 1, 'person.rates.changed': 1, 'ratecard.changed': 1, 'raid.changed': 1 });
    publishDomainEvent({ type: 'plan.changed', scheduleId: 's1' });
    expect(reactions.queueReviewRerun).toHaveBeenCalledTimes(1);
  });
});

/** Guard: the wiring can't silently go missing, and nobody goes back to calling the reactions directly */
describe('guard', () => {
  const SERVER = resolve(__dirname, '..', '..');
  const src = (p: string) => readFileSync(join(SERVER, p), 'utf-8');
  const allFiles = (dir: string): string[] => readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    if (n === '__tests__' || n === 'node_modules') return [];
    return statSync(p).isDirectory() ? allFiles(p) : /\.ts$/.test(n) ? [p] : [];
  });

  it('both processes that change data connect the reactions at startup: the app and the scheduled-jobs runner', () => {
    expect(src('index.ts')).toMatch(/registerDomainListeners\(\)/);
    expect(src('scripts/runCronJob.ts')).toMatch(/registerDomainListeners\(\)/);
  });

  it('only domainListeners.ts reaches the reactions directly — everyone else posts a notice', () => {
    const offenders = allFiles(SERVER)
      .filter(f => !/[\\/](domainListeners|scheduleReview[\\/]autoRerun|raidReview[\\/]autoRerun)\.ts$/.test(f))
      .filter(f => /scheduleReview\/autoRerun|raidReview\/autoRerun|import\('\.\/TaskBudgetService'\)\.then/.test(readFileSync(f, 'utf-8')))
      .map(f => relative(SERVER, f));
    expect(offenders, 'Post a notice (services/domainEvents.ts) instead of calling the reaction').toEqual([]);
  });

  it('every place that used to trigger a reaction still posts its notice', () => {
    const posts: Record<string, RegExp> = {
      'services/ScheduleService.ts': /planChanged\(/,
      'routes/core/bulk.ts': /planChanged\(/,
      'services/TaskAssignmentService.ts': /planChanged\(/,
      'services/ChangeHistoryService.ts': /planChanged\(/,
      'services/TeamPlannerService.ts': /planChanged\(/,
      'services/WorkingCalendarService.ts': /planChanged\(/,
      'services/ApprovedTimeService.ts': /planChanged\(/,
      'services/ResourceReplaceService.ts': /planChanged\(/,
      'services/TaskBudgetService.ts': /planChanged\(/,
      'services/ResourceService.ts': /planChanged\([\s\S]*personRatesChanged\(|personRatesChanged\([\s\S]*planChanged\(/,
      'services/RateCardService.ts': /rateCardChanged\(/,
      'services/RiskService.ts': /raidChanged\(/,
      'routes/collaboration/risks.ts': /raidChanged\(/,
    };
    for (const [file, re] of Object.entries(posts)) expect(src(file), file).toMatch(re);
  });
});
