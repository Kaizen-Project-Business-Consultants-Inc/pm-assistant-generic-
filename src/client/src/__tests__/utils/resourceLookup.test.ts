import { describe, it, expect } from 'vitest';
import { findResourceForAssignee } from '../../utils/resourceLookup';

const resources = [
  { id: 'res-1', name: 'Alex Thompson', userId: 'user-1' },
  { id: 'res-2', name: 'DBJ & JV', userId: null },
  { id: 'res-3', name: 'user-1', userId: null }, // name that collides with a user ID
];

describe('findResourceForAssignee', () => {
  it('returns null for empty values', () => {
    expect(findResourceForAssignee(resources, null)).toBeNull();
    expect(findResourceForAssignee(resources, undefined)).toBeNull();
    expect(findResourceForAssignee(resources, '   ')).toBeNull();
  });

  it('matches by resource ID', () => {
    expect(findResourceForAssignee(resources, 'res-2')?.name).toBe('DBJ & JV');
  });

  it('matches by linked user ID before falling back to name', () => {
    expect(findResourceForAssignee(resources, 'user-1')?.id).toBe('res-1');
  });

  it('falls back to a case-insensitive, trimmed name match', () => {
    expect(findResourceForAssignee(resources, ' dbj & jv ')?.id).toBe('res-2');
    expect(findResourceForAssignee(resources, 'ALEX THOMPSON')?.id).toBe('res-1');
  });

  it('returns null when nothing matches', () => {
    expect(findResourceForAssignee(resources, 'Nobody')).toBeNull();
  });
});
