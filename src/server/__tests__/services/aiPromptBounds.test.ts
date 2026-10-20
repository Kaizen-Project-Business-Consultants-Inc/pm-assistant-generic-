import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Audit 2026-10-10 H1: the project prompt, and what a chat keeps forever, are bounded.
 * - toPromptString lists at most N task lines (open tasks first when over), saying how many exist.
 * - A stored chat message keeps each Mjuzi action's outcome line, not the tool's data.
 */
vi.mock('../../services/ProjectService', () => ({ ProjectService: class {} }));
vi.mock('../../services/ScheduleService', () => ({ ScheduleService: class {} }));
vi.mock('../../database/RiskRepository', () => ({ riskRepository: {} }));
vi.mock('../../database/ApprovalWorkflowRepository', () => ({ approvalWorkflowRepository: {} }));
const queryRaw = vi.hoisted(() => vi.fn());
vi.mock('../../database/BaseRepository', () => ({
  BaseRepository: class {
    queryRaw = queryRaw;
  },
}));

import { AIContextBuilder, PROMPT_TASK_LIMIT, CHAT_PROMPT_TASK_LIMIT, PORTFOLIO_PROMPT_PROJECT_LIMIT, type ProjectContext } from '../../services/aiContextBuilder';
import { chatRepository, actionRefsOf } from '../../database/ChatRepository';
import { limitRows, limitGrouped } from '../../services/aiToolLimits';

function ctxWith(taskCounts: Array<{ open: number; done: number }>): ProjectContext {
  return {
    project: { id: 'p1', name: 'Big', status: 'active', priority: 'high', projectType: 'it' },
    schedules: taskCounts.map((c, si) => ({
      id: `s${si}`, name: `Plan ${si}`, startDate: '2026-01-01', endDate: '2026-12-31',
      tasks: [
        ...Array.from({ length: c.done }, (_, i) => ({ id: `d${si}-${i}`, name: `Done ${si}-${i}`, status: 'completed', priority: 'low' })),
        ...Array.from({ length: c.open }, (_, i) => ({ id: `o${si}-${i}`, name: `Open ${si}-${i}`, status: 'pending', priority: 'medium' })),
      ],
    })),
  };
}
const taskLines = (s: string) => s.split('\n').filter((l) => l.startsWith('      * ')).length;

describe('project prompt size', () => {
  const builder = new AIContextBuilder({} as never);

  it('a plan under the limit is listed in full, as before', () => {
    const s = builder.toPromptString(ctxWith([{ open: 20, done: 10 }]));
    expect(taskLines(s)).toBe(30);
    expect(s).not.toMatch(/are listed/);
  });

  it('a 5,000-task project lists at most the limit, open tasks only, and says so', () => {
    const s = builder.toPromptString(ctxWith([{ open: 3000, done: 1000 }, { open: 900, done: 100 }]));
    expect(taskLines(s)).toBe(PROMPT_TASK_LIMIT);
    expect(s).not.toMatch(/Done /);
    expect(s).toMatch(/Tasks \(4000, 3000 open\)/);
    expect(s).toMatch(new RegExp(`Only ${PROMPT_TASK_LIMIT} of 5000 tasks are listed`));
    expect(s.length).toBeLessThan(40_000); // was about 375k characters (~95k tokens) per call
  });

  it("Mjuzi's chat prompt carries fewer lines", () => {
    const s = builder.toPromptString(ctxWith([{ open: 500, done: 0 }]), CHAT_PROMPT_TASK_LIMIT);
    expect(taskLines(s)).toBe(CHAT_PROMPT_TASK_LIMIT);
  });

  it("Mjuzi's lines carry plan and task ids; other prompts don't (U58)", () => {
    const withIds = builder.toPromptString(ctxWith([{ open: 2, done: 0 }]), CHAT_PROMPT_TASK_LIMIT, true);
    expect(withIds).toMatch(/- Plan 0 id=s0 /);
    expect(withIds).toMatch(/\* Open 0-0 id=o0-0 \[pending\]/);
    const plain = builder.toPromptString(ctxWith([{ open: 2, done: 0 }]));
    expect(plain).not.toMatch(/id=/);
  });

  it('the portfolio lists at most 50 projects, with ids, and says the totals count all (U58)', () => {
    const projects = Array.from({ length: 120 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, status: 'active', priority: 'medium', projectType: 'it' }));
    const s = builder.portfolioToPromptString({
      totalProjects: 120, projects,
      summary: { byStatus: { active: 120 }, byPriority: { medium: 120 }, totalBudget: 0, totalSpent: 0 },
    } as never);
    expect(s.split('\n').filter(l => l.startsWith('- ')).length).toBe(PORTFOLIO_PROMPT_PROJECT_LIMIT);
    expect(s).toMatch(/- P0 id=p0 \[active\]/);
    expect(s).toMatch(/Total Projects: exactly 120/);
    expect(s).toMatch(/Only 50 of 120 projects are listed/);
  });
});

