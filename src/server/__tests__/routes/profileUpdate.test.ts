import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Audit 2026-10-09 H2: PUT /users/me/profile let a read-only key change the account email, any
 * company member rename the company, and anyone holding a session change email or username with
 * no password. Now: keys need 'write'; email/username need the current password (except picking a
 * username during onboarding); only the owner renames the company; a refused save changes nothing.
 */
const who = vi.hoisted(() => ({ user: { userId: 'u-me', role: 'team_member' } as any, keyScopes: undefined as string[] | undefined }));
vi.mock('../../middleware/auth', () => ({
  authMiddleware: vi.fn(async (req: any) => { req.user = who.user; req.apiKeyScopes = who.keyScopes; }),
}));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('bcryptjs', () => ({ default: { compare: vi.fn(async (pw: string) => pw === 'right-password') } }));
const me = { id: 'u-me', username: 'me', email: 'me@co.test', fullName: 'Me', passwordHash: 'h' };
const users = vi.hoisted(() => ({ findById: vi.fn(), findByUsername: vi.fn(), findByEmail: vi.fn(), update: vi.fn() }));
vi.mock('../../services/UserService', () => ({ userService: users }));
const orgs = vi.hoisted(() => ({ findByUserId: vi.fn(), update: vi.fn() }));
vi.mock('../../database/OrganizationRepository', () => ({ organizationRepository: orgs }));

import { userRoutes } from '../../routes/core/users';

describe('PUT /users/me/profile', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(userRoutes, { prefix: '/api/v1/users' }); }, 60_000);
  beforeEach(() => {
    who.user = { userId: 'u-me', role: 'team_member' };
    who.keyScopes = undefined;
    users.findById.mockReset().mockResolvedValue({ ...me });
    users.findByUsername.mockReset().mockResolvedValue(null);
    users.findByEmail.mockReset().mockResolvedValue(null);
    users.update.mockReset().mockImplementation(async (_id: string, d: any) => ({ ...me, ...d }));
    orgs.findByUserId.mockReset().mockResolvedValue({ id: 'org-1', ownerUserId: 'u-owner' });
    orgs.update.mockReset().mockResolvedValue(undefined);
  });
  const put = (payload: unknown) => app.inject({ method: 'PUT', url: '/api/v1/users/me/profile', payload });

  describe('renaming the company', () => {
    it('a member who is not the owner is refused, and nothing else in the save applies', async () => {
      const res = await put({ fullName: 'New Name', organizationName: 'Hijacked Ltd' });
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toBe('Only the company owner can rename the company.');
      expect(orgs.update).not.toHaveBeenCalled();
      expect(users.update).not.toHaveBeenCalled();
    });

    it('the owner can', async () => {
      who.user = { userId: 'u-owner', role: 'pmo', isOwner: true };
      users.findById.mockResolvedValue({ ...me, id: 'u-owner' });
      const res = await put({ organizationName: 'Renamed Ltd' });
      expect(res.statusCode).toBe(200);
      expect(orgs.update).toHaveBeenCalledWith('org-1', { name: 'Renamed Ltd' });
    });
  });

  describe('changing email or username', () => {
    it('needs the current password', async () => {
      const res = await put({ email: 'attacker@evil.test' });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe('Enter your current password to change your email.');
      expect(users.update).not.toHaveBeenCalled();
    });

    it('a wrong password changes nothing', async () => {
      const res = await put({ fullName: 'X', username: 'stolen', currentPassword: 'guess' });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/current password isn't right, so your username wasn't changed/);
      expect(users.update).not.toHaveBeenCalled();
    });

    it('works with the right password', async () => {
      const res = await put({ email: 'new@co.test', currentPassword: 'right-password' });
      expect(res.statusCode).toBe(200);
      expect(users.update).toHaveBeenCalledWith('u-me', { email: 'new@co.test' });
    });

    it('an email another account uses gets a plain 409, nothing saved', async () => {
      users.findByEmail.mockResolvedValue({ id: 'u-other', email: 'taken@co.test' });
      const res = await put({ email: 'taken@co.test', currentPassword: 'right-password' });
      expect(res.statusCode).toBe(409);
      expect(res.json().message).toBe('That email is already used by another account.');
      expect(users.update).not.toHaveBeenCalled();
    });

    it('saving the name with the unchanged email (what Settings sends) needs no password', async () => {
      const res = await put({ fullName: 'Me Again', email: 'me@co.test' });
      expect(res.statusCode).toBe(200);
      expect(users.update).toHaveBeenCalledWith('u-me', { fullName: 'Me Again' });
    });

    it('picking a username during onboarding needs no password', async () => {
      users.findById.mockResolvedValue({ ...me, fullName: null });
      const res = await put({ fullName: 'New Person', username: 'newperson', role: 'project_manager' });
      expect(res.statusCode).toBe(200);
      expect(users.update).toHaveBeenCalledWith('u-me', { fullName: 'New Person', username: 'newperson', role: 'project_manager' });
    });
  });

  describe('through a key', () => {
    it('a read-only key is refused', async () => {
      who.user = { userId: 'u-me', role: 'project_manager' };
      who.keyScopes = ['read'];
      const res = await put({ email: 'attacker@evil.test', currentPassword: 'right-password' });
      expect(res.statusCode).toBe(403);
      expect(users.update).not.toHaveBeenCalled();
    });

    it('a key that may write can change the name', async () => {
      who.user = { userId: 'u-me', role: 'project_manager' };
      who.keyScopes = ['read', 'write'];
      const res = await put({ fullName: 'Via Claude' });
      expect(res.statusCode).toBe(200);
    });
  });

  it('a signed-in viewer still edits their own name', async () => {
    who.user = { userId: 'u-me', role: 'viewer' };
    const res = await put({ fullName: 'Viewer Name' });
    expect(res.statusCode).toBe(200);
    expect(users.update).toHaveBeenCalledWith('u-me', { fullName: 'Viewer Name' });
  });
});
