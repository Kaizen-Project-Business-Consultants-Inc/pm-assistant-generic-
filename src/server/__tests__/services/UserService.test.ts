import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../database/connection', () => {
  const queryFn = vi.fn().mockResolvedValue([]);
  return {
    databaseService: { query: queryFn, queryControlPlane: queryFn },
  };
});

vi.mock('uuid', () => ({ v4: () => 'test-user-id' }));

import { UserService } from '../../services/UserService';
import { databaseService } from '../../database/connection';

const mockQuery = databaseService.query as ReturnType<typeof vi.fn>;

const sampleRow = {
  id: 'u1', username: 'johndoe', email: 'john@example.com',
  password_hash: '$2b$10$hashedpassword', full_name: 'John Doe',
  role: 'team_member', is_active: 1, email_verified: 1,
  email_verification_token: null, email_verification_expires: null,
  password_reset_token: null, password_reset_expires: null,
  stripe_customer_id: null, subscription_tier: 'trial',
  subscription_status: 'none', trial_ends_at: null,
  email_notifications_enabled: 1, digest_frequency: 'daily',
  digest_last_sent_at: null, last_login_at: null,
  timezone: 'America/Toronto', locale: 'en',
  created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-01'),
};

describe('UserService', () => {
  let service: UserService;

  beforeEach(() => {
    service = new UserService();
    vi.clearAllMocks();
  });

  describe('findById', () => {
    it('returns user when found', async () => {
      mockQuery.mockResolvedValueOnce([sampleRow]);
      const user = await service.findById('u1');
      expect(user).not.toBeNull();
      expect(user!.id).toBe('u1');
      expect(user!.username).toBe('johndoe');
      expect(user!.isActive).toBe(true);
      expect(user!.emailVerified).toBe(true);
      expect(user!.emailNotificationsEnabled).toBe(true);
    });

    it('returns null when not found', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const user = await service.findById('nonexistent');
      expect(user).toBeNull();
    });
  });

  describe('findByUsername', () => {
    it('returns user by username', async () => {
      mockQuery.mockResolvedValueOnce([sampleRow]);
      const user = await service.findByUsername('johndoe');
      expect(user!.username).toBe('johndoe');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE username = ?'),
        ['johndoe'],
      );
    });
  });

  describe('findByEmail', () => {
    it('returns user by email', async () => {
      mockQuery.mockResolvedValueOnce([sampleRow]);
      const user = await service.findByEmail('john@example.com');
      expect(user!.email).toBe('john@example.com');
    });
  });

  describe('findByVerificationToken', () => {
    it('returns user with valid token', async () => {
      mockQuery.mockResolvedValueOnce([sampleRow]);
      const user = await service.findByVerificationToken('valid-token');
      expect(user).not.toBeNull();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('email_verification_token = ?'),
        ['valid-token'],
      );
    });
  });

  describe('findByResetToken', () => {
    it('returns user with valid reset token', async () => {
      mockQuery.mockResolvedValueOnce([sampleRow]);
      const user = await service.findByResetToken('reset-token');
      expect(user).not.toBeNull();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('password_reset_token = ?'),
        ['reset-token'],
      );
    });
  });

  describe('create', () => {
    it('creates user and returns it', async () => {
      mockQuery
        .mockResolvedValueOnce([]) // INSERT
        .mockResolvedValueOnce([{ ...sampleRow, id: 'test-user-id' }]); // findById

      const user = await service.create({
        username: 'johndoe',
        email: 'john@example.com',
        passwordHash: '$2b$10$hashedpassword',
        fullName: 'John Doe',
      });

      expect(user.username).toBe('johndoe');
      expect(user.role).toBe('team_member'); // default
    });

    it('uses custom role when provided', async () => {
      mockQuery
        .mockResolvedValueOnce([]) // INSERT
        .mockResolvedValueOnce([{ ...sampleRow, id: 'test-user-id', role: 'pmo' }]);

      await service.create({
        username: 'pmo1',
        email: 'pmo@example.com',
        passwordHash: 'hash',
        fullName: 'PMO User',
        role: 'pmo',
      });

      const insertCall = mockQuery.mock.calls[0];
      expect(insertCall[1]).toContain('pmo');
    });

    // 2026-10-04: 'admin' is the Kovarti platform admin only — nothing in the app may make one
    it('refuses to create an admin', async () => {
      await expect(service.create({
        username: 'x', email: 'x@example.com', passwordHash: 'h', fullName: 'X', role: 'admin',
      } as any)).rejects.toThrow(/reserved for the Kovarti platform/);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('refuses to make an existing user admin', async () => {
      await expect(service.update('u1', { role: 'admin' } as any)).rejects.toThrow(/reserved for the Kovarti platform/);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates specified fields', async () => {
      mockQuery
        .mockResolvedValueOnce([]) // UPDATE
        .mockResolvedValueOnce([{ ...sampleRow, full_name: 'Jane Doe' }]); // findById

      const updated = await service.update('u1', { fullName: 'Jane Doe' });
      expect(updated!.fullName).toBe('Jane Doe');
    });

    it('returns existing when no fields provided', async () => {
      mockQuery.mockResolvedValueOnce([sampleRow]); // findById (no update needed)
      const updated = await service.update('u1', {});
      expect(updated!.username).toBe('johndoe');
    });

    it('handles password hash update', async () => {
      mockQuery
        .mockResolvedValueOnce([]) // UPDATE
        .mockResolvedValueOnce([sampleRow]); // findById

      await service.update('u1', { passwordHash: 'new-hash' });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('password_hash = ?'),
        expect.arrayContaining(['new-hash', 'u1']),
      );
    });
  });

  describe('delete', () => {
    it('returns true when deleted', async () => {
      mockQuery.mockResolvedValueOnce({ affectedRows: 1 });
      const deleted = await service.delete('u1');
      expect(deleted).toBe(true);
    });

    it('returns false when not found', async () => {
      mockQuery.mockResolvedValueOnce({ affectedRows: 0 });
      const deleted = await service.delete('nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('list', () => {
    it('returns all users', async () => {
      mockQuery.mockResolvedValueOnce([sampleRow]);
      const users = await service.list();
      expect(users).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT ?'),
        [1000],
      );
    });
  });
});
