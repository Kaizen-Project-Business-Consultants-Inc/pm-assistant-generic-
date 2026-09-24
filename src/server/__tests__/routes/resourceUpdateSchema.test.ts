import { describe, it, expect } from 'vitest';
import { updateResourceSchema } from '../../routes/resources/resources';

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
