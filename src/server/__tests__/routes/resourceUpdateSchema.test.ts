import { describe, it, expect } from 'vitest';
import { updateResourceSchema, createResourceSchema } from '../../routes/resources/resources';

describe('createResourceSchema', () => {
  it('accepts name only', () => {
    // Regression test: role and email were required, so even a name-only
    // create (the common case when entering a bid's Key Personnel list one
    // name at a time) failed with a bare "Invalid resource data" and no
    // detail on which field was the problem.
    const parsed = createResourceSchema.parse({ name: 'Samir Patel' });
    expect(parsed.name).toBe('Samir Patel');
    expect(parsed.role).toBeUndefined();
    expect(parsed.email).toBeUndefined();
  });

  it('accepts name + role with no email', () => {
    const parsed = createResourceSchema.parse({ name: 'Samir Patel', role: 'System Architecture' });
    expect(parsed.role).toBe('System Architecture');
  });

  it('still rejects a malformed email', () => {
    expect(() => createResourceSchema.parse({ name: 'Samir Patel', email: 'not-an-email' })).toThrow();
  });
});

describe('updateResourceSchema', () => {
  it('does not reintroduce create-time defaults for omitted fields', () => {
    // Regression test: createResourceSchema.partial() used to silently fill
    // isActive/skills/capacityHoursPerWeek/cost rates with their CREATE
    // defaults on any update that omitted them — updating a resource's name
    // could silently reactivate it (isActive -> true) and wipe its skills.
    const parsed = updateResourceSchema.parse({ name: 'Renamed only' });
    expect(parsed.isActive).toBeUndefined();
    expect(parsed.skills).toBeUndefined();
    expect(parsed.capacityHoursPerWeek).toBeUndefined();
    expect(parsed.costRateHourly).toBeUndefined();
    expect(parsed.overtimeRateHourly).toBeUndefined();
    expect(parsed.resourceGroup).toBeUndefined();
    expect(parsed.userId).toBeUndefined();
    expect(parsed.calendarTemplateId).toBeUndefined();
  });

  it('still applies an explicitly-sent value', () => {
    const parsed = updateResourceSchema.parse({ isActive: false, capacityHoursPerWeek: 20 });
    expect(parsed.isActive).toBe(false);
    expect(parsed.capacityHoursPerWeek).toBe(20);
  });
});
