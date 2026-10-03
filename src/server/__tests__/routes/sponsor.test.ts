import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Project sponsor + RAID escalation (Oct 2026, the user's rules): the sponsor can be anyone,
 * with or without a login; nothing reaches them automatically — at Critical the PM is prompted;
 * the PM is in total control (sets the sponsor, decides, writes the note).
 */

const who = vi.hoisted(() => ({ user: { userId: 'pm-1', role: 'project_manager' } as any, projectRole: 'manager' as string }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, maskPii: (v: string) => v }));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = who.user; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({
  requireProjectAccess: (min: string) => vi.fn(async (_req: any, reply: any) => {
    const rank: Record<string, number> = { viewer: 1, editor: 2, manager: 3, owner: 4 };
    if ((rank[who.projectRole] ?? 0) < rank[min]) return reply.status(403).send({ error: 'Forbidden', message: "Only the project's Manager or Owner can change this." });
  }),
}));
vi.mock('../../config', () => ({ config: { APP_URL: 'https://app.test' } }));

const state = vi.hoisted(() => ({ sponsorUser: null as string | null, sponsorRes: null as string | null, updates: [] as any[] }));
const db = vi.hoisted(() => ({
  query: vi.fn(async (sql: string, params: any[] = []) => {
    if (sql.startsWith('SELECT sponsor_user_id')) return [{ u: state.sponsorUser, r: state.sponsorRes }];
    if (sql.startsWith('UPDATE projects SET sponsor_user_id')) { state.sponsorUser = params[0]; state.sponsorRes = params[1]; return { affectedRows: 1 }; }
    if (sql.includes('FROM resources WHERE id = ? AND')) return params[0] === 'res-noemail' ? [{ id: 'res-noemail', email: '' }] : params[0] === 'res-1' ? [{ id: 'res-1', email: 'priya@client.com' }] : [];
    if (sql.startsWith('SELECT id, name, email FROM resources WHERE id')) return params[0] === 'res-1' ? [{ id: 'res-1', name: 'Priya Nair', email: 'priya@client.com' }] : [];
    if (sql.includes('FROM resources') && sql.includes('is_generic')) return [{ id: 'res-1', name: 'Priya Nair', email: 'priya@client.com', user_id: null }, { id: 'demo-res-4', name: 'Alex Thompson', email: 'a@example.com', user_id: null }];
    return [];
  }),
}));
vi.mock('../../database/connection', () => ({ databaseService: db }));
const users: Record<string, any> = {
  'pm-1': { id: 'pm-1', username: 'sam', fullName: 'Sam Okafor', email: 'sam@co.com', isActive: true, isGuest: false },
  'exec-1': { id: 'exec-1', username: 'dana', fullName: 'Dana Whitfield', email: 'dana@co.com', isActive: true, isGuest: false },
  'other-co': { id: 'other-co', username: 'x', fullName: 'Outsider', email: 'x@else.com', isActive: true, isGuest: false },
};
vi.mock('../../services/UserService', () => ({ userService: {
  findById: vi.fn(async (id: string) => users[id] ?? null),
  listByOrganization: vi.fn(async () => [users['pm-1'], users['exec-1']]),
} }));
vi.mock('../../services/OrganizationService', () => ({ organizationService: { findByUserId: vi.fn(async () => ({ id: 'org-1' })) } }));
const members = vi.hoisted(() => ({ findMembership: vi.fn(async () => undefined), addMember: vi.fn(async () => ({})) }));
vi.mock('../../services/ProjectMemberService', () => ({ projectMemberService: members }));
const project = vi.hoisted(() => ({ isDemo: false }));
vi.mock('../../services/ProjectService', () => ({ projectService: { findById: vi.fn(async (id: string) => ({ id, name: 'DBJ-Loans', isDemo: project.isDemo })) } }));
const item = { id: 'r-4', projectId: 'p-1', type: 'issue', title: 'Vendor API contract not signed', recordId: 'I-004', severity: 'critical', status: 'open', dueDate: '2026-10-10', escalatedAt: null, escalationPromptDismissedAt: null };
const risk = vi.hoisted(() => ({ findById: vi.fn(), addUpdate: vi.fn(async () => ({})) }));
vi.mock('../../services/RiskService', () => ({ riskService: risk }));
const repo = vi.hoisted(() => ({ update: vi.fn(async (_id: string, data: any) => ({ ...data })) }));
vi.mock('../../database/RiskRepository', () => ({ riskRepository: repo }));
const notify = vi.hoisted(() => ({ create: vi.fn(async () => ({})) }));
vi.mock('../../services/NotificationService', () => ({ notificationService: notify }));
const email = vi.hoisted(() => ({ sendNotificationEmail: vi.fn(async () => {}) }));
vi.mock('../../services/EmailService', () => ({ emailService: email }));

