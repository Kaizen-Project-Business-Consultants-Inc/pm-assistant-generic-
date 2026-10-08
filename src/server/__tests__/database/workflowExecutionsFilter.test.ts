import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * findExecutions' visibility filter (2026-10-08): runs of the caller's projects' workflows, and
 * runs of company-wide workflows only on tasks in the caller's projects. Nothing visible → no query.
 */
const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../database/connection', () => ({ databaseService: db }));

import { workflowRepository } from '../../database/WorkflowRepository';

describe('workflowRepository.findExecutions({ visibleTo })', () => {
  beforeEach(() => { db.query.mockReset().mockResolvedValue([]); });

  it("project workflows' runs, plus company-wide runs on tasks in the caller's projects", async () => {
    await workflowRepository.findExecutions({ visibleTo: { projectWorkflowIds: ['a', 'b'], orgWorkflowIds: ['o'], projectIds: ['p1', 'p2'] }, limit: 50 });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('workflow_id IN (?,?)');
    expect(sql).toContain("(workflow_id IN (?) AND entity_type = 'task' AND entity_id IN (SELECT t.id FROM tasks t JOIN schedules s ON s.id = t.schedule_id WHERE s.project_id IN (?,?)))");
    expect(sql).toContain('ORDER BY started_at DESC');
    expect(params).toEqual(['a', 'b', 'o', 'p1', 'p2', 50]);
  });

  it('a named workflow and the visibility filter both apply', async () => {
    await workflowRepository.findExecutions({ workflowId: 'o', visibleTo: { projectWorkflowIds: [], orgWorkflowIds: ['o'], projectIds: ['p1'] } });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/workflow_id = \? AND \(\(workflow_id IN/);
    expect(params).toEqual(['o', 'o', 'p1', 50]);
  });

  it('nothing visible (no projects, no project workflows) → no runs and no query', async () => {
    expect(await workflowRepository.findExecutions({ visibleTo: { projectWorkflowIds: [], orgWorkflowIds: ['o'], projectIds: [] } })).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });
});
