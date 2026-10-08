import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * People list (user decision 2026-10-05, Option B): project managers manage ordinary people;
 * only the company owner or a PMO chooses line managers, changes the email of someone who signs
 * in, adds someone whose email is a login, or removes someone who signs in (or their login);
 * nobody does these to the owner's own record.
 */
const db = vi.hoisted(() => ({ queryControlPlane: vi.fn() }));
vi.mock('../../database/connection', () => ({ databaseService: db }));
vi.mock('../../middleware/requestContext', async (importOriginal) => ({ ...(await importOriginal<any>()), getRequestContext: () => ({ organizationId: 'o1' }) }));
vi.mock('../../services/OrganizationService', () => ({ organizationService: { invalidateUserCache: vi.fn() } }));

import { checkCreate, checkUpdate, checkDelete, removeLogin, canManageLogins, MSG } from '../../services/peopleRights';

const OWNER = 'owner-1';
const LOGINS: Record<string, string> = { 'ann@co.com': 'ann-1', 'owner@co.com': OWNER };
const owner = { userId: OWNER, role: 'project_manager' };
const pm = { userId: 'pm-1', role: 'project_manager' };
const pmo = { userId: 'pmo-1', role: 'pmo' };
const person = (over: any = {}) => ({ id: 'r1', name: 'X', email: 'x@co.com', userId: null, lineManagerUserId: OWNER, ...over }) as any;

beforeEach(() => {
  db.queryControlPlane.mockReset();
  db.queryControlPlane.mockImplementation(async (sql: string, params: any[]) => {
    if (/FROM organizations/.test(sql)) return [{ owner_user_id: OWNER }];
    if (/FROM users WHERE LOWER\(email\)/.test(sql)) return LOGINS[String(params[0]).toLowerCase()] ? [{ id: LOGINS[String(params[0]).toLowerCase()] }] : [];
    return [];
  });
});

describe('who manages logins', () => {
  it('the company owner and a PMO — not a project manager', async () => {
    expect(await canManageLogins(owner)).toBe(true);
    expect(await canManageLogins(pmo)).toBe(true);
    expect(await canManageLogins(pm)).toBe(false);
    expect(await canManageLogins(undefined)).toBe(false);
  });
});

describe('adding people', () => {
  it('a PM adds ordinary people (default line manager)', async () => {
    await expect(checkCreate(pm, { email: 'new@co.com' })).resolves.toBeUndefined();
  });
  it("a PM can't choose a line manager", async () => {
    await expect(checkCreate(pm, { email: 'new@co.com', lineManagerUserId: 'pm-1' })).rejects.toThrow(MSG.lineManager);
  });
  it("a PM can't add someone whose email is a login", async () => {
    await expect(checkCreate(pm, { email: 'Ann@co.com' })).rejects.toThrow(MSG.addLogin);
  });
  it('the owner and PMO can do both', async () => {
    await expect(checkCreate(owner, { email: 'ann@co.com', lineManagerUserId: 'pm-1' })).resolves.toBeUndefined();
    await expect(checkCreate(pmo, { email: 'ann@co.com', lineManagerUserId: 'pm-1' })).resolves.toBeUndefined();
  });
});

describe('editing people', () => {
  it('a PM edits ordinary details', async () => {
    await expect(checkUpdate(pm, person(), { email: 'x@co.com' } as any)).resolves.toBeUndefined();
    await expect(checkUpdate(pm, person(), { email: 'typo-fixed@co.com' })).resolves.toBeUndefined();
  });
  it("a PM can't change anyone's line manager (e.g. make themselves the approver)", async () => {
    await expect(checkUpdate(pm, person(), { lineManagerUserId: 'pm-1' })).rejects.toThrow(MSG.lineManager);
  });
  it('saving the same line manager again is fine', async () => {
    await expect(checkUpdate(pm, person(), { lineManagerUserId: OWNER })).resolves.toBeUndefined();
  });
  it("a PM can't change the email of someone who signs in, or point an email at a login", async () => {
    await expect(checkUpdate(pm, person({ userId: 'ann-1', email: 'ann@co.com' }), { email: 'other@co.com' })).rejects.toThrow(MSG.loginEmail);
    await expect(checkUpdate(pm, person(), { email: 'ann@co.com' })).rejects.toThrow(MSG.loginEmail);
  });
  it("nobody but the owner changes the owner's own record", async () => {
    const own = person({ userId: OWNER, email: 'owner@co.com' });
    await expect(checkUpdate(pmo, own, { email: 'new@co.com' })).rejects.toThrow(MSG.owner);
    await expect(checkUpdate(owner, own, { email: 'new@co.com' })).resolves.toBeUndefined();
  });
});

