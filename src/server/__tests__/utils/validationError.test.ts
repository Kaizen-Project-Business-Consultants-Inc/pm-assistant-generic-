import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { validationMessage } from '../../utils/validationError';

function messageFor(schema: z.ZodTypeAny, body: unknown): string {
  const r = schema.safeParse(body);
  if (r.success) throw new Error('expected the body to fail');
  return validationMessage(r.error);
}

/**
 * A permission-matrix run sent `{}` to every route; 28 answered 500 because a failed
 * schema check fell into the catch-all. The fix answers 400 with this message, so it has
 * to read as plain English, not as Zod's internals.
 */
describe('validationMessage', () => {
  it("uses the schema's own message when it has one", () => {
    const schema = z.object({ name: z.string({ message: 'Enter a name for the group.' }).min(1, 'Enter a name for the group.') });
    expect(messageFor(schema, {})).toBe('Enter a name for the group.');
    expect(messageFor(schema, { name: '' })).toBe('Enter a name for the group.');
  });

  it("turns Zod's built-in 'expected string, received undefined' into '<Field> is missing.'", () => {
    const schema = z.object({ projectId: z.string() });
    expect(messageFor(schema, {})).toBe('Project id is missing.');
  });

  it("turns other built-in messages into '<Field> is not valid.'", () => {
    const schema = z.object({ hoursPerDay: z.number().max(24) });
    expect(messageFor(schema, { hoursPerDay: 99 })).toBe('Hours per day is not valid.');
  });

  it('names nested fields and drops array positions', () => {
    const schema = z.object({ values: z.array(z.object({ field_id: z.string() })) });
    expect(messageFor(schema, { values: [{}] })).toBe('Values field id is missing.');
  });

  it('says nothing was sent when the whole body is missing', () => {
    const schema = z.object({ name: z.string() });
    expect(messageFor(schema, undefined)).toBe('Some required details are missing — nothing was sent.');
  });

  it('never leaks the raw Zod text', () => {
    const schema = z.object({ a: z.string(), b: z.number(), c: z.enum(['x', 'y']) });
    for (const body of [{}, { a: 'ok' }, { a: 'ok', b: 1 }, { a: 'ok', b: 1, c: 'z' }]) {
      expect(messageFor(schema, body)).not.toMatch(/Invalid input|expected|received/i);
    }
  });
});
