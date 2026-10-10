import { describe, it, expect } from 'vitest';
import { canSeePayRates } from '../../utils/rateCard';

/** The people form shows rate fields only to those the server sends rates to (2026-10-10) */
describe('canSeePayRates', () => {
  it('PM, PMO (incl. the company owner) and admin see rates', () => {
    for (const role of ['project_manager', 'pmo', 'admin', 'finance_officer']) expect(canSeePayRates({ role })).toBe(true);
  });
  it('scrum master, team member, viewer, executive and any guest do not', () => {
    for (const role of ['scrum_master', 'team_member', 'viewer', 'executive', 'risk_manager']) expect(canSeePayRates({ role })).toBe(false);
    expect(canSeePayRates({ role: 'project_manager', isGuest: true })).toBe(false);
    expect(canSeePayRates(null)).toBe(false);
  });
});
