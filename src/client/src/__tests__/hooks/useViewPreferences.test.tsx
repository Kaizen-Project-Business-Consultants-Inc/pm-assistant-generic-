import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useEffect } from 'react';

/**
 * Screen settings are saved only when one actually changes (2026-10-08). The layout re-mounts with
 * every page and re-reports the sidebar and AI panel state; that used to send a save each time.
 */
const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('../../services/api', () => ({ apiService: { getViewPreferences: api.get, updateViewPreferences: api.put } }));

type Hook = typeof import('../../hooks/useViewPreferences');
let hook: Hook;

/** What AppLayout does on every page: report the current sidebar / AI panel state */
function Layout({ sidebarCollapsed, aiPanelOpen, onServer = () => {} }: { sidebarCollapsed: boolean; aiPanelOpen: boolean; onServer?: (p: object) => void }) {
  const { syncPrefs } = hook.useViewPreferences(onServer);
  useEffect(() => { syncPrefs({ sidebarCollapsed }); }, [sidebarCollapsed, syncPrefs]);
  useEffect(() => { syncPrefs({ aiPanelOpen }); }, [aiPanelOpen, syncPrefs]);
  return null;
}

const saved = { sidebarCollapsed: false, aiPanelOpen: true, theme: 'dark' as const };

async function signIn(id: string) {
  const { useAuthStore } = await import('../../stores/authStore');
  useAuthStore.setState({ isAuthenticated: true, user: { id } as never });
}

