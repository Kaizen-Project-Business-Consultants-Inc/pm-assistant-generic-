import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkForUpdate, isUpdateAvailable, onUpdateAvailable, _setBuildsForTests } from '../../utils/appUpdate';

const serving = (build: string | null, ok = true) =>
  vi.fn().mockResolvedValue({ ok, json: async () => (build ? { build } : {}) }) as unknown as typeof fetch;

describe('app update check', () => {
  beforeEach(() => _setBuildsForTests('build-A', null));

  it('reports nothing new while the server serves the same build', async () => {
    expect(await checkForUpdate(serving('build-A'))).toBe(false);
    expect(isUpdateAvailable()).toBe(false);
  });

  it('spots a newer build, tells listeners once, and asks without caching', async () => {
    const heard: boolean[] = [];
    const off = onUpdateAvailable(v => heard.push(v));
    const f = serving('build-B');
    expect(await checkForUpdate(f)).toBe(true);
    expect(await checkForUpdate(f)).toBe(true);
    expect(heard).toEqual([true]);
    const [url, init] = (f as any).mock.calls[0];
    expect(url).toMatch(/^\/version\.json\?t=\d+$/);
    expect(init).toEqual({ cache: 'no-store' });
    off();
  });

  it('ignores errors, missing ids and failed requests', async () => {
    expect(await checkForUpdate(vi.fn().mockRejectedValue(new Error('offline')) as any)).toBe(false);
    expect(await checkForUpdate(serving(null))).toBe(false);
    expect(await checkForUpdate(serving('build-B', false))).toBe(false);
    expect(isUpdateAvailable()).toBe(false);
  });

  it('never reports an update in development builds', async () => {
    _setBuildsForTests('dev', null);
    expect(await checkForUpdate(serving('build-B'))).toBe(false);
  });
});
