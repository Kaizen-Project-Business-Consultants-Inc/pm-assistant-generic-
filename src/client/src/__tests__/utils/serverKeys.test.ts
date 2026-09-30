import { describe, it, expect } from 'vitest';
import { serverKey, valueFor } from '../../utils/serverKeys';
import { snakeToCamel } from '../../../../server/utils/caseConverter';

/** Intake answers are keyed by question id, and the server renames those keys (2026-09-30). */
describe('matching stored keys the server renamed', () => {
  it('uses exactly the server rule', () => {
    for (const k of ['field_1_1790841234567', 'project_name', 'a_b_c', 'already', 'x_9y']) {
      expect(serverKey(k)).toBe(snakeToCamel(k));
    }
  });

  it('finds an intake answer under its original or renamed key', () => {
    const id = 'field_1_1790841234567';
    expect(valueFor({ [snakeToCamel(id)]: 'Acme rollout' }, id)).toBe('Acme rollout');
    expect(valueFor({ [id]: 'as stored' }, id)).toBe('as stored');
    expect(valueFor({}, id)).toBeUndefined();
    expect(valueFor(null, id)).toBeUndefined();
  });
});