describe('removing people', () => {
  it('a PM removes people without a login, not people who sign in, and never a login', async () => {
    await expect(checkDelete(pm, [person()], false)).resolves.toBeUndefined();
    await expect(checkDelete(pm, [person(), person({ userId: 'ann-1' })], false)).rejects.toThrow(MSG.deleteLogin);
    await expect(checkDelete(pm, [person()], true)).rejects.toThrow(MSG.removeAccess);
  });
  it('the owner and PMO can, but nobody removes the owner', async () => {
    await expect(checkDelete(pmo, [person({ userId: 'ann-1' })], true)).resolves.toBeUndefined();
    await expect(checkDelete(owner, [person({ userId: OWNER })], false)).rejects.toThrow(MSG.owner);
  });
  it("removing the login works now (it silently did nothing) — this company's login only, never the owner", async () => {
    expect(await removeLogin(person({ userId: 'ann-1' }))).toBe(true);
    const upd = db.queryControlPlane.mock.calls.find(c => /UPDATE users/.test(c[0]))!;
    expect(upd[1]).toEqual(['ann-1', 'o1']);
    db.queryControlPlane.mockClear();
    expect(await removeLogin(person({ userId: OWNER }))).toBe(false);
    expect(db.queryControlPlane.mock.calls.some(c => /UPDATE users/.test(c[0]))).toBe(false);
  });
});

describe('guard: every people-list write goes through the rules', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'routes', 'resources', 'resources.ts'), 'utf-8');
  it.each([
    ["fastify.post('/'", 'checkCreate('],
    ["fastify.put('/:id'", 'checkUpdate('],
    ["fastify.delete('/:id'", 'checkDelete('],
    ["fastify.post('/bulk-delete'", 'checkDelete('],
    ["fastify.post('/import'", 'checkCreate('],
  ])('%s → %s', (route, check) => {
    const start = src.indexOf(route);
    expect(start).toBeGreaterThan(-1);
    const next = src.indexOf('fastify.', start + route.length);
    expect(src.slice(start, next === -1 ? undefined : next)).toContain(check);
  });
  it('no more silent login removal by email', () => {
    expect(src).not.toMatch(/\(request\.user as any\)\?\.organizationId/);
  });
});

// request.user carries only userId / username / role (+ flags). Reading a name, email or company
// off it silently gives nothing — that broke "remove their login", the Invite button and invite
// emails' sender name (found 2026-10-05). Look them up instead.
describe('guard: nothing reads fields request.user does not have', () => {
  it('no route or service reads request.user.fullName / email / organizationId', () => {
    const { readdirSync, statSync } = require('fs') as typeof import('fs');
    const root = join(__dirname, '..', '..');
    const bad: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) { if (f !== '__tests__' && f !== 'node_modules') walk(p); continue; }
        if (!f.endsWith('.ts')) continue;
        const text = readFileSync(p, 'utf-8');
        for (const m of text.matchAll(/request\.user( as any)?\)?[!?]?\.(fullName|email|organizationId|orgId)/g)) bad.push(`${p.slice(root.length + 1)}: ${m[0]}`);
      }
    };
    walk(root);
    expect(bad).toEqual([]);
  });
});
