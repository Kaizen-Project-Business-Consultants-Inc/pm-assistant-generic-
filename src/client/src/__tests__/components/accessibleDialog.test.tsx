/**
 * The one shared dialog (components/ui/AccessibleModal) and the modals moved onto it
 * (audit 2 H3). A dialog: has role="dialog" + aria-modal and a name, takes focus when it
 * opens and keeps it inside, closes on Escape (not while busy), gives focus back to the
 * control that opened it, and makes the page behind inert.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import React, { useState } from 'react';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../services/api', () => ({
  // Every API call resolves to an empty answer — these tests are about the dialog shell
  apiService: new Proxy({}, { get: () => vi.fn(async () => ({})) }),
}));

import { AccessibleModal } from '../../components/ui/AccessibleModal';
import { FeedbackModal } from '../../components/feedback/FeedbackModal';
import { ProjectGroupManager } from '../../components/projects/ProjectGroupManager';
import { UpgradePrompt } from '../../components/layout/UpgradePrompt';
import { ResourceLevelingModal } from '../../pages/ProjectDetailPage/schedule-tab/ResourceLevelingModal';
import { ChangeRequestForm } from '../../components/approvals/ChangeRequestForm';
import { StatusReportModal } from '../../pages/ProjectDetailPage/StatusReportModal';

// happy-dom has no layout, so every element's offsetParent is null and useModal would think
// nothing is visible. Pretend everything attached is laid out.
const offsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() { return (this as HTMLElement).parentElement; },
  });
});
afterAll(() => {
  if (offsetParent) Object.defineProperty(HTMLElement.prototype, 'offsetParent', offsetParent);
});
afterEach(() => { cleanup(); document.body.innerHTML = ''; });

function Harness({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <main id="main-content"><button type="button" onClick={() => setOpen(true)}>Open it</button></main>
      <nav data-modal-background=""><a href="#x">Sidebar link</a></nav>
      <AccessibleModal isOpen={open} onClose={() => setOpen(false)} labelledBy="t" describedBy="d" busy={busy}>
        <h2 id="t">Rename client</h2>
        <p id="d">Pick a new name.</p>
        <input aria-label="Name" />
        <button type="button" onClick={() => setOpen(false)}>Save</button>
      </AccessibleModal>
    </>
  );
}

async function openHarness(busy = false) {
  vi.useFakeTimers();
  render(<Harness busy={busy} />);
  const opener = screen.getByText('Open it');
  opener.focus();
  fireEvent.click(opener);
  act(() => { vi.advanceTimersByTime(60); }); // useModal moves focus in on the next tick
  vi.useRealTimers();
  return opener;
}

describe('AccessibleModal', () => {
  it('is a modal dialog named and described by its heading and text', async () => {
    await openHarness();
    const dialog = screen.getByRole('dialog', { name: 'Rename client' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-describedby')).toBe('d');
  });

  it('moves focus in on open and traps Tab / Shift+Tab inside', async () => {
    await openHarness();
    const dialog = screen.getByRole('dialog');
    const name = screen.getByLabelText('Name');
    const save = screen.getByText('Save');
    expect(document.activeElement).toBe(name);
    save.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(name);
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(save);
  });

  it('makes the page behind inert and hidden, and wakes it on close', async () => {
    await openHarness();
    const main = document.getElementById('main-content')!;
    const nav = document.querySelector('nav')!;
    expect(main.hasAttribute('inert')).toBe(true);
    expect(main.getAttribute('aria-hidden')).toBe('true');
    expect(nav.hasAttribute('inert')).toBe(true);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(main.hasAttribute('inert')).toBe(false);
    expect(nav.hasAttribute('inert')).toBe(false);
  });

  it('Escape closes it and focus goes back to the opener', async () => {
    const opener = await openHarness();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('while busy (saving), Escape and the backdrop do not close it', async () => {
    await openHarness(true);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-busy')).toBe('true');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(dialog.previousElementSibling!); // the backdrop
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('closing a dialog leaves something that was already inert (the closed phone menu) inert', () => {
    function WithDrawer({ open }: { open: boolean }) {
      return (
        <>
          <main id="main-content" />
          {/* @ts-expect-error -- React 18 has no typed inert prop */}
          <aside data-modal-background="" inert="">menu</aside>
          <AccessibleModal isOpen={open} onClose={() => {}} ariaLabel="Any"><p>x</p></AccessibleModal>
        </>
      );
    }
    const { rerender } = render(<WithDrawer open />);
    const aside = document.querySelector('aside')!;
    expect(aside.hasAttribute('inert')).toBe(true);
    rerender(<WithDrawer open={false} />);
    expect(aside.hasAttribute('inert')).toBe(true);
    expect(aside.hasAttribute('aria-hidden')).toBe(false);
  });

  it('preventClose blocks Escape without announcing the dialog as busy', () => {
    const onClose = vi.fn();
    render(<AccessibleModal isOpen onClose={onClose} ariaLabel="Editing" preventClose><p>x</p></AccessibleModal>);
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog.hasAttribute('aria-busy')).toBe(false);
  });

  it('a dialog opened from a dialog does not wake the page when it closes', () => {
    function Nested() {
      const [inner, setInner] = useState(true);
      return (
        <>
          <main id="main-content" />
          <AccessibleModal isOpen onClose={() => {}} ariaLabel="Outer"><p>outer</p></AccessibleModal>
          <AccessibleModal isOpen={inner} onClose={() => setInner(false)} ariaLabel="Inner"><p>inner</p></AccessibleModal>
        </>
      );
    }
    render(<Nested />);
    const main = document.getElementById('main-content')!;
    expect(main.hasAttribute('inert')).toBe(true);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Inner' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Inner' })).toBeNull();
    expect(main.hasAttribute('inert')).toBe(true); // the outer one is still open
  });
});

