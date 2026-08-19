import { describe, it, expect } from 'vitest';

// Pure utility functions — import from client source directly
// (no DOM dependencies, works in Node environment)
import { getDefaultViewMode, getPrimaryTabs, getOverflowTabs, getReadinessSteps } from '../../../client/src/utils/methodology';

describe('getDefaultViewMode', () => {
  it('returns gantt for waterfall', () => {
    expect(getDefaultViewMode('waterfall')).toBe('gantt');
  });

  it('returns kanban for agile', () => {
    expect(getDefaultViewMode('agile')).toBe('kanban');
  });

  it('returns gantt for hybrid', () => {
    expect(getDefaultViewMode('hybrid')).toBe('gantt');
  });
});

describe('getPrimaryTabs', () => {
  it('waterfall: 5 primary tabs (Changes moved to overflow)', () => {
    const tabs = getPrimaryTabs('waterfall');
    const ids = tabs.map(t => t.id);
    expect(tabs).toHaveLength(5);
    expect(ids[0]).toBe('overview');
    expect(ids[1]).toBe('schedule');
    expect(ids[2]).toBe('team');
    expect(ids[3]).toBe('raid');
    expect(ids[4]).toBe('budget');
    expect(ids).not.toContain('change-requests');
  });

  it('agile: 6 primary tabs with sprints + backlog after overview', () => {
    const tabs = getPrimaryTabs('agile');
    const ids = tabs.map(t => t.id);
    expect(tabs).toHaveLength(6);
    expect(ids[0]).toBe('overview');
    expect(ids[1]).toBe('sprints');
    expect(ids[2]).toBe('backlog');
    expect(ids[3]).toBe('schedule');
    expect(ids[4]).toBe('raid');
    expect(ids[5]).toBe('team');
  });

  it('hybrid: 6 primary tabs with sprints + backlog after schedule', () => {
    const tabs = getPrimaryTabs('hybrid');
    const ids = tabs.map(t => t.id);
    expect(tabs).toHaveLength(6);
    expect(ids[0]).toBe('overview');
    expect(ids[1]).toBe('schedule');
    expect(ids[2]).toBe('sprints');
    expect(ids[3]).toBe('backlog');
    expect(ids[4]).toBe('raid');
    expect(ids[5]).toBe('team');
  });

  it('RAID tab label is "Risks & Issues"', () => {
    for (const m of ['waterfall', 'agile', 'hybrid'] as const) {
      const raidTab = getPrimaryTabs(m).find(t => t.id === 'raid');
      expect(raidTab?.label).toBe('Risks & Issues');
    }
  });

  it('agile and hybrid have backlog tab, waterfall does not', () => {
    const w = getPrimaryTabs('waterfall').map(t => t.id);
    const a = getPrimaryTabs('agile').map(t => t.id);
    const h = getPrimaryTabs('hybrid').map(t => t.id);
    expect(w).not.toContain('backlog');
    expect(a).toContain('backlog');
    expect(h).toContain('backlog');
  });

  it('agile and hybrid have 6 primary tabs, waterfall has 5', () => {
    const w = getPrimaryTabs('waterfall');
    const a = getPrimaryTabs('agile');
    const h = getPrimaryTabs('hybrid');
    expect(w.length).toBe(5);
    expect(a.length).toBe(6);
    expect(h.length).toBe(6);
  });
});

describe('getOverflowTabs', () => {
  it('all methodologies include Time, Files, Performance, AI Insights, Resources, Agent Activity', () => {
    for (const m of ['waterfall', 'agile', 'hybrid'] as const) {
      const ids = getOverflowTabs(m).map(t => t.id);
      expect(ids).toContain('time');
      expect(ids).toContain('files');
      expect(ids).toContain('performance');
      expect(ids).toContain('ai-insights');
      expect(ids).toContain('resources');
      expect(ids).toContain('agent-activity');
    }
  });

  it('waterfall overflow includes sprints, backlog, and changes', () => {
    const ids = getOverflowTabs('waterfall').map(t => t.id);
    expect(ids).toContain('sprints');
    expect(ids).toContain('backlog');
    expect(ids).toContain('change-requests');
  });

  it('agile/hybrid overflow includes budget and changes', () => {
    for (const m of ['agile', 'hybrid'] as const) {
      const ids = getOverflowTabs(m).map(t => t.id);
      expect(ids).toContain('budget');
      expect(ids).toContain('change-requests');
    }
  });

  it('no overlap between primary and overflow tabs', () => {
    for (const m of ['waterfall', 'agile', 'hybrid'] as const) {
      const primaryIds = new Set(getPrimaryTabs(m).map(t => t.id));
      const overflowIds = getOverflowTabs(m).map(t => t.id);
      for (const id of overflowIds) {
        expect(primaryIds.has(id)).toBe(false);
      }
    }
  });
});

describe('getReadinessSteps', () => {
  it('waterfall: 3 data-verifiable steps', () => {
    const steps = getReadinessSteps('waterfall');
    expect(steps).toHaveLength(3);
    expect(steps[0].key).toBe('tasks');
    expect(steps[1].key).toBe('dependencies');
    expect(steps[2].key).toBe('resources');
  });

  it('agile: 3 data-verifiable steps', () => {
    const steps = getReadinessSteps('agile');
    expect(steps).toHaveLength(3);
    expect(steps[0].key).toBe('backlog');
    expect(steps[1].key).toBe('sprint');
    expect(steps[2].key).toBe('team');
  });

  it('hybrid: 4 data-verifiable steps', () => {
    const steps = getReadinessSteps('hybrid');
    expect(steps).toHaveLength(4);
    expect(steps[0].key).toBe('tasks');
    expect(steps[1].key).toBe('sprint');
    expect(steps[2].key).toBe('resources');
    expect(steps[3].key).toBe('dependencies');
  });

  it('agile sprint step uses sprints doneKey', () => {
    const steps = getReadinessSteps('agile');
    const sprintStep = steps.find(s => s.key === 'sprint');
    expect(sprintStep?.doneKey).toBe('sprints');
  });

  it('no clicked steps exist — all steps are data-verifiable', () => {
    for (const m of ['waterfall', 'agile', 'hybrid'] as const) {
      const steps = getReadinessSteps(m);
      for (const step of steps) {
        expect(['tasks', 'dependencies', 'resources', 'sprints']).toContain(step.doneKey);
      }
    }
  });
});