async function openPage(props: { sidebarCollapsed: boolean; aiPanelOpen: boolean }) {
  const r = render(<Layout {...props} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  return r;
}

describe('useViewPreferences saves only real changes', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    localStorage.clear();
    api.get.mockReset().mockResolvedValue({ preferences: saved });
    api.put.mockReset().mockResolvedValue({});
    hook = await import('../../hooks/useViewPreferences');
    await signIn('u1');
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('opening pages with nothing changed sends no save', async () => {
    localStorage.setItem('view-preferences', JSON.stringify(saved));
    (await openPage({ sidebarCollapsed: false, aiPanelOpen: true })).unmount();
    (await openPage({ sidebarCollapsed: false, aiPanelOpen: true })).unmount();
    await openPage({ sidebarCollapsed: false, aiPanelOpen: true });
    expect(api.get).toHaveBeenCalledTimes(3);
    expect(api.put).not.toHaveBeenCalled();
  });

  it('a first visit on a new device takes the saved settings and sends nothing back', async () => {
    const onServer = vi.fn();
    render(<Layout sidebarCollapsed={false} aiPanelOpen={false} onServer={onServer} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(onServer).toHaveBeenCalledWith(saved);
    expect(api.put).not.toHaveBeenCalled();
  });

  it('a real change is saved once, sending only what changed (the server keeps the rest)', async () => {
    localStorage.setItem('view-preferences', JSON.stringify(saved));
    const page = await openPage({ sidebarCollapsed: false, aiPanelOpen: true });
    page.rerender(<Layout sidebarCollapsed aiPanelOpen />);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put).toHaveBeenCalledWith({ sidebarCollapsed: true });
    expect(JSON.parse(localStorage.getItem('view-preferences')!)).toEqual({ ...saved, sidebarCollapsed: true });
    // the next page with the same state sends nothing more
    page.unmount();
    await openPage({ sidebarCollapsed: true, aiPanelOpen: true });
    expect(api.put).toHaveBeenCalledTimes(1);
  });

  it('a change made just before moving to another page still reaches the server, and is not undone', async () => {
    localStorage.setItem('view-preferences', JSON.stringify(saved));
    const page = await openPage({ sidebarCollapsed: false, aiPanelOpen: true });
    page.rerender(<Layout sidebarCollapsed aiPanelOpen />);
    page.unmount(); // next page, within the 1 s wait
    const onServer = vi.fn();
    render(<Layout sidebarCollapsed aiPanelOpen onServer={onServer} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(onServer).not.toHaveBeenCalled(); // the older server copy does not overwrite the change
    expect(api.put).toHaveBeenCalledWith({ sidebarCollapsed: true });
  });

  it('a page read that started before a save finished does not undo the change', async () => {
    localStorage.setItem('view-preferences', JSON.stringify(saved));
    const page = await openPage({ sidebarCollapsed: false, aiPanelOpen: true });
    let finishPut!: () => void;
    api.put.mockImplementationOnce(() => new Promise<void>(r => { finishPut = r; }));
    page.rerender(<Layout sidebarCollapsed aiPanelOpen />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); }); // save sent, not answered
    page.unmount();
    const onServer = vi.fn();
    render(<Layout sidebarCollapsed aiPanelOpen onServer={onServer} />); // its read returns the old row
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(onServer).not.toHaveBeenCalled();
    await act(async () => { finishPut(); await vi.advanceTimersByTimeAsync(2000); });
    expect(JSON.parse(localStorage.getItem('view-preferences')!).sidebarCollapsed).toBe(true);
    expect(api.put).toHaveBeenCalledTimes(1);
  });

  it("a slow first read: this device's defaults are not saved over the user's settings", async () => {
    let answer!: (v: unknown) => void;
    api.get.mockImplementationOnce(() => new Promise(r => { answer = r; }));
    const onServer = vi.fn();
    render(<Layout sidebarCollapsed aiPanelOpen={false} onServer={onServer} />); // new device defaults
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); }); // read still not back
    expect(api.put).not.toHaveBeenCalled();
    await act(async () => { answer({ preferences: saved }); await vi.advanceTimersByTimeAsync(2000); });
    expect(onServer).toHaveBeenCalledWith(saved);
    expect(api.put).not.toHaveBeenCalled();
  });

  it('a read that started before a change, answered after the save finished, does not undo it', async () => {
    localStorage.setItem('view-preferences', JSON.stringify(saved));
    const page = await openPage({ sidebarCollapsed: false, aiPanelOpen: true });
    page.unmount();
    let answer!: (v: unknown) => void;
    api.get.mockImplementationOnce(() => new Promise(r => { answer = r; }));
    const onServer = vi.fn();
    const next = render(<Layout sidebarCollapsed={false} aiPanelOpen onServer={onServer} />); // read sent
    next.rerender(<Layout sidebarCollapsed aiPanelOpen onServer={onServer} />); // then a change
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); }); // saved
    expect(api.put).toHaveBeenCalledWith({ sidebarCollapsed: true });
    await act(async () => { answer({ preferences: saved }); await vi.advanceTimersByTimeAsync(100); }); // old row
    expect(onServer).not.toHaveBeenCalled();
    expect(hook.getViewPref('sidebarCollapsed')).toBe(true);
  });

  it('a save that failed is sent again when the next page opens', async () => {
    localStorage.setItem('view-preferences', JSON.stringify(saved));
    const page = await openPage({ sidebarCollapsed: false, aiPanelOpen: true });
    api.put.mockRejectedValueOnce(new Error('offline'));
    page.rerender(<Layout sidebarCollapsed aiPanelOpen />);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(api.put).toHaveBeenCalledTimes(1);
    page.unmount();
    const onServer = vi.fn();
    render(<Layout sidebarCollapsed aiPanelOpen onServer={onServer} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(onServer).not.toHaveBeenCalled(); // the old row doesn't flip the sidebar back
    expect(api.put).toHaveBeenCalledTimes(2);
    expect(api.put).toHaveBeenLastCalledWith({ sidebarCollapsed: true });
  });

  it('a read that started while a save was on its way, answered after it, does not undo it', async () => {
    localStorage.setItem('view-preferences', JSON.stringify(saved));
    const page = await openPage({ sidebarCollapsed: false, aiPanelOpen: true });
    let finishPut!: () => void;
    api.put.mockImplementationOnce(() => new Promise<void>(r => { finishPut = r; }));
    page.rerender(<Layout sidebarCollapsed aiPanelOpen />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); }); // save on its way
    page.unmount();
    let answer!: (v: unknown) => void;
    api.get.mockImplementationOnce(() => new Promise(r => { answer = r; }));
    const onServer = vi.fn();
    render(<Layout sidebarCollapsed aiPanelOpen onServer={onServer} />); // read sent now
    await act(async () => { finishPut(); await vi.advanceTimersByTimeAsync(10); }); // save done first
    await act(async () => { answer({ preferences: saved }); await vi.advanceTimersByTimeAsync(10); }); // old row last
    expect(onServer).not.toHaveBeenCalled();
    expect(hook.getViewPref('sidebarCollapsed')).toBe(true);
  });

  it('a failed first read: a change made meanwhile is kept and sent after the next read', async () => {
    api.get.mockRejectedValueOnce(new Error('offline'));
    const page = await openPage({ sidebarCollapsed: false, aiPanelOpen: true });
    page.rerender(<Layout sidebarCollapsed aiPanelOpen />); // real change, nothing read yet
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(api.put).not.toHaveBeenCalled();
    page.unmount();
    await openPage({ sidebarCollapsed: true, aiPanelOpen: true }); // next page, read works
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put).toHaveBeenCalledWith({ sidebarCollapsed: true });
    expect(hook.getViewPref('sidebarCollapsed')).toBe(true);
  });

  it('a second change waits for the first save to finish (never two saves at once)', async () => {
    localStorage.setItem('view-preferences', JSON.stringify(saved));
    const page = await openPage({ sidebarCollapsed: false, aiPanelOpen: true });
    let finishPut!: () => void;
    api.put.mockImplementationOnce(() => new Promise<void>(r => { finishPut = r; }));
    page.rerender(<Layout sidebarCollapsed aiPanelOpen />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); }); // first save on its way
    page.rerender(<Layout sidebarCollapsed aiPanelOpen={false} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(api.put).toHaveBeenCalledTimes(1);
    await act(async () => { finishPut(); await vi.advanceTimersByTimeAsync(2000); });
    expect(api.put).toHaveBeenCalledTimes(2);
    expect(api.put).toHaveBeenLastCalledWith({ aiPanelOpen: false });
  });

  it("another user signing in on the same tab never gets or sends the last user's settings", async () => {
    localStorage.setItem('view-preferences', JSON.stringify(saved));
    const page = await openPage({ sidebarCollapsed: false, aiPanelOpen: true });
    page.rerender(<Layout sidebarCollapsed aiPanelOpen />); // u1 changes something…
    await signIn('u2'); // …and u2 signs in before it is sent
    api.get.mockResolvedValue({ preferences: null }); // u2 has nothing saved
    page.unmount();
    await openPage({ sidebarCollapsed: false, aiPanelOpen: false });
    expect(api.put).not.toHaveBeenCalled();
    expect(hook.getViewPref('theme')).toBeUndefined();
  });

  it('nothing is sent after signing out', async () => {
    localStorage.setItem('view-preferences', JSON.stringify(saved));
    const page = await openPage({ sidebarCollapsed: false, aiPanelOpen: true });
    page.rerender(<Layout sidebarCollapsed aiPanelOpen />);
    const { useAuthStore } = await import('../../stores/authStore');
    useAuthStore.setState({ isAuthenticated: false, user: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(api.put).not.toHaveBeenCalled();
  });
});
