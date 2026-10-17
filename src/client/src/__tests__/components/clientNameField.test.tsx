import { describe, it, expect, afterEach } from 'vitest';
import { useState } from 'react';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { ClientNameField, resolveClientChoice, type ClientOption } from '../../components/project/ClientNameField';

/** "Who is it for?" on the first-project step (user, 2026-10-17: mock OK'd, optional for SME too). */
const CLIENTS: ClientOption[] = [{ id: 'c1', name: 'Acme Bank' }, { id: 'c2', name: 'Acme Insurance' }];

function Harness({ clients }: { clients: ClientOption[] }) {
  const [v, setV] = useState('');
  return <><ClientNameField clients={clients} value={v} onChange={setV} label="Client" /><output data-testid="v">{v}</output></>;
}

describe('resolveClientChoice', () => {
  it('blank is no client, a known name (any case) is that client, anything else is a new client', () => {
    expect(resolveClientChoice('  ', CLIENTS)).toEqual({ kind: 'none' });
    expect(resolveClientChoice('acme bank ', CLIENTS)).toEqual({ kind: 'existing', id: 'c1' });
    expect(resolveClientChoice('Globex', CLIENTS)).toEqual({ kind: 'new', name: 'Globex' });
  });
});

describe('ClientNameField', () => {
  afterEach(cleanup);

  it('first sign-in: no clients yet, typing a name offers to create it', () => {
    render(<Harness clients={[]} />);
    const box = screen.getByRole('combobox', { name: /Client/ });
    fireEvent.focus(box);
    expect(screen.getByText(/You have no clients yet/)).toBeTruthy();
    fireEvent.change(box, { target: { value: 'Acme Bank' } });
    expect(screen.getByRole('option', { name: '+ Create client "Acme Bank"' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'No client (internal project)' })).toBeTruthy();
  });

  it('existing clients: typing narrows the list and the keyboard picks one', () => {
    render(<Harness clients={CLIENTS} />);
    const box = screen.getByRole('combobox', { name: /Client/ });
    fireEvent.change(box, { target: { value: 'insur' } });
    expect(screen.queryByRole('option', { name: 'Acme Bank' })).toBeNull();
    fireEvent.keyDown(box, { key: 'Enter' }); // nothing highlighted yet: Enter keeps the typed text
    expect(screen.getByTestId('v').textContent).toBe('insur');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByTestId('v').textContent).toBe('Acme Insurance');
    expect(box.getAttribute('aria-expanded')).toBe('false');
  });

  it('an exact name beyond the first 8 matches is not offered as new', () => {
    const many = [...Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, name: `Acme Co ${i}` })), { id: 'x', name: 'Acme' }];
    render(<Harness clients={many} />);
    fireEvent.change(screen.getByRole('combobox', { name: /Client/ }), { target: { value: 'Acme' } });
    expect(screen.queryByRole('option', { name: /Create client/ })).toBeNull();
  });

  it('"No client" clears the box', () => {
    render(<Harness clients={CLIENTS} />);
    const box = screen.getByRole('combobox', { name: /Client/ });
    fireEvent.change(box, { target: { value: 'Globex' } });
    fireEvent.mouseDown(screen.getByRole('option', { name: 'No client (internal project)' }));
    expect(screen.getByTestId('v').textContent).toBe('');
  });
});