describe('modals moved onto the shared dialog open as named dialogs', () => {
  function wrap(ui: React.ReactElement) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
  }

  it.each([
    ['Feedback', () => <FeedbackModal onClose={() => {}} />, 'Share Your Feedback'],
    ['Manage clients', () => <ProjectGroupManager isOpen onClose={() => {}} />, 'Manage clients'],
    ['Resource levelling', () => <ResourceLevelingModal result={[]} onClose={() => {}} onApply={() => {}} />, 'Resource Leveling'],
    ['Change request', () => <ChangeRequestForm projectId="p1" onClose={() => {}} onSaved={() => {}} />, 'New Change Request'],
    ['Status report', () => <StatusReportModal projectId="p1" projectName="Apollo" onClose={() => {}} />, 'Status Report — Apollo'],
  ] as [string, () => React.ReactElement, string][])('%s', (_label, ui, name) => {
    wrap(ui());
    const dialog = screen.getByRole('dialog', { name });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('Upgrade prompt opens as a dialog when an action is blocked, and Escape closes it', async () => {
    wrap(<UpgradePrompt />);
    act(() => { window.dispatchEvent(new CustomEvent('subscription-required', { detail: {} })); });
    const dialog = await screen.findByRole('dialog', { name: 'Subscription Required' });
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

// Guard: a full-screen overlay (`fixed inset-0`) is either the shared dialog, has a dialog role
// right there, or is one of the known non-dialog layers below. A new hand-rolled modal fails here.
describe('no hand-rolled modal without a dialog role', () => {
  const SRC = path.resolve(__dirname, '../..');
  const NOT_DIALOGS = new Set([
    'components/layout/Sidebar.tsx',              // phone-width menu backdrop
    'components/risks/RAIDDetailPanel.tsx',       // backdrop of a side panel that has role="dialog"
    'components/schedule/AutoReschedulePanel.tsx', // backdrop of a slide-in side panel (listed in the audit sweep)
    'components/layout/CommandPalette.tsx',       // outer layer; its panel below has role="dialog"
    'components/ui/AccessibleModal.tsx',          // the shared dialog itself
    'pages/LessonsLearnedPage.tsx',               // click-catcher behind the Actions menu
    'pages/PrelaunchLandingPage.tsx',             // decorative background glow
  ]);
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = path.join(dir, f);
      if (statSync(p).isDirectory()) return f === '__tests__' ? [] : files(p);
      return p.endsWith('.tsx') ? [p] : [];
    });
  }
  it('every fixed inset-0 overlay is a dialog', () => {
    const offenders: string[] = [];
    for (const file of files(SRC)) {
      const rel = path.relative(SRC, file).replace(/\\/g, '/');
      if (NOT_DIALOGS.has(rel)) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!/\bfixed inset-0\b/.test(line)) return;
        const near = lines.slice(i, i + 8).join('\n');
        if (!/role="(dialog|alertdialog)"|aria-modal/.test(near)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