import { sponsorRoutes } from '../../routes/collaboration/sponsor';
import { needsEscalationPrompt } from '../../services/SponsorService';

describe('the Critical prompt (nothing is automatic)', () => {
  const base = { type: 'issue', severity: 'critical', status: 'open', escalatedAt: null, escalationPromptDismissedAt: null } as any;
  it('asks the PM about an open Critical risk or issue', () => {
    expect(needsEscalationPrompt(base)).toBe(true);
    expect(needsEscalationPrompt({ ...base, type: 'risk' })).toBe(true);
  });
  it('not for High, actions, closed items, once escalated, or after "Not now"', () => {
    expect(needsEscalationPrompt({ ...base, severity: 'high' })).toBe(false);
    expect(needsEscalationPrompt({ ...base, type: 'action' })).toBe(false);
    expect(needsEscalationPrompt({ ...base, status: 'resolved' })).toBe(false);
    expect(needsEscalationPrompt({ ...base, escalatedAt: '2026-10-03' })).toBe(false);
    expect(needsEscalationPrompt({ ...base, escalationPromptDismissedAt: '2026-10-03' })).toBe(false);
  });
});

describe('sponsor routes', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(sponsorRoutes, { prefix: '/api/v1/projects' }); }, 60_000);
  beforeEach(() => {
    vi.clearAllMocks();
    who.user = { userId: 'pm-1', role: 'project_manager' }; who.projectRole = 'manager';
    state.sponsorUser = null; state.sponsorRes = null; project.isDemo = false;
    risk.findById.mockResolvedValue({ ...item });
  });

  it('escalating with no sponsor says what to do, and sends nothing', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/projects/p-1/risks/r-4/escalate', payload: { note: 'Need a decision' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Set a sponsor in the project details first.');
    expect(notify.create).not.toHaveBeenCalled();
    expect(email.sendNotificationEmail).not.toHaveBeenCalled();
  });

  it('the PM sets a sponsor with a login: they become a Viewer so they can read what is escalated', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/v1/projects/p-1/sponsor', payload: { userId: 'exec-1' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().sponsor).toMatchObject({ kind: 'user', id: 'exec-1', name: 'Dana Whitfield' });
    expect(members.addMember).toHaveBeenCalledWith('p-1', expect.objectContaining({ userId: 'exec-1', role: 'viewer' }));
  });

  it('someone from another company cannot be sponsor', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/v1/projects/p-1/sponsor', payload: { userId: 'other-co' } });
    expect(res.statusCode).toBe(400);
    expect(state.sponsorUser).toBeNull();
  });

  it('a person without a login needs an email, or escalations could not reach them', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/v1/projects/p-1/sponsor', payload: { resourceId: 'res-noemail' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/no email address/);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/projects/p-1/sponsor', payload: { resourceId: 'res-1' } })).statusCode).toBe(200);
  });

  it('the PM escalates with a note: recorded on the item, the sponsor is notified and emailed', async () => {
    state.sponsorUser = 'exec-1';
    const res = await app.inject({ method: 'POST', url: '/api/v1/projects/p-1/risks/r-4/escalate', payload: { note: 'Need a decision by Fri' } });
    expect(res.statusCode).toBe(200);
    expect(repo.update).toHaveBeenCalledWith('r-4', expect.objectContaining({ escalatedBy: 'pm-1' }));
    expect(risk.addUpdate).toHaveBeenCalledWith('r-4', 'p-1', 'pm-1', 'Escalated to sponsor Dana Whitfield: "Need a decision by Fri"');
    expect(notify.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'exec-1', linkType: 'raid', linkId: 'r-4' }));
    expect(email.sendNotificationEmail).toHaveBeenCalledWith('dana@co.com', expect.stringContaining('I-004'), expect.any(String), expect.stringContaining('Need a decision by Fri'), 'https://app.test/project/p-1?tab=raid', 'Open the item');
  });

  it('a sponsor without a login is emailed only', async () => {
    state.sponsorRes = 'res-1';
    await app.inject({ method: 'POST', url: '/api/v1/projects/p-1/risks/r-4/escalate', payload: { note: 'FYI' } });
    expect(notify.create).not.toHaveBeenCalled();
    expect(email.sendNotificationEmail).toHaveBeenCalledWith('priya@client.com', expect.any(String), expect.any(String), expect.any(String), undefined, undefined);
  });

  it('a note is required', async () => {
    state.sponsorUser = 'exec-1';
    const res = await app.inject({ method: 'POST', url: '/api/v1/projects/p-1/risks/r-4/escalate', payload: { note: '  ' } });
    expect(res.statusCode).toBe(400);
    expect(notify.create).not.toHaveBeenCalled();
  });

  it('only the PM: a team member or viewer can neither set the sponsor, escalate, nor dismiss', async () => {
    who.projectRole = 'editor';
    state.sponsorUser = 'exec-1';
    expect((await app.inject({ method: 'PUT', url: '/api/v1/projects/p-1/sponsor', payload: { userId: 'exec-1' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/v1/projects/p-1/risks/r-4/escalate', payload: { note: 'x' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/v1/projects/p-1/risks/r-4/escalation-prompt/dismiss' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/projects/p-1/sponsor/candidates' })).statusCode).toBe(403);
    expect(notify.create).not.toHaveBeenCalled();
    // …but anyone on the project sees who the sponsor is (no email)
    who.projectRole = 'viewer';
    const seen = await app.inject({ method: 'GET', url: '/api/v1/projects/p-1/sponsor' });
    expect(seen.json().sponsor).toEqual({ kind: 'user', id: 'exec-1', name: 'Dana Whitfield' });
  });

  it('the PM picks from the company: people with a login, then people with an email (no example people)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/projects/p-1/sponsor/candidates' });
    expect(res.json().candidates.map((c: any) => `${c.kind}:${c.name}`)).toEqual(['user:Dana Whitfield', 'user:Sam Okafor', 'person:Priya Nair']);
  });

  it('"Not now" hides the prompt for that item', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/projects/p-1/risks/r-4/escalation-prompt/dismiss' });
    expect(res.statusCode).toBe(200);
    expect(repo.update).toHaveBeenCalledWith('r-4', expect.objectContaining({ escalationPromptDismissedAt: expect.any(String) }));
  });

  it('an item from another project is not found', async () => {
    risk.findById.mockResolvedValue({ ...item, projectId: 'p-2' });
    state.sponsorUser = 'exec-1';
    expect((await app.inject({ method: 'POST', url: '/api/v1/projects/p-1/risks/r-4/escalate', payload: { note: 'x' } })).statusCode).toBe(404);
  });

  it('the sample project is read-only', async () => {
    project.isDemo = true;
    expect((await app.inject({ method: 'PUT', url: '/api/v1/projects/p-1/sponsor', payload: { userId: 'exec-1' } })).statusCode).toBe(403);
  });
});
