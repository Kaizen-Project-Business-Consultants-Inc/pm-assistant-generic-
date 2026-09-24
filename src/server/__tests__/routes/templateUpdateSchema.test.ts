import { describe, it, expect } from 'vitest';
import { updateTemplateSchema } from '../../routes/collaboration/templates';

describe('updateTemplateSchema', () => {
  it('does not reintroduce tags: [] for an omitted field', () => {
    // Regression test: createTemplateSchema.partial() used to silently wipe
    // tags to [] on any update that omitted them.
    const parsed = updateTemplateSchema.parse({ name: 'Renamed only' });
    expect(parsed.tags).toBeUndefined();
  });

  it('still applies explicitly-sent tags', () => {
    const parsed = updateTemplateSchema.parse({ tags: ['agile', 'it'] });
    expect(parsed.tags).toEqual(['agile', 'it']);
  });
});
