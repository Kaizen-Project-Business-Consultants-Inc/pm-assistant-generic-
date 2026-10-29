import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  members: [] as any[],
  project: { id: 'p1', name: 'DBJ', createdBy: 'owner' } as any,
  overlap: undefined as any,
  companyLogin: true,
  person: { id: 'sam', fullName: 'Sam', email: 'sam@x.io', isActive: true } as any,
  inserted: [] as any[],
}));
vi.mock('../../database/ProjectCoverRepository', () => ({
  projectCoverRepository: {
    findOverlapping: vi.fn(async () => h.overlap),
    insert: vi.fn(async (d: any) => { const row = { id: 'c1', ...d, endedAt: null }; h.inserted.push(row); return row; }),
    markStartNotified: vi.fn(async () => {}),
    findCurrentOrUpcoming: vi.fn(async () => undefined),
  },
}));
vi.mock('../../database/ProjectMemberRepository', () => ({ projectMemberRepository: { findByProjectId: vi.fn(async () => h.members) } }));
vi.mock('../../database/connection', () => ({ databaseService: { query: vi.fn(async () => [{ n: 1 }]) } }));
vi.mock('../../services/ProjectService', () => ({ projectService: { findById: vi.fn(async () => h.project) } }));
vi.mock('../../services/UserService', () => ({ userService: { findById: vi.fn(async (id: string) => (id === 'sam' ? h.person : { id, fullName: 'Dana', email: 'dana@x.io', isActive: true })) } }));
vi.mock('../../services/NotificationService', () => ({ notificationService: { create: vi.fn(async () => ({})) } }));
vi.mock('../../services/EmailService', () => ({ emailService: { sendNotificationEmail: vi.fn(async () => {}) } }));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append: vi.fn(async () => ({})) } }));
vi.mock('../../services/peopleRights', () => ({ isCompanyLogin: vi.fn(async () => h.companyLogin) }));
vi.mock('../../services/projectCoverAccess', () => ({ coverToday: vi.fn(async () => '2026-10-30') }));
vi.mock('../../middleware/requestContext', () => ({ getActorSource: () => 'web' }));
vi.mock('../../config', () => ({ config: { APP_URL: 'https://x.test' } }));

import { projectCoverService, CoverError, isLineManagerOfOwner, MAX_COVER_DAYS } from '../../services/ProjectCoverService';
import { notificationService } from '../../services/NotificationService';
import { emailService } from '../../services/EmailService';
import { auditLedgerService } from '../../services/AuditLedgerService';

const start = (o: any = {}) => projectCoverService.start({ userId: 'owner' }, 'p1', { coverUserId: 'sam', startDate: '2026-11-02', endDate: '2026-11-12', ...o });
const refused = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as CoverError; } throw new Error('expected a refusal'); };

beforeEach(() => {
  vi.clearAllMocks();
  h.members = [{ userId: 'owner', role: 'owner' }];
  h.overlap = undefined; h.companyLogin = true; h.inserted = [];
  h.person = { id: 'sam', fullName: 'Sam', email: 'sam@x.io', isActive: true };
});

describe('starting cover', () => {
  it('saves it, records who started it, and tells both people (in the app and by email)', async () => {
    const c = await start();
    expect(c).toMatchObject({ projectId: 'p1', ownerUserId: 'owner', coverUserId: 'sam', startDate: '2026-11-02', endDate: '2026-11-12', startedBy: 'owner' });
    expect(auditLedgerService.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'project.cover_started', projectId: 'p1' }));
    await new Promise<void>(r => { setTimeout(r, 0); });
    expect(notificationService.create).toHaveBeenCalledTimes(2);
    expect((emailService.sendNotificationEmail as any).mock.calls.map((c: any[]) => c[0]).sort()).toEqual(['dana@x.io', 'sam@x.io']);
  });

  it('when the company owner starts it for a sick PM, the cover is still for the project Owner', async () => {
    const c = await projectCoverService.start({ userId: 'company-owner' }, 'p1', { coverUserId: 'sam', startDate: '2026-11-02', endDate: '2026-11-05' });
    expect(c.ownerUserId).toBe('owner');
    expect(c.startedBy).toBe('company-owner');
  });

  it('refuses bad dates, an end before the start, an end already past, and more than the longest cover', async () => {
    expect((await refused(start({ startDate: 'tomorrow' }))).code).toBe('bad_dates');
    expect((await refused(start({ startDate: '2026-11-12', endDate: '2026-11-02' }))).code).toBe('bad_dates');
    expect((await refused(start({ startDate: '2026-10-01', endDate: '2026-10-20' }))).code).toBe('bad_dates');
    expect((await refused(start({ startDate: '2026-11-01', endDate: '2027-03-01' }))).code).toBe('too_long');
    expect(MAX_COVER_DAYS).toBe(90);
    expect(h.inserted).toHaveLength(0);
  });

  it('allows exactly the longest cover', async () => {
    await expect(start({ startDate: '2026-11-01', endDate: '2027-01-29' })).resolves.toBeTruthy(); // 90 days counting both ends
  });

  it('refuses the Owner covering for themselves, someone outside the company, and someone who cannot sign in', async () => {
    expect((await refused(start({ coverUserId: 'owner' }))).code).toBe('cover_is_owner');
    h.companyLogin = false;
    expect((await refused(start())).code).toBe('not_in_company');
    h.companyLogin = true; h.person = { ...h.person, isActive: false };
    expect((await refused(start())).code).toBe('not_in_company');
  });

  it('refuses a second cover in the same dates', async () => {
    h.overlap = { id: 'other' };
    const e = await refused(start());
    expect(e.status).toBe(409);
    expect(e.code).toBe('overlap');
  });

  it('refuses a project that does not exist here', async () => {
    h.project = null;
    expect((await refused(start())).status).toBe(404);
    h.project = { id: 'p1', name: 'DBJ', createdBy: 'owner' };
  });
});

describe('who counts as the Owner and the line manager', () => {
  it('a project with no Owner member is owned by its creator', async () => {
    h.members = [];
    const c = await projectCoverService.start({ userId: 'company-owner' }, 'p1', { coverUserId: 'sam', startDate: '2026-11-02', endDate: '2026-11-03' });
    expect(c.ownerUserId).toBe('owner');
  });
  it('line manager lookup asks about the Owners of the project', async () => {
    expect(await isLineManagerOfOwner('p1', 'boss')).toBe(true);
    h.members = [];
    h.project = { id: 'p1', createdBy: null };
    expect(await isLineManagerOfOwner('p1', 'boss')).toBe(false);
  });
});
