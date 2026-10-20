import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Report Builder in plain words (2026-10-20): POST /draft (words → draft, one AI call, not saved)
 * and POST /preview (unsaved sections → figures). Report builders only; rules checked; the AI's
 * refusals say why.
 */
const who = vi.hoisted(() => ({ role: 'project_manager', ai: true }));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: who.role }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireTier', () => ({
  requireFeature: (f: string) => vi.fn(async (_req: any, reply: any) => {
    if (f === 'ai_assistant' && !who.ai) return reply.status(403).send({ error: 'Upgrade required', message: 'Your plan has no AI.' });
  }),
  hasFeature: vi.fn(async (_req: any, f: string) => (f === 'ai_assistant' ? who.ai : true)),
}));
vi.mock('../../middleware/rateLimiter', () => ({ heavyActionLimit: () => vi.fn(async () => {}) }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../utils/readableProjects', () => ({ readableProjectIds: vi.fn(async () => new Set(['p1'])) }));
const svc = vi.hoisted(() => ({ generateSections: vi.fn(async () => ({ sections: [] })), getTemplates: vi.fn(async () => []) }));
vi.mock('../../services/ReportBuilderService', () => ({ reportBuilderService: svc }));
const words = vi.hoisted(() => ({ draft: vi.fn() }));
vi.mock('../../services/reportBuilder/reportFromWords', () => ({ draftReportFromWords: words.draft, MAX_REQUEST_CHARS: 1000 }));
vi.mock('../../services/AIBudgetService', () => {
  class AIBudgetExceededError extends Error { statusCode = 402; }
  return { AIBudgetExceededError };
});
vi.mock('../../services/claudeService', () => {
  class AIPromptTooLargeError extends Error { statusCode = 422; }
  return { AIPromptTooLargeError, isAIUnavailableError: (e: any) => e?.unavailable === true };
});

import { reportBuilderRoutes } from '../../routes/reporting/reportBuilder';
import { AIBudgetExceededError } from '../../services/AIBudgetService';

describe('Report Builder draft and preview routes', () => {
  let app: any;
  beforeAll(async () => {
    app = Fastify();
    await app.register(reportBuilderRoutes, { prefix: '/api/v1/report-builder' });
  }, 60_000);
  beforeEach(() => {
    vi.clearAllMocks();
    who.role = 'project_manager';
    who.ai = true;
    words.draft.mockResolvedValue({ sections: [{ type: 'kpi_card', dataSource: 'projects' }], notDone: [] });
  });

  const draft = (body: unknown) => app.inject({ method: 'POST', url: '/api/v1/report-builder/draft', payload: body });
  const preview = (body: unknown) => app.inject({ method: 'POST', url: '/api/v1/report-builder/preview', payload: body });

  it('a PM gets a draft; nothing is saved', async () => {
    const r = await draft({ request: 'tasks by status' });
    expect(r.statusCode).toBe(200);
    expect(r.json().draft.sections).toHaveLength(1);
    expect(words.draft).toHaveBeenCalledWith('tasks by status', undefined, { userId: 'u1', role: 'project_manager' });
  });

  it('team members and viewers are refused, and no AI is called', async () => {
    for (const role of ['team_member', 'viewer']) {
      who.role = role;
      const r = await draft({ request: 'x' });
      expect(r.statusCode).toBe(403);
    }
    expect(words.draft).not.toHaveBeenCalled();
  });

  it('a plan without AI is refused before any call', async () => {
    who.ai = false;
    const r = await draft({ request: 'x' });
    expect(r.statusCode).toBe(403);
    expect(words.draft).not.toHaveBeenCalled();
  });

  it('an empty or too-long request says what to do', async () => {
    expect((await draft({ request: '   ' })).statusCode).toBe(400);
    expect((await draft({ request: 'a'.repeat(1001) })).statusCode).toBe(400);
  });

  it('no AI left this month: the reason, not a server error', async () => {
    words.draft.mockRejectedValueOnce(new AIBudgetExceededError('You have used this month\'s AI.'));
    const r = await draft({ request: 'x' });
    expect(r.statusCode).toBe(402);
    expect(r.json().message).toMatch(/this month/);
  });

  it('AI down: a plain message offering the hand-built path', async () => {
    words.draft.mockRejectedValueOnce(Object.assign(new Error('overloaded'), { unavailable: true }));
    const r = await draft({ request: 'x' });
    expect(r.statusCode).toBe(503);
    expect(r.json().message).toMatch(/build the report by hand/);
  });

  it('preview runs the sections limited to what this person may read', async () => {
    const r = await preview({ sections: [{ type: 'table', dataSource: 'tasks', filters: { overdue: true }, groupBy: 'assignee' }] });
    expect(r.statusCode).toBe(200);
    expect(svc.generateSections).toHaveBeenCalledWith([{ type: 'table', dataSource: 'tasks', filters: { overdue: true }, groupBy: 'assignee' }], undefined, new Set(['p1']));
  });

  it('preview refuses a grouping the builder does not offer (it fell back to a column the source may lack)', async () => {
    const r = await preview({ sections: [{ title: 'People', type: 'bar_chart', dataSource: 'resources', groupBy: 'status' }] });
    expect(r.statusCode).toBe(400);
    expect(r.json().message).toMatch(/can't be grouped by status/);
    expect(svc.generateSections).not.toHaveBeenCalled();
  });

  it('the template list says whether the describe box is shown: a report role with AI only', async () => {
    const list = () => app.inject({ method: 'GET', url: '/api/v1/report-builder/templates' });
    expect((await list()).json().canDraft).toBe(true);
    who.ai = false;
    expect((await list()).json().canDraft).toBe(false);
    who.ai = true; who.role = 'team_member';
    expect((await list()).json().canDraft).toBe(false);
  });

  it('preview refuses a part the builder does not have, and other roles', async () => {
    expect((await preview({ sections: [{ type: 'map', dataSource: 'tasks' }] })).statusCode).toBe(400);
    who.role = 'team_member';
    expect((await preview({ sections: [{ type: 'kpi_card', dataSource: 'tasks' }] })).statusCode).toBe(403);
    expect(svc.generateSections).not.toHaveBeenCalled();
  });
});
