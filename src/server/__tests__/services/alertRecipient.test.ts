import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A nightly alert goes to the project's PM (or creator) if that login still exists in the
 * company; otherwise to the company owner. A removed PM used to make the alert fail
 * ("a foreign key constraint fails", staging 2026-10-07).
 */
const db = vi.hoisted(() => ({ users: new Set<string>(), owner: 'owner1' as string | null }));
vi.mock('../../database/connection', () => ({
  databaseService: {
    queryControlPlane: async (sql: string, params: any[]) => {
      if (sql.includes('FROM users')) return params.filter((p: string) => db.users.has(p)).map((id: string) => ({ id }));
      if (sql.includes('FROM organizations')) return db.owner && db.users.has(db.owner) ? [{ id: db.owner }] : [];
      return [];
    },
  },
}));
vi.mock('../../middleware/requestContext', () => ({ getTenantContext: () => ({ dbName: 'pmassist_t_a', orgId: 'org1' }) }));

import { alertRecipient } from '../../services/scheduling/alertRecipient';

describe('who gets a nightly alert', () => {
  beforeEach(() => { db.users = new Set(); db.owner = 'owner1'; });

  it('the PM when their login exists', async () => {
    db.users = new Set(['pm1', 'creator1']);
    expect(await alertRecipient({ projectManagerId: 'pm1', createdBy: 'creator1' })).toBe('pm1');
  });

  it('the creator when there is no PM (or the PM is gone)', async () => {
    db.users = new Set(['creator1']);
    expect(await alertRecipient({ projectManagerId: 'gone', createdBy: 'creator1' })).toBe('creator1');
    expect(await alertRecipient({ projectManagerId: null, createdBy: 'creator1' })).toBe('creator1');
  });

  it('the company owner when neither login exists', async () => {
    db.users = new Set(['owner1']);
    expect(await alertRecipient({ projectManagerId: 'gone', createdBy: 'gone2' })).toBe('owner1');
  });

  it("nobody when the owner's login is gone too (an old company)", async () => {
    expect(await alertRecipient({ projectManagerId: 'gone', createdBy: 'owner1' })).toBeNull();
  });

  it('nobody when there is no owner either', async () => {
    db.owner = null;
    expect(await alertRecipient({ projectManagerId: 'gone', createdBy: null })).toBeNull();
  });
});
