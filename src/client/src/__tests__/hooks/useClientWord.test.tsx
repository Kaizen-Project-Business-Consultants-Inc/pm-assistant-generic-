import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { clientWordFor } from '../../hooks/useClientWord';
import { ClientNameField } from '../../components/project/ClientNameField';
import { buildBreadcrumbs } from '../../components/layout/TopBar';

/** U50 (user 2026-10-20): "Department" on the Team and Enterprise plans, "Client" on Consultant plans and the trial */
afterEach(cleanup);

describe('the word for a client', () => {
  it('Team and Enterprise say Department; Consultant plans and the trial say Client', () => {
    expect(clientWordFor('sme')).toMatchObject({ one: 'Department', many: 'Departments', lower: 'department' });
    expect(clientWordFor('enterprise').many).toBe('Departments');
    for (const tier of ['consultant_basic', 'consultant_pro', 'trial', null, undefined]) expect(clientWordFor(tier).one).toBe('Client');
  });

  it('the type-or-create box offers "+ Create department" and "No department"', () => {
    render(<ClientNameField clients={[{ id: 'c1', name: 'Finance' }]} value="HR" onChange={() => {}} label="Department" lower="department" />);
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getByText('+ Create department "HR"')).toBeTruthy();
    expect(screen.getByText('No department')).toBeTruthy();
  });

  it('the breadcrumb says Departments above a department page', () => {
    const crumbs = buildBreadcrumbs('/clients/c1/report', { client: 'Finance', word: clientWordFor('sme') });
    expect(crumbs.map(c => c.label)).toEqual(expect.arrayContaining(['Departments', 'Finance']));
  });
});
