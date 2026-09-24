import { describe, it, expect } from 'vitest';
import { updateSchema } from '../../routes/resources/calendarTemplates';

describe('calendar template updateSchema', () => {
  it('does not reintroduce isDefault: false for an omitted field', () => {
    // Regression test: createSchema.partial() used to silently reset
    // isDefault to false on any update that omitted it.
    const parsed = updateSchema.parse({ name: 'Renamed only' });
    expect(parsed.isDefault).toBeUndefined();
  });

  it('still applies an explicitly-sent value', () => {
    const parsed = updateSchema.parse({ isDefault: true });
    expect(parsed.isDefault).toBe(true);
  });
});
