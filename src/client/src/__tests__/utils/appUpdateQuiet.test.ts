import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  safeToReloadQuietly, shouldReloadInBackground, QUIET_AFTER_HIDDEN_MS,
  _setBuildsForTests, _setHiddenSinceForTests,
} from '../../utils/appUpdate';

/** New versions load with no banner, only when nothing being typed can be lost (2026-10-01). */
const setHidden = (hidden: boolean) =>
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });

describe('quiet app updates', () => {
  beforeEach(() => { document.body.innerHTML = ''; _setBuildsForTests('build-A', 'build-B'); });
  afterEach(() => { setHidden(false); _setHiddenSinceForTests(null); });

  it('an empty page is safe', () => {
    expect(safeToReloadQuietly()).toBe(true);
  });

  it('an open dialog, a focused field, unsent text or an unsaved marker is not', () => {
    document.body.innerHTML = '<div role="dialog"></div>';
    expect(safeToReloadQuietly()).toBe(false);

    document.body.innerHTML = '<input id="x" />';
    (document.getElementById('x') as HTMLInputElement).focus();
    expect(safeToReloadQuietly()).toBe(false);

    document.body.innerHTML = '<textarea>half a comment</textarea>';
    expect(safeToReloadQuietly()).toBe(false);

    document.body.innerHTML = '<div data-unsaved="true"></div>';
    expect(safeToReloadQuietly()).toBe(false);
  });

  it('a background tab reloads only after a few minutes out of sight', () => {
    const now = 10_000_000;
    setHidden(true);
    _setHiddenSinceForTests(now - QUIET_AFTER_HIDDEN_MS + 1000);
    expect(shouldReloadInBackground(now)).toBe(false);
    _setHiddenSinceForTests(now - QUIET_AFTER_HIDDEN_MS);
    expect(shouldReloadInBackground(now)).toBe(true);
  });

  it('never while the person is looking at the tab, or with no new version', () => {
    const now = 10_000_000;
    _setHiddenSinceForTests(now - 10 * QUIET_AFTER_HIDDEN_MS);
    setHidden(false);
    expect(shouldReloadInBackground(now)).toBe(false);
    setHidden(true);
    _setBuildsForTests('build-A', 'build-A');
    expect(shouldReloadInBackground(now)).toBe(false);
  });

  it('never in the background while a dialog is open', () => {
    const now = 10_000_000;
    setHidden(true);
    _setHiddenSinceForTests(now - 10 * QUIET_AFTER_HIDDEN_MS);
    document.body.innerHTML = '<div aria-modal="true"></div>';
    expect(shouldReloadInBackground(now)).toBe(false);
  });
});
