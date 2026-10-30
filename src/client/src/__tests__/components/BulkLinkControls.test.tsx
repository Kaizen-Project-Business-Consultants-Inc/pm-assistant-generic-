import { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { BulkLinkControls } from '../../components/schedule/BulkLinkControls';

afterEach(cleanup);

describe('Link tasks bar while linking', () => {
  it('says "Linking…", disables the buttons, announces it in one status line, then shows the result', async () => {
    let finish: (text: string) => void = () => {};
    const onBulkLink = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    render(<BulkLinkControls selectedIds={['a', 'b']} onBulkLink={onBulkLink} />);
    const status = screen.getByRole('status'); // on the page from the start, so changes to it are announced
    expect(status.textContent).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Link in order' }));

    expect(await screen.findByText('Linking…')).toBeTruthy();
    expect(screen.getByRole('status')).toBe(status);
    expect(status.textContent).toContain('Linking…');
    expect((screen.getByRole('button', { name: 'Link in order' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'All wait on it' }) as HTMLButtonElement).disabled).toBe(true);

    finish('Linked 2 tasks in order · 3 tasks moved later');
    expect(await screen.findByText('Linked 2 tasks in order · 3 tasks moved later')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Linking…')).toBeNull());
    expect(screen.getByRole('status')).toBe(status);
    const again = screen.getByRole('button', { name: 'Link in order' }) as HTMLButtonElement;
    expect(again.disabled).toBe(false);
    expect(document.activeElement).toBe(again); // keyboard focus comes back to the button that was used
  });

  it('drops the working state and shows the reason when linking fails', async () => {
    const onBulkLink = vi.fn(() => Promise.reject(new Error('These links would create a loop')));
    render(<BulkLinkControls selectedIds={['a', 'b']} onBulkLink={onBulkLink} />);
    fireEvent.click(screen.getByRole('button', { name: 'Link in order' }));
    expect(await screen.findByText('These links would create a loop')).toBeTruthy();
    expect(screen.queryByText('Linking…')).toBeNull();
  });
});

describe('keyboard focus after linking', () => {
  it('goes to the grid when the bar goes away with the selection', async () => {
    function Page() {
      const [selected, setSelected] = useState(['a', 'b']);
      return (
        <div>
          <div role="treegrid" tabIndex={0} aria-label="Tasks" />
          {selected.length > 0 && <BulkLinkControls selectedIds={selected} onBulkLink={async () => 'Linked 2 tasks'} onLinked={() => setSelected([])} />}
        </div>
      );
    }
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: 'Link in order' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Link selected tasks' })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('treegrid'));
  });

  it('goes to the Row # box when the bar stays but the button used is off until a row is typed', async () => {
    render(<BulkLinkControls selectedIds={['a', 'b']} onBulkLink={async () => 'Linked'} />);
    const box = screen.getByLabelText(/Row to link to/);
    fireEvent.change(box, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'All wait on it' }));
    await screen.findByText('Linked');
    expect((screen.getByRole('button', { name: 'All wait on it' }) as HTMLButtonElement).disabled).toBe(true); // the box was cleared
    expect(document.activeElement).toBe(box);
  });
});
