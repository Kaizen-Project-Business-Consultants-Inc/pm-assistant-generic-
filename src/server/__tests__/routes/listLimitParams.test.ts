import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { clampPagination } from '../../schemas/paginationSchema';

/**
 * `?limit=abc&offset=-5` used to reach SQL as `LIMIT NaN` / `OFFSET -5` and answer 500 on a
 * dozen list routes (2026-10-07 sweep). They now read limit/offset through clampPagination,
 * which falls back to the defaults. This checks the helper, and that each of those routes
 * uses it and no longer parses limit/offset by hand.
 */
describe('list routes survive ?limit=abc&offset=-5', () => {
  it('clampPagination: text, negatives and blanks fall back to defaults; big limits are capped', () => {
    expect(clampPagination({ limit: 'abc', offset: '-5' })).toEqual({ limit: 50, offset: 0 });
    expect(clampPagination({ limit: '-3', offset: 'x' }, { defaultLimit: 20 })).toEqual({ limit: 20, offset: 0 });
    expect(clampPagination({ limit: '0' })).toEqual({ limit: 50, offset: 0 });
    expect(clampPagination({ limit: '', offset: '' })).toEqual({ limit: 50, offset: 0 });
    expect(clampPagination({ limit: '1e3' })).toEqual({ limit: 50, offset: 0 });
    expect(clampPagination({ limit: '5000' }, { maxLimit: 200 })).toEqual({ limit: 200, offset: 0 });
    expect(clampPagination(undefined)).toEqual({ limit: 50, offset: 0 });
    // Valid input is unchanged
    expect(clampPagination({ limit: '25', offset: '50' })).toEqual({ limit: 25, offset: 50 });
    expect(clampPagination({ limit: 8, offset: 0 })).toEqual({ limit: 8, offset: 0 });
  });

  const ROUTES = join(__dirname, '..', '..', 'routes');
  const files = [
    'core/notifications.ts', 'core/feedback.ts', 'collaboration/lessonsLearned.ts',
    'agent/agentActivityLog.ts', 'agent/memory.ts', 'agent/proposals.ts', 'ai/dreaming.ts',
    'collaboration/workflows.ts', 'admin/deadLetter.ts', 'resources/timeEntries.ts',
    'ai/versionedMemory.ts',
  ];

  it.each(files)('%s reads limit/offset through clampPagination', (f) => {
    const s = readFileSync(join(ROUTES, f), 'utf-8');
    expect(s).toContain('clampPagination(');
    // No hand-parsed limit/offset (parseInt(limit…), Number(query.limit) …)
    expect(s).not.toMatch(/(parseInt|Number)\(\s*(q(uery)?\.)?(limit|offset|weeks)\b/);
  });
});
