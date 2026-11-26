import { describe, it, expect } from 'vitest';
import { peopleRows, peopleToSave, changeMain } from '../../utils/taskPeople';
import { assigneeSummary } from '../../utils/resourceLookup';

const row = (resourceId: string, allocationPct = 100, roleOnTask = '') => ({ resourceId, allocationPct, roleOnTask });

describe('peopleRows: the main person and the list as one list', () => {
  it('puts the main person first, at 100% when not in the list yet', () => {
    expect(peopleRows('a', [row('b', 50)])).toEqual([row('a'), row('b', 50)]);
  });
  it('moves the main person to the front and keeps their own % and role', () => {
    expect(peopleRows('b', [row('a', 40), row('b', 60, 'Lead')])).toEqual([row('b', 60, 'Lead'), row('a', 40)]);
  });
  it('no main person: the list as it is', () => {
    expect(peopleRows('', [row('a', 50)])).toEqual([row('a', 50)]);
    expect(peopleRows('', [])).toEqual([]);
  });
});

describe('peopleToSave: what is stored', () => {
  it('first person is the main one; everyone is kept in the list', () => {
    expect(peopleToSave([row('a', 50), row('b', 50)], '')).toEqual({ assignedTo: 'a', assignments: [row('a', 50), row('b', 50)] });
  });
  it('one person at 100% with no role needs no list', () => {
    expect(peopleToSave([row('a')], '')).toEqual({ assignedTo: 'a', assignments: undefined });
    expect(peopleToSave([row('a', 100, 'Lead')], '').assignments).toHaveLength(1);
  });
  it('drops blanks and repeats; a blank first row hands "main" to the next person', () => {
    expect(peopleToSave([row(''), row('b', 50), row('b', 50)], '')).toEqual({ assignedTo: 'b', assignments: [row('b', 50)] });
  });
  it('nobody left: cleared, or the old name text kept when nobody matched it', () => {
    expect(peopleToSave([row('')], '')).toEqual({ assignedTo: '', assignments: undefined });
    expect(peopleToSave([], 'Old Name')).toEqual({ assignedTo: 'Old Name', assignments: undefined });
  });
});

describe('assigneeSummary: one Assigned To cell', () => {
  const names = new Map([['a', 'Ann'], ['b', 'Bo'], ['c', 'Cy']]);
  it('main person alone', () => {
    expect(assigneeSummary({ assignedTo: 'a' }, names)).toEqual({ text: 'Ann', title: '', names: ['Ann'] });
  });
  it('main plus others shows +N and the % in the hover text', () => {
    const r = assigneeSummary({ assignedTo: 'a', assignments: [{ resourceId: 'a', allocationPct: 50 }, { resourceId: 'b', allocationPct: 50 }, { resourceId: 'c', allocationPct: 20 }] }, names);
    expect(r.text).toBe('Ann +2');
    expect(r.title).toBe('Ann 50%, Bo 50%, Cy 20%');
    expect(r.names).toEqual(['Ann', 'Bo', 'Cy']);
  });
  it('no main person: the first person listed is shown', () => {
    expect(assigneeSummary({ assignedTo: '', assignments: [{ resourceId: 'b', allocationPct: 100 }, { resourceId: 'c', allocationPct: 100 }] }, names).text).toBe('Bo +1');
  });
  it('nobody: blank; an unknown id is "Unknown person", never an id', () => {
    expect(assigneeSummary({}, names).text).toBe('');
    expect(assigneeSummary({ assignedTo: '8f3c2a1e-5b7d-4c90-a1e2-3d4f5a6b7c8d' }, names).text).toBe('Unknown person');
  });
});

describe('taking people off a task that already had a list (the saved list must change too)', () => {
  it('back to one person at 100%: the list is rewritten, not left alone', () => {
    expect(peopleToSave([row('a')], '', true)).toEqual({ assignedTo: 'a', assignments: [row('a')] });
  });
  it('nobody left: an empty list is sent, so the server clears it', () => {
    expect(peopleToSave([row('')], '', true)).toEqual({ assignedTo: '', assignments: [] });
  });
  it('a task with no saved list and one plain person sends no list', () => {
    expect(peopleToSave([row('a')], '', false).assignments).toBeUndefined();
  });
});

describe('changeMain: the cell changes the main person and the list with it', () => {
  const list = [row('a', 50), row('b', 50, 'QA')];
  it('no list: only assignedTo', () => {
    expect(changeMain(undefined, 'c')).toEqual({ assignedTo: 'c' });
  });
  it('picking someone replaces the main row, keeping its %', () => {
    expect(changeMain(list, 'c')).toEqual({ assignedTo: 'c', assignments: [{ ...row('c', 50), hoursPlanned: undefined }, { ...row('b', 50, 'QA'), hoursPlanned: undefined }] });
  });
  it('picking someone already in the list does not repeat them', () => {
    expect(changeMain(list, 'b').assignments?.map(a => a.resourceId)).toEqual(['b']);
  });
  it('unassign takes the main person off; the next one becomes main', () => {
    const r = changeMain(list, '');
    expect(r.assignedTo).toBe('b');
    expect(r.assignments?.map(a => a.resourceId)).toEqual(['b']);
    expect(changeMain([row('a')], '')).toEqual({ assignedTo: '', assignments: [] });
  });
});
