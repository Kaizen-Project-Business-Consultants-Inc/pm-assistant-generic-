import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * @mentions were looked up by username across every company's accounts, so "@someone" could notify a
 * person in another company and show them the task's name; and the comment box offered people with no
 * login under made-up handles the server never matched (2026-10-12).
 */

const db = vi.hoisted(() => ({
  tenantRows: [] as { user_id: string | null }[],
  users: [] as { id: string; full_name: string | null; username: string; is_active: number; organization_id: string | null }[],
  org: 'org-a' as string | undefined,
  cpSql: [] as { sql: string; params: unknown[] }[],
}));
vi.mock('../../database/connection', () => ({
  databaseService: {
    query: vi.fn(async () => db.tenantRows),
    queryControlPlane: vi.fn(async (sql: string, params: unknown[]) => {
      db.cpSql.push({ sql, params });
      const byOrg = sql.includes('organization_id = ?');
      const ids = (byOrg ? params.slice(0, -1) : params) as string[];
      const org = byOrg ? params.at(-1) : undefined;
      return db.users.filter((u) => ids.includes(u.id) && (!byOrg || u.organization_id === org));
    }),
  },
}));

vi.mock('../../middleware/requestContext', () => ({ getRequestContext: () => (db.org ? { organizationId: db.org } : undefined) }));
const cfg = vi.hoisted(() => ({ MULTI_TENANT_ENABLED: true }));
vi.mock('../../config', () => ({ config: cfg }));

import { mentionablePeople, mentionedHandles, inCurrentCompany } from '../../utils/mentionablePeople';

describe('who can be @mentioned', () => {
  beforeEach(() => {
    db.cpSql = [];
    db.org = 'org-a';
    cfg.MULTI_TENANT_ENABLED = true;
    db.users = [
      { id: 'u-jane', full_name: 'Jane Doe', username: 'jane_3fa9c1', is_active: 1, organization_id: 'org-a' },
      { id: 'u-raj', full_name: null, username: 'raj', is_active: 1, organization_id: 'org-a' },
      { id: 'u-gone', full_name: 'Left Company', username: 'gone', is_active: 0, organization_id: 'org-a' },
      { id: 'u-other-co', full_name: 'Other Company Person', username: 'someone', is_active: 1, organization_id: 'org-b' },
    ];
  });

  it("only the project's members with a login and its creator — full names, the username as the handle, no emails", async () => {
    db.tenantRows = [{ user_id: 'u-jane' }, { user_id: 'u-raj' }, { user_id: 'u-gone' }, { user_id: null }];
    const people = await mentionablePeople('p1');
    expect(people).toEqual([
      { userId: 'u-jane', name: 'Jane Doe', handle: 'jane_3fa9c1' },
      { userId: 'u-raj', name: 'raj', handle: 'raj' },
    ]);
    expect(people.find((p) => p.userId === 'u-other-co')).toBeUndefined(); // never looked up: not on the project
    expect(db.cpSql[0].params).toEqual(['u-jane', 'u-raj', 'u-gone', 'org-a']);
    expect(JSON.stringify(people)).not.toMatch(/email/);
  });

  it('a project with nobody to mention asks nothing further', async () => {
    db.tenantRows = [];
    expect(await mentionablePeople('p1')).toEqual([]);
    expect(db.cpSql).toHaveLength(0);
  });

  it('reads the @handles in a comment: no repeats, at most 20', () => {
    expect(mentionedHandles('ping @jane_3fa9c1 and @raj, also @jane_3fa9c1.')).toEqual(['jane_3fa9c1', 'raj']);
    expect(mentionedHandles(Array.from({ length: 30 }, (_, i) => `@p${i}`).join(' '))).toHaveLength(20);
    expect(mentionedHandles('no mentions here')).toEqual([]);
  });

  it('the comment route resolves mentions through the project only, and names people by full name', () => {
    const route = readFileSync(join(__dirname, '../../routes/scheduling/schedules.ts'), 'utf8');
    expect(route).not.toMatch(/findByUsernames/);
    expect(route).toMatch(/mentionablePeople\(projectId\)/);
    expect(route).toMatch(/inCurrentCompany\(assigneeLogin\)/);
    expect(route).toMatch(/title: `\$\{authorName\} mentioned you`/);
    expect(route).not.toMatch(/\$\{user\.username\}/);
  });

  it('someone removed from this company (their project rows stay) is not mentionable, nor told about comments', async () => {
    db.tenantRows = [{ user_id: 'u-jane' }, { user_id: 'u-other-co' }];
    expect((await mentionablePeople('p1')).map((p) => p.userId)).toEqual(['u-jane']);
    expect(await inCurrentCompany('u-jane')).toBe(true);
    expect(await inCurrentCompany('u-other-co')).toBe(false);
  });

  it('company unknown on a multi-company server: nobody (never everybody); single-company setups: no company filter', async () => {
    db.tenantRows = [{ user_id: 'u-jane' }];
    db.org = undefined;
    expect(await mentionablePeople('p1')).toEqual([]);
    expect(await inCurrentCompany('u-jane')).toBe(false);
    cfg.MULTI_TENANT_ENABLED = false;
    expect((await mentionablePeople('p1')).map((p) => p.userId)).toEqual(['u-jane']);
    expect(await inCurrentCompany('u-jane')).toBe(true);
  });
});
