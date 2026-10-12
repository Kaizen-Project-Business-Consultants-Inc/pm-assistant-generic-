import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { loadSignedInUser } from '../../utils/loadSignedInUser';

/**
 * A busy server must never sign anyone out (2026-10-12): only a refusal (401/403) means signed
 * out; "busy" (503) or no connection is tried again, and then the remembered person is kept.
 */
const fail = (status?: number) => Object.assign(new Error('x'), status ? { response: { status } } : {});

describe('loadSignedInUser — who is signed in when the app opens', () => {
  it('the server knows them: the user', async () => {
    expect(await loadSignedInUser(async () => ({ user: { id: 'u1' } }), { waitMs: 0 })).toEqual({ id: 'u1' });
  });

  it.each([401, 403])('a refusal (%i) with nothing to refresh means signed out, without trying again', async (status) => {
    const getMe = vi.fn(async () => { throw fail(status); });
    expect(await loadSignedInUser(getMe, { waitMs: 0 })).toBeNull();
    expect(getMe).toHaveBeenCalledTimes(1);
  });

  it('reopened after the 15-minute cookie ran out: refreshes once and keeps them signed in', async () => {
    const getMe = vi.fn().mockRejectedValueOnce(fail(401)).mockResolvedValueOnce({ user: { id: 'u1' } });
    const refresh = vi.fn(async () => ({}));
    expect(await loadSignedInUser(getMe, { refresh, waitMs: 0 })).toEqual({ id: 'u1' });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('the refresh is refused too: signed out (and only one refresh is tried)', async () => {
    const getMe = vi.fn(async () => { throw fail(401); });
    const refresh = vi.fn(async () => { throw fail(401); });
    expect(await loadSignedInUser(getMe, { refresh, waitMs: 0 })).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('the refresh keeps hitting a busy server: tries again, then keeps who we had', async () => {
    const getMe = vi.fn(async () => { throw fail(401); });
    const refresh = vi.fn(async () => { throw fail(503); });
    expect(await loadSignedInUser(getMe, { refresh, waitMs: 0 })).toBeUndefined();
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('refreshed, but still refused: signed out', async () => {
    const getMe = vi.fn(async () => { throw fail(401); });
    const refresh = vi.fn(async () => ({}));
    expect(await loadSignedInUser(getMe, { refresh, waitMs: 0 })).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('busy (503) once, then fine: tries again and gets the user', async () => {
    const getMe = vi.fn().mockRejectedValueOnce(fail(503)).mockResolvedValueOnce({ user: { id: 'u1' } });
    expect(await loadSignedInUser(getMe, { waitMs: 0 })).toEqual({ id: 'u1' });
    expect(getMe).toHaveBeenCalledTimes(2);
  });

  it('still busy or offline after three tries: undefined (keep who we had — do not sign out)', async () => {
    const getMe = vi.fn(async () => { throw fail(); });
    expect(await loadSignedInUser(getMe, { waitMs: 0 })).toBeUndefined();
    expect(getMe).toHaveBeenCalledTimes(3);
  });
});

describe('the app never signs people out on "busy"', () => {
  const src = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

  // (the refresh rule itself is tested by behaviour in services/refreshBusy.test.ts)
  it('the dashboard asks for its risk totals in one request, not once per project', () => {
    const dash = src('pages/DashboardPM.tsx');
    expect(dash).toContain('getRiskOpenTotals');
    expect(dash).not.toMatch(/getRiskStats/);
  });
});