describe('tool row limits', () => {
  it('limitRows cuts long lists with a note and leaves short ones alone', () => {
    expect(limitRows([1, 2, 3])).toEqual({ rows: [1, 2, 3], total: 3 });
    const big = limitRows(Array.from({ length: 450 }, (_, i) => i));
    expect(big.rows).toHaveLength(200);
    expect(big.note).toMatch(/Showing 200 of 450/);
  });

  it('limitGrouped shares the limit across plans in order', () => {
    expect(limitGrouped([[1, 2, 3], [4, 5], [6]], 4)).toEqual([[1, 2, 3], [4], []]);
  });
});

describe('stored chat messages keep only what the chat shows', () => {
  beforeEach(() => {
    queryRaw.mockReset();
    queryRaw.mockResolvedValue([{ id: 'm1', conversation_id: 'c1', role: 'assistant', content: 'hi', actions: null, created_at: 'x' }]);
  });

  it("drops each action's data (a whole task list): keeps its outcome line and the first 30 items' ids (U58)", async () => {
    const bigData = Array.from({ length: 5000 }, (_, i) => ({ id: `t${i}`, name: `Task ${i}`, scheduleId: 's1', description: 'x'.repeat(500) }));
    await chatRepository.addMessage('c1', {
      role: 'assistant',
      content: 'Here are your tasks',
      actions: [{ success: true, toolName: 'list_tasks', summary: 'Found 5000 tasks', data: bigData }],
    });
    const stored = JSON.parse(queryRaw.mock.calls[0][1][4]);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ success: true, toolName: 'list_tasks', summary: 'Found 5000 tasks' });
    expect(stored[0].data).toBeUndefined();
    expect(stored[0].refs).toHaveLength(30);
    expect(stored[0].refs[0]).toEqual({ id: 't0', name: 'Task 0', scheduleId: 's1' }); // no description
  });

  it('an action whose result holds lists (update_tasks) keeps those items too', async () => {
    await chatRepository.addMessage('c1', {
      role: 'assistant',
      content: 'Done',
      actions: [{ success: true, toolName: 'update_tasks', summary: 'Updated 2', data: { updated: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], failed: [] } }],
    });
    const stored = JSON.parse(queryRaw.mock.calls[0][1][4]);
    expect(stored[0].refs).toEqual([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  });

  it('a message without actions stores none', async () => {
    await chatRepository.addMessage('c1', { role: 'user', content: 'hello' });
    expect(queryRaw.mock.calls[0][1][4]).toBeNull();
  });
});

describe('actionRefsOf — the items an action named (U58)', () => {
  it('reads a list, a single item, and lists inside an object; taskId/taskName count too', () => {
    expect(actionRefsOf([{ id: 'a', name: 'A', scheduleId: 's' }, { nope: 1 }])).toEqual([{ id: 'a', name: 'A', scheduleId: 's' }]);
    expect(actionRefsOf({ taskId: 't1', taskName: 'T1', projectId: 'p' })).toEqual([{ id: 't1', name: 'T1', projectId: 'p' }]);
    expect(actionRefsOf({ updated: [{ id: 'x' }], other: 'y' })).toEqual([{ id: 'x' }]);
    expect(actionRefsOf(null)).toEqual([]);
    expect(actionRefsOf('text')).toEqual([]);
  });

  it("leaves out a 'failed' list: those were not done", () => {
    expect(actionRefsOf({ updated: [{ id: 'ok' }], failed: [{ taskId: 'bad', reason: 'no' }] })).toEqual([{ id: 'ok' }]);
  });

  it('keeps at most 30 items and cuts names at 120 characters', () => {
    const refs = actionRefsOf(Array.from({ length: 50 }, (_, i) => ({ id: `t${i}`, name: 'n'.repeat(300) })));
    expect(refs).toHaveLength(30);
    expect(refs[0].name).toHaveLength(120);
  });

  it('a failed action keeps no items', async () => {
    queryRaw.mockReset();
    queryRaw.mockResolvedValue([{ id: 'm1', conversation_id: 'c1', role: 'assistant', content: 'hi', actions: null, created_at: 'x' }]);
    await chatRepository.addMessage('c1', { role: 'assistant', content: 'x', actions: [{ success: false, toolName: 'update_task', summary: 'Not allowed', data: { taskId: 't1' } }] });
    const stored = JSON.parse(queryRaw.mock.calls[0][1][4]);
    expect(stored[0].refs).toBeUndefined();
  });
});
