import { v4 as uuidv4 } from 'uuid';
import { databaseService } from './connection';

/** Google (and later other) sign-in accounts linked to a Kovarti user — control plane (migration 136) */
export const userIdentityRepository = {
  /** The Kovarti user this provider account belongs to, if linked */
  async findUserId(provider: string, subject: string): Promise<string | null> {
    const rows = await databaseService.queryControlPlane<{ user_id: string }>(
      'SELECT user_id FROM user_identities WHERE provider = ? AND subject = ? LIMIT 1',
      [provider, subject],
    );
    return rows[0]?.user_id ?? null;
  },

  /** Link (once: the same provider account can't belong to two users — unique key) */
  async link(userId: string, provider: string, subject: string, email: string): Promise<void> {
    await databaseService.queryControlPlane(
      'INSERT INTO user_identities (id, user_id, provider, subject, email_at_link, last_used_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [uuidv4(), userId, provider, subject, email],
    );
  },

  async touch(provider: string, subject: string): Promise<void> {
    await databaseService.queryControlPlane(
      'UPDATE user_identities SET last_used_at = NOW() WHERE provider = ? AND subject = ?',
      [provider, subject],
    );
  },
};
