import { describe, it, expect } from 'vitest';
import { updateProjectSchema } from '../../routes/core/projects';

describe('updateProjectSchema', () => {
  it('does not reintroduce create-time defaults for omitted fields', () => {
    // Regression test: createProjectSchema.partial() used to silently fill
    // methodology/priority/projectType/status/currency with their CREATE
    // defaults whenever a PUT omitted them — a project update that only
    // changed one field reset all the others.
    const parsed = updateProjectSchema.parse({ name: 'Renamed only' });
    expect(parsed.methodology).toBeUndefined();
    expect(parsed.priority).toBeUndefined();
    expect(parsed.projectType).toBeUndefined();
    expect(parsed.status).toBeUndefined();
    expect(parsed.currency).toBeUndefined();
  });

  it('still applies an explicitly-sent value', () => {
    const parsed = updateProjectSchema.parse({ methodology: 'hybrid', priority: 'high' });
    expect(parsed.methodology).toBe('hybrid');
    expect(parsed.priority).toBe('high');
  });

  it('rejects an invalid enum value the same as before', () => {
    expect(() => updateProjectSchema.parse({ methodology: 'not-a-real-methodology' })).toThrow();
  });
});

describe('updateProjectSchema - reporting period rule', () => {
  it('accepts the three periods and the switch, and leaves them out when not sent', () => {
    expect(updateProjectSchema.parse({ reportingPeriod: 'two_weeks', periodRuleEnabled: false })).toMatchObject({ reportingPeriod: 'two_weeks', periodRuleEnabled: false });
    const none = updateProjectSchema.parse({ name: 'Only a rename' });
    expect(none.reportingPeriod).toBeUndefined();
    expect(none.periodRuleEnabled).toBeUndefined();
  });

  it('rejects a period that is not offered', () => {
    expect(() => updateProjectSchema.parse({ reportingPeriod: 'fortnight' })).toThrow();
    expect(() => updateProjectSchema.parse({ periodRuleEnabled: 'yes' })).toThrow();
  });
});
