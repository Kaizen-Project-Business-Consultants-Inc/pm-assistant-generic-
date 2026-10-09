import { describe, it, expect } from 'vitest';
import { mergeAgentRuns, mergeAgentPairs, mergeDailyRuns } from '../../utils/agentStats';

/** The admin agent counts, now read from each company's own database and added up (2026-10-09) */
describe('admin agent counts across companies', () => {
  it('per agent: runs and projects add up, first run is the earliest and last run the latest', () => {
    const merged = mergeAgentRuns([
      [{ agent_id: 'a', runs: 3, unique_projects: 2, first_run: '2026-10-02 08:00:00', last_run: '2026-10-05 09:00:00' }],
      [{ agent_id: 'a', runs: '4', unique_projects: '1', first_run: '2026-10-01 10:00:00', last_run: '2026-10-04 09:00:00' },
       { agent_id: 'b', runs: 9, unique_projects: 1, first_run: '2026-10-03 00:00:00', last_run: '2026-10-03 00:00:00' }],
      [],
    ]);
    expect(merged).toEqual([
      { agent_id: 'b', runs: 9, unique_projects: 1, first_run: '2026-10-03 00:00:00', last_run: '2026-10-03 00:00:00' },
      { agent_id: 'a', runs: 7, unique_projects: 3, first_run: '2026-10-01 10:00:00', last_run: '2026-10-05 09:00:00' },
    ]);
  });

  it('a pair seen once in each of two companies reaches "at least twice"; a pair seen once does not', () => {
    const pairs = mergeAgentPairs([
      [{ first_agent: 'x', second_agent: 'y', frequency: 1 }, { first_agent: 'p', second_agent: 'q', frequency: 1 }],
      [{ first_agent: 'x', second_agent: 'y', frequency: '1' }],
    ]);
    expect(pairs).toEqual([{ first_agent: 'x', second_agent: 'y', frequency: 2 }]);
  });

  it('at most 20 pairs, most frequent first', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ first_agent: `a${i}`, second_agent: 'b', frequency: 2 + i }));
    const top = mergeAgentPairs([many]);
    expect(top).toHaveLength(20);
    expect(top[0].frequency).toBe(31);
  });

  it('runs per day add up and come in date order', () => {
    expect(mergeDailyRuns([
      [{ day: '2026-10-03', runs: 2 }, { day: '2026-10-01', runs: 1 }],
      [{ day: '2026-10-03', runs: '5' }],
    ])).toEqual([{ day: '2026-10-01', runs: 1 }, { day: '2026-10-03', runs: 7 }]);
  });
});
