import { describe, it, expect } from 'vitest';
import { mapAnalysisToRaidCandidates } from '../../utils/meetingToRaidMapper';

describe('mapAnalysisToRaidCandidates', () => {
  it('returns empty array for empty analysis', () => {
    expect(mapAnalysisToRaidCandidates({})).toEqual([]);
    expect(mapAnalysisToRaidCandidates({ risks: [], issues: [], actionItems: [], decisions: [], dependencies: [] })).toEqual([]);
  });

  it('maps risks to type risk with severity-based probability/impact', () => {
    const result = mapAnalysisToRaidCandidates({
      risks: [
        { description: 'Budget overrun possible', severity: 'high', mitigation: 'Add contingency' },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('risk');
    expect(result[0].sourceType).toBe('risk');
    expect(result[0].title).toBe('Budget overrun possible');
    expect(result[0].severity).toBe('high');
    expect(result[0].probability).toBe(3);
    expect(result[0].impact).toBe(4);
    expect(result[0].mitigationPlan).toBe('Add contingency');
  });

  it('maps issues to type issue with impact assessment', () => {
    const result = mapAnalysisToRaidCandidates({
      issues: [
        { description: 'Server is down', severity: 'critical', impact: 'Cannot deploy' },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('issue');
    expect(result[0].sourceType).toBe('issue');
    expect(result[0].title).toBe('Server is down');
    expect(result[0].severity).toBe('critical');
    expect(result[0].impactAssessment).toBe('Cannot deploy');
  });

  it('maps action items to type action with priority-to-severity mapping', () => {
    const result = mapAnalysisToRaidCandidates({
      actionItems: [
        { description: 'Update wireframes', assignee: 'Jane', priority: 'urgent', dueDate: '2026-09-01' },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('action');
    expect(result[0].sourceType).toBe('action');
    expect(result[0].severity).toBe('critical'); // urgent -> critical
    expect(result[0].dueDate).toBe('2026-09-01');
    expect(result[0].actionType).toBe('corrective');
    expect(result[0].description).toContain('Assignee: Jane');
  });

  it('maps decisions to type decision with rationale and decidedBy', () => {
    const result = mapAnalysisToRaidCandidates({
      decisions: [
        { decision: 'Use React for the dashboard', rationale: 'Better ecosystem', madeBy: 'Tech Lead' },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('decision');
    expect(result[0].sourceType).toBe('decision');
    expect(result[0].title).toBe('Use React for the dashboard');
    expect(result[0].rationale).toBe('Better ecosystem');
    expect(result[0].decidedBy).toBe('Tech Lead');
  });

  it('maps dependencies to type risk with category dependency', () => {
    const result = mapAnalysisToRaidCandidates({
      dependencies: [
        { description: 'Waiting on API team', dependsOn: 'API v2', blockedItem: 'Frontend integration' },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('risk');
    expect(result[0].sourceType).toBe('dependency');
    expect(result[0].category).toBe('dependency');
    expect(result[0].title).toBe('Waiting on API team');
    expect(result[0].description).toContain('Depends on: API v2');
    expect(result[0].description).toContain('Blocked: Frontend integration');
  });

  it('truncates long titles to 255 chars', () => {
    const longDesc = 'A'.repeat(300);
    const result = mapAnalysisToRaidCandidates({
      risks: [{ description: longDesc, severity: 'low' }],
    });
    expect(result[0].title.length).toBeLessThanOrEqual(255);
    expect(result[0].title.endsWith('...')).toBe(true);
  });

  it('handles mixed types and preserves order', () => {
    const result = mapAnalysisToRaidCandidates({
      risks: [{ description: 'Risk 1', severity: 'medium' }],
      issues: [{ description: 'Issue 1', severity: 'high' }],
      actionItems: [{ description: 'Action 1', assignee: 'Bob', priority: 'low' }],
      decisions: [{ decision: 'Decision 1' }],
      dependencies: [{ description: 'Dep 1' }],
    });
    expect(result).toHaveLength(5);
    expect(result.map(r => r.sourceType)).toEqual(['risk', 'issue', 'action', 'decision', 'dependency']);
  });

  it('maps priority low/medium/high correctly', () => {
    const priorities = ['low', 'medium', 'high', 'urgent'] as const;
    const expected = ['low', 'medium', 'high', 'critical'];

    for (let i = 0; i < priorities.length; i++) {
      const result = mapAnalysisToRaidCandidates({
        actionItems: [{ description: `Action ${i}`, assignee: 'X', priority: priorities[i] }],
      });
      expect(result[0].severity).toBe(expected[i]);
    }
  });

  it('handles missing optional fields gracefully', () => {
    const result = mapAnalysisToRaidCandidates({
      risks: [{ description: 'Basic risk', severity: 'medium' }],
      decisions: [{ decision: 'Basic decision' }],
      dependencies: [{ description: 'Basic dep' }],
    });
    expect(result).toHaveLength(3);
    expect(result[0].mitigationPlan).toBeUndefined();
    expect(result[1].rationale).toBeUndefined();
    expect(result[1].decidedBy).toBeUndefined();
  });
});
