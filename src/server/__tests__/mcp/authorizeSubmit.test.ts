import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';

/**
 * Audit 2026-10-09 M3: the page Claude opens to connect was weaker than the app's login — it sent
 * a code to any redirect address, had no attempt limit, and let in people who must change their
 * password. M4: it also wrote the password and bearer keys to the journal (logging is now method
 * + path only; see mcp-server/src/index.ts).
 */
const db = vi.hoisted(() => ({ user: null as Record<string, unknown> | null, inserts: 0, lookedUp: [] as unknown[] }));
vi.mock('../../../../mcp-server/src/db', () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/FROM users/.test(sql)) { db.lookedUp.push(params[0]); return db.user ? [db.user] : []; }
    if (/INSERT INTO oauth_auth_codes/.test(sql)) db.inserts++;
    return [];
  }),
}));

// loaded fresh before each test, so the try counters start at zero
let handleAuthorizeSubmit: typeof import('../../../../mcp-server/src/oauth/authorizeSubmit').handleAuthorizeSubmit;

const HASH = bcrypt.hashSync('right-password', 4);
const clients = {
  getClient: vi.fn(async (id: string) => (id === 'claude' ? { client_id: 'claude', client_name: 'Claude', redirect_uris: ['https://claude.ai/cb'] } : undefined)),
} as any;

function res() {
  const r: any = { statusCode: 200, body: '', location: '' };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.type = () => r;
  r.send = (b: string) => { r.body = b; return r; };
  r.redirect = (c: number, url: string) => { r.statusCode = c; r.location = url; return r; };
  return r;
}
const body = (over: Record<string, string> = {}) => ({
  username: 'pm@example.com', password: 'right-password', client_id: 'claude',
  redirect_uri: 'https://claude.ai/cb', code_challenge: 'cc', state: 's1', ...over,
});
async function submit(over: Record<string, string> = {}, ip = '1.1.1.1') {
  const r = res();
  await handleAuthorizeSubmit({ body: body(over), ip } as any, r, clients);
  return r;
}

describe('Claude connect sign-in page', () => {
  beforeEach(async () => {
    vi.resetModules();
    ({ handleAuthorizeSubmit } = await import('../../../../mcp-server/src/oauth/authorizeSubmit'));
    db.inserts = 0;
    db.lookedUp = [];
    db.user = { id: 'u1', password_hash: HASH, email_verified: 1, must_change_password: 0, is_guest: 0, guest_expires_at: null };
  });

  it('a registered client with its own address and the right password gets a code', async () => {
    const r = await submit();
    expect(r.statusCode).toBe(302);
    expect(r.location).toMatch(/^https:\/\/claude\.ai\/cb\?code=.+&state=s1$/);
    expect(db.inserts).toBe(1);
  });

  it('never sends a code to an address the client did not register', async () => {
    const r = await submit({ redirect_uri: 'https://attacker.example/steal' });
    expect(r.statusCode).toBe(400);
    expect(db.inserts).toBe(0);
  });

  it('refuses an unknown client', async () => {
    const r = await submit({ client_id: 'made-up' });
    expect(r.statusCode).toBe(400);
    expect(db.inserts).toBe(0);
  });

  it('refuses someone who must change their password, and an unverified email', async () => {
    db.user!.must_change_password = 1;
    expect((await submit()).statusCode).toBe(403);
    db.user!.must_change_password = 0;
    db.user!.email_verified = 0;
    expect((await submit()).statusCode).toBe(403);
    expect(db.inserts).toBe(0);
  });

  it('locks a name after 5 wrong passwords, even with the right one next', async () => {
    for (let i = 0; i < 5; i++) expect((await submit({ password: 'wrong' }, `9.9.9.${i}`)).statusCode).toBe(401);
    const r = await submit({}, '8.8.8.8');
    expect(r.statusCode).toBe(429);
    expect(db.inserts).toBe(0);
  });

  it('limits one address to 10 tries a minute', async () => {
    for (let i = 0; i < 10; i++) await submit({ username: `n${i}`, password: 'wrong' }, '2.2.2.2');
    expect((await submit({}, '2.2.2.2')).statusCode).toBe(429);
  });

  it('the lock and the look-up use one form of the name: case and spaces do not dodge the lock', async () => {
    for (let i = 0; i < 5; i++) await submit({ username: i % 2 ? 'PM@Example.com ' : ' pm@example.COM', password: 'wrong' }, `7.7.7.${i}`);
    expect((await submit({}, '6.6.6.6')).statusCode).toBe(429);
    expect(new Set(db.lookedUp)).toEqual(new Set(['pm@example.com']));
  });
});
