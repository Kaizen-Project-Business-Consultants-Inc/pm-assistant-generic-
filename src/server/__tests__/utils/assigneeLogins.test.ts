import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve, relative } from 'path';

const db = vi.hoisted(() => ({ query: vi.fn(), queryControlPlane: vi.fn() }));
vi.mock('../../database/connection', () => ({ databaseService: db }));
const users = vi.hoisted(() => ({ findById: vi.fn() }));
vi.mock('../../services/UserService', () => ({ userService: users }));

import { loginsForAssignees, loginForAssignee } from '../../utils/assigneeLogins';

/**
 * 2026-10-03: "Task assigned to you", comment and deadline notices never reached people with a
 * login — they were addressed to the task's "assigned to", which holds the person from
 * Resources, not their login (staging log: 'task_assigned error … notifications_ibfk_1').
 */
describe('who to tell about a task', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.query.mockResolvedValue([
      { id: 'res-with-login', user_id: 'user-1' },
      { id: 'res-no-login', user_id: null },
    ]);
    users.findById.mockImplementation(async (id: string) => (id === 'legacy-user' ? { id } : null));
    // The one read for older login ids answers from the same fake as the one-at-a-time look-up
    db.queryControlPlane.mockImplementation(async (_sql: string, ids: string[]) =>
      ids.filter(id => id === 'legacy-user').map(id => ({ id })));
  });

  it('a person from Resources with a login → their login', async () => {
    expect(await loginForAssignee('res-with-login')).toBe('user-1');
  });
  it('a person without a login → nobody (no inbox)', async () => {
    expect(await loginForAssignee('res-no-login')).toBeNull();
  });
  it('older tasks that hold a login id → that login, if it exists', async () => {
    expect(await loginForAssignee('legacy-user')).toBe('legacy-user');
    expect(await loginForAssignee('free text name')).toBeNull();
  });
  it('nothing assigned → nobody, without asking the database', async () => {
    expect(await loginForAssignee(null)).toBeNull();
    expect(await loginForAssignee('  ')).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });
  it('many at once: one look-up for the people', async () => {
    const m = await loginsForAssignees(['res-with-login', 'res-no-login', 'legacy-user', 'res-with-login']);
    expect([...m.entries()]).toEqual([['res-with-login', 'user-1'], ['legacy-user', 'legacy-user']]);
    expect(db.query).toHaveBeenCalledTimes(1);
  });
  it('many older login ids: one read for all of them (per 200), not one each', async () => {
    db.query.mockResolvedValueOnce([]); // none of them is a person from Resources
    const values = ['legacy-user', ...Array.from({ length: 250 }, (_, i) => `gone-${i}`)];
    const m = await loginsForAssignees(values);
    expect([...m.entries()]).toEqual([['legacy-user', 'legacy-user']]);
    expect(db.queryControlPlane.mock.calls.map(c => c[1].length)).toEqual([200, 51]);
    expect(db.queryControlPlane.mock.calls[0][0]).toMatch(/SELECT id FROM users WHERE id IN/);
    expect(users.findById).not.toHaveBeenCalled();
  });
  it('the database compares ids ignoring case: the stored login id is used, as one look-up gave it', async () => {
    db.queryControlPlane.mockResolvedValueOnce([{ id: 'legacy-user' }]);
    expect(await loginForAssignee('LEGACY-USER')).toBe('legacy-user');
  });
  it('if that read fails, each is checked alone as before', async () => {
    db.query.mockResolvedValueOnce([]);
    db.queryControlPlane.mockRejectedValueOnce(new Error('down'));
    const m = await loginsForAssignees(['legacy-user', 'free text name']);
    expect([...m.entries()]).toEqual([['legacy-user', 'legacy-user']]);
    expect(users.findById).toHaveBeenCalledTimes(2);
  });
});

/** Guard: nobody addresses a notification or digest to "assigned to" directly again */
describe('guard', () => {
  const SERVER = resolve(__dirname, '..', '..');
  const files = (dir: string): string[] => readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    if (n === '__tests__' || n === 'node_modules') return [];
    return statSync(p).isDirectory() ? files(p) : /\.ts$/.test(n) ? [p] : [];
  });

  it('no notification is sent to a task\'s "assigned to" without turning it into a login', () => {
    const offenders: string[] = [];
    for (const f of files(SERVER)) {
      const src = readFileSync(f, 'utf-8');
      // userId: <something>.assignedTo / assigned_to / data.assignedTo …
      for (const m of src.matchAll(/userId:\s*(?:[\w?]+\.)*assigned(?:To|_to)\b/g)) offenders.push(`${relative(SERVER, f)}: ${m[0]}`);
      // recipient = row.assigned_to || …
      for (const m of src.matchAll(/(?:recipient|userId)\s*=\s*(?:[\w?]+\.)*assigned(?:To|_to)\s*(?:\|\||\?\?)/g)) offenders.push(`${relative(SERVER, f)}: ${m[0]}`);
    }
    expect(offenders, 'Use loginForAssignee / loginsForAssignees (utils/assigneeLogins.ts)').toEqual([]);
  });

  it('the digest looks tasks up by the login\'s person, not by username', () => {
    expect(readFileSync(join(SERVER, 'services', 'DigestService.ts'), 'utf-8')).not.toMatch(/find(OverdueTasks|UpcomingDeadlines)\(user\.username/);
    const repo = readFileSync(join(SERVER, 'database', 'DigestRepository.ts'), 'utf-8');
    expect(repo.match(/assigned_to IN \(SELECT id FROM resources WHERE user_id = \?\)/g)?.length).toBe(2);
  });

  it('automation writes a person from Resources into "assigned to", not a login', () => {
    expect(readFileSync(join(SERVER, 'services', 'automation', 'actionExecutors.ts'), 'utf-8')).not.toMatch(/assignedTo:\s*picked\.userId/);
  });
});

describe('the digest finds my tasks through my person in Resources', () => {
  it('overdue and due-soon queries match my person (and older tasks that hold my login)', async () => {
    vi.resetModules();
    const q = vi.fn().mockResolvedValue([]);
    vi.doMock('../../database/connection', () => ({ databaseService: { query: q } }));
    const { digestRepository } = await import('../../database/DigestRepository');
    await digestRepository.findOverdueTasks('user-1', '2026-10-03');
    await digestRepository.findUpcomingDeadlines('user-1', '2026-10-03', '2026-10-06');
    for (const [sql, params] of q.mock.calls) {
      expect(sql).toContain('assigned_to = ? OR assigned_to IN (SELECT id FROM resources WHERE user_id = ?)');
      expect(params.slice(0, 2)).toEqual(['user-1', 'user-1']);
    }
    expect(q).toHaveBeenCalledTimes(2);
  });
});
