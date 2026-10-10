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

import { AIContextBuilder, PROMPT_TASK_LIMIT, CHAT_PROMPT_TASK_LIMIT, type ProjectContext } from '../../services/aiContextBuilder';
import { chatRepository } from '../../database/ChatRepository';
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

  it("drops each action's data (a whole task list) and keeps its outcome line", async () => {
    const bigData = Array.from({ length: 5000 }, (_, i) => ({ id: `t${i}`, name: `Task ${i}` }));
    await chatRepository.addMessage('c1', {
      role: 'assistant',
      content: 'Here are your tasks',
      actions: [{ success: true, toolName: 'list_tasks', summary: 'Found 5000 tasks', data: bigData }],
    });
    const stored = JSON.parse(queryRaw.mock.calls[0][1][4]);
    expect(stored).toEqual([{ success: true, toolName: 'list_tasks', summary: 'Found 5000 tasks' }]);
  });

  it('a message without actions stores none', async () => {
    await chatRepository.addMessage('c1', { role: 'user', content: 'hello' });
    expect(queryRaw.mock.calls[0][1][4]).toBeNull();
  });
});
