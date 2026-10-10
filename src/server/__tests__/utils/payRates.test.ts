import { describe, it, expect, vi } from 'vitest';

/**
 * 2026-10-09 audit M11: the people lists showed every person's pay rate to team members, viewers
 * and executives (the rate card itself was already hidden from them), and emails to guests.
 */
const org = vi.hoisted(() => ({ owner: 'owner-1' }));
vi.mock('../../services/OrganizationService', () => ({
  organizationService: { findByUserId: vi.fn(async () => ({ id: 'o1', ownerUserId: org.owner })) },
}));

import { maySeePayRates, peopleFor } from '../../utils/payRates';

const req = (user: Record<string, unknown>) => ({ user }) as any;
const people = [{ id: 'r1', name: 'Ann', email: 'ann@co.example', costRateHourly: 95, overtimeRateHourly: 140 }];

describe('who sees pay rates and emails in the people lists', () => {
  it('PMO, project managers and the company owner see rates', async () => {
    expect(await maySeePayRates(req({ userId: 'u', role: 'pmo' }))).toBe(true);
    expect(await maySeePayRates(req({ userId: 'u', role: 'project_manager' }))).toBe(true);
    expect(await maySeePayRates(req({ userId: 'owner-1', role: 'team_member' }))).toBe(true);
    expect((await peopleFor(req({ userId: 'u', role: 'project_manager' }), people))[0].costRateHourly).toBe(95);
  });

  it('team members, viewers and executives get the list without rates, emails kept', async () => {
    for (const role of ['team_member', 'viewer', 'executive']) {
      const [ann] = await peopleFor(req({ userId: 'u', role }), people);
      expect(ann).toMatchObject({ name: 'Ann', email: 'ann@co.example', costRateHourly: null, overtimeRateHourly: null });
    }
  });

  it('a guest sees names only: no rates, no emails — even with a PM role', async () => {
    const [ann] = await peopleFor(req({ userId: 'g', role: 'project_manager', isGuest: true }), people);
    expect(ann).toMatchObject({ name: 'Ann', email: null, costRateHourly: null });
  });

  it('rows without rate fields are left as they are', async () => {
    const [row] = await peopleFor(req({ userId: 'u', role: 'viewer' }), [{ id: 'x', email: 'x@co.example' }] as any);
    expect(row).toEqual({ id: 'x', email: 'x@co.example' });
  });
});
