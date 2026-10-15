import { describe, it, expect, vi, beforeEach } from 'vitest';

/** U8: nobody from another client's pool can be put on a project's tasks */
const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../database/connection', () => ({ databaseService: db }));

import { assertInProjectPool, PoolMismatchError } from '../../services/poolFit';

describe('assertInProjectPool', () => {
  beforeEach(() => db.query.mockReset());

  it('asks nothing when no one is being assigned', async () => {
    await assertInProjectPool([null, undefined, ''], 's1');
    await assertInProjectPool(['r1'], null);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("passes when everyone is in the project's client pool or My resources", async () => {
    db.query.mockResolvedValue([]);
    await expect(assertInProjectPool(['r1', 'r1', 'r2'], 's1')).resolves.toBeUndefined();
    expect(db.query.mock.calls[0][1]).toEqual(['s1', 'r1', 'r2']);
  });

  it("refuses with a plain message naming who is in another client's pool (400)", async () => {
    db.query.mockResolvedValue([{ name: 'Ann Lee' }]);
    const err = await assertInProjectPool(['r9'], 's1').catch(e => e);
    expect(err).toBeInstanceOf(PoolMismatchError);
    expect(err.statusCode).toBe(400);
    expect(err.message).toMatch(/^Ann Lee is in another client's resource pool/);
  });
});
