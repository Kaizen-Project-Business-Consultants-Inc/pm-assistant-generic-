import { describe, it, expect, vi } from 'vitest';
import {
  resolveAssigneeResources,
  assigneeToResourceId,
  normalizeAssigneeName,
} from '../../utils/assigneeResources';

describe('assigneeResources', () => {
  const existing = [
    { id: 'res-dbj', name: 'DBJ' },
    { id: 'res-jv', name: ' JV ' },
  ];

  it('maps existing resources case-insensitively without creating anything', async () => {
    const create = vi.fn();
    const { idByName, created } = await resolveAssigneeResources(['dbj', 'Jv'], existing, create);
    expect(create).not.toHaveBeenCalled();
    expect(created).toBe(0);
    expect(idByName.get('dbj')).toBe('res-dbj');
    expect(idByName.get('jv')).toBe('res-jv');
  });

  it('creates missing resources once and records their IDs', async () => {
    let n = 0;
    const create = vi.fn(async (name: string) => ({ id: `new-${++n}`, name }));
    const { idByName, created } = await resolveAssigneeResources(
      ['DBJ & JV', 'dbj & jv', '  ', 'JV'],
      existing,
      create,
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith('DBJ & JV');
    expect(created).toBe(1);
    expect(idByName.get('dbj & jv')).toBe('new-1');
    expect(idByName.get('jv')).toBe('res-jv');
  });

  it('keeps the first resource when two existing resources share a name', async () => {
    const dupes = [{ id: 'a', name: 'Sam' }, { id: 'b', name: 'sam' }];
    const { idByName } = await resolveAssigneeResources([], dupes, vi.fn());
    expect(idByName.get('sam')).toBe('a');
  });

  it('assigneeToResourceId returns the ID when known and the raw name otherwise', () => {
    const map = new Map([['dbj', 'res-dbj']]);
    expect(assigneeToResourceId(' DBJ ', map)).toBe('res-dbj');
    expect(assigneeToResourceId('Unknown Person', map)).toBe('Unknown Person');
    expect(assigneeToResourceId('', map)).toBeUndefined();
    expect(assigneeToResourceId(undefined, map)).toBeUndefined();
  });

  it('normalizeAssigneeName trims and lower-cases', () => {
    expect(normalizeAssigneeName('  Alex Thompson ')).toBe('alex thompson');
  });
});
