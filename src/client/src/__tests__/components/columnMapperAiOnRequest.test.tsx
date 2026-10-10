/**
 * Import column mapping (audit 2026-10-10 M1): the rules map what they can when the step opens;
 * the AI is asked about the leftover columns only when the person presses "Suggest … with AI".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ suggestColumns: vi.fn() }));
vi.mock('../../services/api', () => ({ apiService: api }));

import { ColumnMapper, mergeAiSuggestions } from '../../components/schedule/ColumnMapper';

function Harness({ headers }: { headers: string[] }) {
  const [mappings, setMappings] = useState<Record<number, string>>({});
  return (
    <>
      <ColumnMapper headers={headers} mappings={mappings} onMappingsChange={setMappings} />
      <output data-testid="map">{JSON.stringify(mappings)}</output>
    </>
  );
}

beforeEach(() => { api.suggestColumns.mockReset(); });
afterEach(() => { cleanup(); });

describe('ColumnMapper asks the AI only on request', () => {
  it('opening the mapping step makes no AI call, and shows the button for unmapped columns', async () => {
    const utils = render(<Harness headers={['Task Name', 'Zorblat']} />);
    await waitFor(() => expect(utils.getByText(/Suggest the unmapped column with AI/)).toBeTruthy());
    expect(api.suggestColumns).not.toHaveBeenCalled();
  });

  it('the button asks once and applies the suggestion', async () => {
    api.suggestColumns.mockResolvedValue({ Zorblat: 'assignedTo' });
    const utils = render(<Harness headers={['Task Name', 'Zorblat']} />);
    fireEvent.click(await utils.findByText(/Suggest the unmapped column with AI/));
    await waitFor(() => expect(utils.getByTestId('map').textContent).toContain('assignedTo'));
    expect(api.suggestColumns).toHaveBeenCalledTimes(1);
    expect(api.suggestColumns.mock.calls[0][1]).toEqual(['Zorblat']);
    expect(utils.queryByText(/with AI/)).toBeNull(); // asked once; the button goes away
  });

  it('no button when the rules mapped every column', async () => {
    const utils = render(<Harness headers={['Task Name']} />);
    await waitFor(() => expect(utils.getByTestId('map').textContent).toContain('name'));
    expect(utils.queryByText(/with AI/)).toBeNull();
    expect(api.suggestColumns).not.toHaveBeenCalled();
  });

  it('a failed call says so (alert) and the button comes back to try again', async () => {
    api.suggestColumns.mockRejectedValueOnce(new Error('AI down')).mockResolvedValueOnce({ Zorblat: 'assignedTo' });
    const utils = render(<Harness headers={['Task Name', 'Zorblat']} />);
    fireEvent.click(await utils.findByText(/Suggest the unmapped column with AI/));
    expect((await utils.findByRole('alert')).textContent).toMatch(/couldn.t suggest/);
    fireEvent.click(await utils.findByText(/Suggest the unmapped column with AI/));
    await waitFor(() => expect(utils.getByTestId('map').textContent).toContain('assignedTo'));
    expect(utils.queryByRole('alert')).toBeNull();
  });
});

// review 2026-10-10: the AI's answer is merged into the mappings as they are when it arrives
describe('mergeAiSuggestions', () => {
  const headers = ['Task Name', 'Who', 'Notes?'];
  const rules = { 0: 'name' };
  const targets = ['name', 'assignedTo', 'description'];

  it("keeps a column the person set while waiting, and doesn't reuse its target", () => {
    const current = { 0: 'name', 1: 'description' }; // set by hand after pressing the button
    const { map, fromAI } = mergeAiSuggestions(headers, current, rules, { Who: 'assignedTo', 'Notes?': 'description' }, targets);
    expect(map[1]).toBe('description');
    expect(map[2]).toBeUndefined(); // 'description' is taken
    expect([...fromAI]).toEqual([]);
  });

  it('fills only columns the rules left and nobody has set', () => {
    const { map, fromAI } = mergeAiSuggestions(headers, { 0: 'name' }, rules, { 'Task Name': 'description', Who: 'assignedTo' }, targets);
    expect(map).toMatchObject({ 0: 'name', 1: 'assignedTo' });
    expect([...fromAI]).toEqual([1]);
  });
});
