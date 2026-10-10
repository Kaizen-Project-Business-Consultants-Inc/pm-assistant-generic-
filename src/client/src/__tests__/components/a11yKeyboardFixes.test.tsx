/**
 * Keyboard and screen-reader fixes from audit 2 (H6, H8, H9, H11) and the client report's
 * headings (H5):
 *  - the project status select only saves on a real choice, never on a bare arrow key;
 *  - the phone-width menu is out of the Tab order when closed, and Escape closes it;
 *  - the Ctrl+K palette has one active item (aria-activedescendant) and Enter runs that item;
 *  - a Risks & Issues item opens from the keyboard;
 *  - the client report preview has real headings.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

vi.mock('../../services/api', () => ({
  apiService: {
    getFavouriteProjects: vi.fn().mockResolvedValue({ projects: [] }),
    getAiBudget: vi.fn().mockResolvedValue({ percentUsed: 0 }),
    search: vi.fn().mockResolvedValue({ results: [] }),
    getRiskItems: vi.fn().mockResolvedValue({
      data: [{ id: 'r1', recordId: 'R-001', title: 'Vendor late', type: 'risk', status: 'open', severity: 'high', riskScore: 6, createdAt: '2026-10-01' }],
    }),
    getRiskStats: vi.fn().mockResolvedValue({ data: {} }),
    getProjectMembers: vi.fn().mockResolvedValue({ members: [] }),
  },
}));
vi.mock('../../hooks/useProjectRole', () => ({ useProjectRole: () => ({ canEdit: true, isManager: true, role: 'owner', isLoading: false }) }));
vi.mock('../../components/raids/review/useRaidReview', () => ({ useRaidReview: () => ({ data: null }) }));
vi.mock('../../components/risks/RAIDDetailPanel', () => ({
  RAIDDetailPanel: ({ raidId }: { raidId: string }) => <div data-testid="raid-detail">{raidId}</div>,
}));

import { ProjectStatusSelect } from '../../components/project/ProjectStatusSelect';
import Sidebar from '../../components/layout/Sidebar';
import CommandPalette from '../../components/layout/CommandPalette';
import { MOBILE_MENU_BUTTON_ID } from '../../components/layout/mobileMenuIds';
import { useAuthStore, type User } from '../../stores/authStore';
import { structureClientReport } from '../../utils/clientReportStructure';
import { RAIDTab } from '../../pages/ProjectDetailPage/RAIDTab';

// The test DOM has no scrollIntoView (browsers do); the palette scrolls its active item into view.
// Without this the file only passed when another file had stubbed it first.
Element.prototype.scrollIntoView ??= vi.fn();

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false });
});

function signInPm() {
  useAuthStore.setState({
    user: {
      id: 'u1', username: 'pm', email: 'pm@x', fullName: 'Pat Manager', role: 'project_manager', emailVerified: true,
      organization: { id: 'o1', name: 'Co', slug: 'co', isOwner: true },
    } as User,
    isAuthenticated: true,
    isLoading: false,
  });
}

describe('Project status select (H9)', () => {
  function setup(pending = false) {
    const onCommit = vi.fn();
    render(<ProjectStatusSelect value="active" colorClass="bg-green-100" pending={pending} onCommit={onCommit} />);
    return { onCommit, select: screen.getByRole('combobox', { name: 'Project status' }) as HTMLSelectElement };
  }

  it('an arrow key only browses — nothing is saved', () => {
    const { onCommit, select } = setup();
    fireEvent.keyDown(select, { key: 'ArrowDown' });
    fireEvent.change(select, { target: { value: 'on_hold' } });
    expect(onCommit).not.toHaveBeenCalled();
    expect(select.value).toBe('on_hold'); // shown, not saved
  });

  it('Enter saves the status being shown', () => {
    const { onCommit, select } = setup();
    fireEvent.keyDown(select, { key: 'ArrowDown' });
    fireEvent.change(select, { target: { value: 'on_hold' } });
    fireEvent.keyDown(select, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('on_hold');
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('tabbing on to the next control with a different status showing saves it once', () => {
    const { onCommit, select } = setup();
    const next = document.createElement('button');
    document.body.appendChild(next);
    fireEvent.keyDown(select, { key: 'ArrowDown' });
    fireEvent.change(select, { target: { value: 'completed' } });
    fireEvent.blur(select, { relatedTarget: next });
    expect(onCommit).toHaveBeenCalledWith('completed');
    fireEvent.blur(select, { relatedTarget: next });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('switching window (focus goes nowhere) puts the saved status back instead of saving', () => {
    const { onCommit, select } = setup();
    fireEvent.keyDown(select, { key: 'ArrowDown' });
    fireEvent.change(select, { target: { value: 'cancelled' } });
    fireEvent.blur(select);
    expect(onCommit).not.toHaveBeenCalled();
    expect(select.value).toBe('active');
  });

  it('Escape puts the saved status back', () => {
    const { onCommit, select } = setup();
    fireEvent.keyDown(select, { key: 'ArrowUp' });
    fireEvent.change(select, { target: { value: 'planning' } });
    fireEvent.keyDown(select, { key: 'Escape' });
    expect(select.value).toBe('active');
    fireEvent.blur(select);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('picking with the mouse saves at once', () => {
    const { onCommit, select } = setup();
    fireEvent.mouseDown(select);
    fireEvent.change(select, { target: { value: 'on_hold' } });
    expect(onCommit).toHaveBeenCalledWith('on_hold');
  });

  it('stays focusable while saving (aria-busy, not disabled) and has a visible focus ring', () => {
    const { select } = setup(true);
    expect(select.disabled).toBe(false);
    expect(select.getAttribute('aria-busy')).toBe('true');
    expect(select.className).toMatch(/focus-visible:ring-2/);
  });
});

describe('Phone-width menu (H11)', () => {
  const realWidth = window.innerWidth;
  afterEach(() => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: realWidth }); });

  function renderSidebar(mobileOpen: boolean, onMobileClose = vi.fn()) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
    signInPm();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const menuButton = document.createElement('button');
    menuButton.id = MOBILE_MENU_BUTTON_ID;
    document.body.appendChild(menuButton);
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <QueryClientProvider client={qc}>
          <Sidebar collapsed={false} onToggle={() => {}} mobileOpen={mobileOpen} onMobileClose={onMobileClose} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    return { onMobileClose, menuButton, aside: document.getElementById('app-sidebar')! };
  }

  it('when closed, the off-screen drawer is inert (out of the Tab order and hidden from screen readers)', () => {
    const { aside } = renderSidebar(false);
    expect(aside.hasAttribute('inert')).toBe(true);
  });

  it('when open, it is live and focus moves to its first link', () => {
    const { aside } = renderSidebar(true);
    expect(aside.hasAttribute('inert')).toBe(false);
    expect(aside.contains(document.activeElement)).toBe(true);
  });

  it('Escape closes it and puts focus back on the menu button', () => {
    const { onMobileClose, menuButton } = renderSidebar(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onMobileClose).toHaveBeenCalled();
    expect(document.activeElement).toBe(menuButton);
  });

  it('at desktop width the sidebar is never inert', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    signInPm();
    const qc = new QueryClient();
    render(
      <MemoryRouter><QueryClientProvider client={qc}><Sidebar collapsed={false} onToggle={() => {}} /></QueryClientProvider></MemoryRouter>,
    );
    expect(document.getElementById('app-sidebar')!.hasAttribute('inert')).toBe(false);
  });
});

describe('Ctrl+K command palette (H6)', () => {
  function Where() {
    return <div data-testid="where">{useLocation().pathname}</div>;
  }
  function renderPalette() {
    signInPm();
    vi.useFakeTimers();
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes><Route path="*" element={<><Where /><CommandPalette isOpen onClose={() => {}} /></>} /></Routes>
      </MemoryRouter>,
    );
    act(() => { vi.advanceTimersByTime(60); });
    vi.useRealTimers();
    return screen.getByRole('combobox', { name: 'Type a command or search' });
  }

  it('is a combobox whose active option is announced through aria-activedescendant', () => {
    const input = renderPalette();
    expect(document.activeElement).toBe(input);
    const listbox = screen.getByRole('listbox', { name: 'Commands' });
    expect(input.getAttribute('aria-controls')).toBe(listbox.id);
    const first = screen.getAllByRole('option')[0];
    expect(input.getAttribute('aria-activedescendant')).toBe(first.id);
    expect(first.getAttribute('aria-selected')).toBe('true');
  });

  it('arrow keys move the one active item, and Enter runs exactly that item', () => {
    const input = renderPalette();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const active = document.getElementById(input.getAttribute('aria-activedescendant')!)!;
    expect(active.getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByRole('option').filter(o => o.getAttribute('aria-selected') === 'true')).toEqual([active]);
    const label = active.querySelector('p')!.textContent;
    fireEvent.keyDown(input, { key: 'Enter' });
    const expected: Record<string, string> = { 'Log Time': '/timesheet', 'Ask AI': '/query', 'Build Report': '/report-builder' };
    expect(screen.getByTestId('where').textContent).toBe(expected[label!]);
  });

  it('options are not Tab stops, so Tab cannot move away from the active item', () => {
    renderPalette();
    for (const o of screen.getAllByRole('option')) expect(o.getAttribute('tabindex')).toBe('-1');
  });

  it('search results and "no results" are announced in a live region', async () => {
    const input = renderPalette();
    fireEvent.change(input, { target: { value: 'zzz' } });
    const live = document.querySelector('[role="dialog"] [aria-live="polite"]')!;
    await waitFor(() => expect(live.textContent).toBe('No results found for "zzz"'), { timeout: 2000 });
  });
});

describe('Risks & Issues register (H8)', () => {
  it('each item title is a real button that opens the item (Enter/Space work on a button)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter><RAIDTab projectId="p1" projectName="Apollo" /></MemoryRouter></QueryClientProvider>);
    const titles = await screen.findAllByRole('button', { name: 'Vendor late' });
    // desktop row and phone card
    expect(titles.length).toBeGreaterThanOrEqual(1);
    for (const t of titles) expect(t.tagName).toBe('BUTTON');
    expect(screen.queryByTestId('raid-detail')).toBeNull();
    titles[0].focus();
    expect(document.activeElement).toBe(titles[0]);
    fireEvent.click(titles[0]);
    expect((await screen.findByTestId('raid-detail')).textContent).toBe('r1');
  });
});

describe('Client report preview headings (H5)', () => {
  // The shape the server renders (utils/clientReportRenderer.ts): styled paragraphs, a layout table
  const SERVER_HTML = `
    <table style="width: 100%; border-collapse: collapse;"><tr>
      <td style="background: #283480; padding: 18px 20px;">
        <p style="color: #ffffff; margin: 0; font-size: 18px; font-weight: 700;">CLIENT STATUS REPORT</p>
        <p style="color: rgba(255,255,255,0.9); margin: 4px 0 0; font-size: 12px;">Acme · 2 projects</p>
      </td></tr></table>
    <p style="color: #283480; font-size: 14px; font-weight: 700; margin: 22px 0 8px;">1. SUMMARY ACROSS ALL PROJECTS</p>
    <p style="margin: 0; font-size: 13px;">All on track.</p>
    <p style="color: #283480; font-size: 14px; font-weight: 700; margin: 22px 0 8px;">3. SCHEDULE TIMELINES</p>
    <p style="margin: 10px 0 4px; font-size: 12px; font-weight: 600; color: #374151;">PRJ-1 Apollo</p>
    <div><svg></svg></div>
    <p style="color: #9ca3af; font-size: 10px; text-align: center;">Kovarti PM Assistant</p>`;

  it('gives the report a title heading, section headings and project sub-headings', () => {
    const host = document.createElement('div');
    host.innerHTML = structureClientReport(SERVER_HTML);
    expect(Array.from(host.querySelectorAll('h2')).map(h => h.textContent)).toEqual(['CLIENT STATUS REPORT']);
    expect(Array.from(host.querySelectorAll('h3')).map(h => h.textContent)).toEqual(['1. SUMMARY ACROSS ALL PROJECTS', '3. SCHEDULE TIMELINES']);
    expect(Array.from(host.querySelectorAll('h4')).map(h => h.textContent)).toEqual(['PRJ-1 Apollo']);
    expect(host.querySelector('table')!.getAttribute('role')).toBe('presentation');
    // looks the same: the inline styles stay
    expect(host.querySelector('h3')!.getAttribute('style')).toContain('color: #283480');
  });

  it('darkens the faint footer and leaves body text alone', () => {
    const host = document.createElement('div');
    host.innerHTML = structureClientReport(SERVER_HTML);
    const footer = Array.from(host.querySelectorAll('p')).find(p => p.textContent === 'Kovarti PM Assistant')!;
    expect(footer.getAttribute('style')).toContain('color: #6b7280');
    expect(Array.from(host.querySelectorAll('p')).some(p => p.textContent === 'All on track.')).toBe(true);
  });

  it('empty input stays empty', () => {
    expect(structureClientReport('')).toBe('');
  });
});

