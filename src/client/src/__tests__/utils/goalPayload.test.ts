import { describe, it, expect } from 'vitest';
import { goalPayload } from '../../pages/GoalsPage';

/** Creating a goal always failed: wrong field names (fixed), then "" in empty number boxes (2026-09-30). */
describe('goal form → what the server accepts', () => {
  const base = { name: 'Win the bid', description: '', goalType: 'objective' as const, parentId: '', status: 'on_track', targetValue: '', currentValue: '', unit: '', startDate: '', dueDate: '2026-12-31', projectId: '', progress: '' };

  it('leaves empty optional fields out and keeps the rest', () => {
    expect(goalPayload(base as any)).toEqual({ name: 'Win the bid', goalType: 'objective', status: 'on_track', dueDate: '2026-12-31' });
  });

  it('sends numbers as numbers, including 0', () => {
    expect(goalPayload({ ...base, targetValue: '100', currentValue: '0' } as any)).toMatchObject({ targetValue: 100, currentValue: 0 });
  });

  it('only a key result carries its parent objective', () => {
    expect(goalPayload({ ...base, parentId: 'o1' } as any).parentId).toBeUndefined();
    expect(goalPayload({ ...base, goalType: 'key_result', parentId: 'o1' } as any).parentId).toBe('o1');
  });
});
