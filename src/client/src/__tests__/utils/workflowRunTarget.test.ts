import { describe, it, expect } from 'vitest';
import { describeRunTarget } from '../../utils/workflowRunTarget';

describe('describeRunTarget (Workflows → Executions names what a run was about, not its id)', () => {
  it("names the task or project", () => {
    expect(describeRunTarget({ entityType: 'task', entityName: 'Design review' })).toBe('task “Design review”');
    expect(describeRunTarget({ entityType: 'project', entityName: 'Apollo' })).toBe('project “Apollo”');
  });
  it('says when the task or project no longer exists', () => {
    expect(describeRunTarget({ entityType: 'task', entityName: null })).toBe('a task that no longer exists');
    expect(describeRunTarget({ entityType: 'project' })).toBe('a project that no longer exists');
  });
  it('other kinds show only their kind, never an id; unknown shows nothing', () => {
    expect(describeRunTarget({ entityType: 'proposal' })).toBe('a proposal');
    expect(describeRunTarget({ entityType: 'unknown' })).toBe('');
    expect(describeRunTarget({})).toBe('');
  });
});
