import { describe, it, expect, vi, beforeEach } from 'vitest';

const { items, repo, reviewRepo, riskUpdate } = vi.hoisted(() => {
const items = new Map<string, any>();
const repo = {
  findByProject: vi.fn(async () => [...items.values()]),
  findById: vi.fn(async (id: string) => (items.has(id) ? { ...items.get(id) } : null)),
  nextSequenceId: vi.fn(async (type: string) => ({ sequenceNumber: 7, recordId: type === 'action' ? 'A-007' : 'R-099' })),
  update: vi.fn(async (id: string, data: any) => { items.set(id, { ...items.get(id), ...data }); return items.get(id); }),
  recordIdTaken: vi.fn(async () => false),
  createActivityLog: vi.fn(async () => ({})),
};
const reviewRepo = {
  insertReview: vi.fn(async () => {}),
  findReviewById: vi.fn(async () => ({ createdAt: '2026-09-29 10:00:00' })),
  findLatestReview: vi.fn(async () => null),
  pruneReviews: vi.fn(async () => {}),
  getDisabledRules: vi.fn(async () => [] as string[]),
  setDisabledRules: vi.fn(async () => {}),
  insertBatch: vi.fn(async () => {}),
  findBatch: vi.fn(),
  markUndone: vi.fn(async () => {}),
  findLatestBatchId: vi.fn(async () => 'b1'),
  itemsChangedSince: vi.fn(async () => 0),
};
const riskUpdate = vi.fn(async (id: string, data: any) => repo.update(id, data));
  return { items, repo, reviewRepo, riskUpdate };
});


vi.mock('../../../database/RiskRepository', () => ({
  riskRepository: repo,
  RAID_RESPONSE_STRATEGIES: ['avoid', 'mitigate', 'transfer', 'accept', 'escalate'],
}));

vi.mock('../../../database/RaidReviewRepository', () => ({ raidReviewRepository: reviewRepo }));

vi.mock('../../../services/RiskService', () => ({ riskService: { update: (...a: any[]) => (riskUpdate as any)(...a) } }));
vi.mock('../../../services/ProjectMemberService', () => ({
  projectMemberService: { findByProjectId: vi.fn(async () => [{ userId: 'u-marsha', userName: 'Marsha Turner', email: 'm@x' }]) },
}));
vi.mock('../../../services/ResourceService', () => ({
  resourceService: { findAllResources: vi.fn(async () => [
    { id: 'res-1', name: 'SubCo Crew', isActive: true, userId: null },
    { id: 'res-2', name: 'Marsha Turner', isActive: true, userId: 'u-marsha' },
  ]) },
}));
vi.mock('../../../services/CalendarService', () => ({
  calendarService: { workingDayChecker: vi.fn(async () => (d: string) => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) },
}));
vi.mock('../../../services/StatusDateService', () => ({ statusDateFor: vi.fn(async () => '2026-09-29') }));
vi.mock('../../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { raidReviewService, RaidReviewInputError, RaidUndoConflictError } from '../../../services/RaidReviewService';

const seed = () => {
  items.clear();
  items.set('r10', { id: 'r10', projectId: 'p1', type: 'risk', recordId: 'R-010', sequenceNumber: 10, title: 'Provide the test data', status: 'monitoring', severity: 'high', ownerId: null, ownerResourceId: null, ownerName: 'DBJ', dueDate: null, responseStrategy: null, resolvedAt: null, updatedAt: '2026-09-29 09:00:00' });
  items.set('a1', { id: 'a1', projectId: 'p1', type: 'action', recordId: 'A-001', sequenceNumber: 1, title: 'Chase vendor', status: 'open', ownerId: null, ownerResourceId: null, ownerName: null, dueDate: null, updatedAt: '2026-09-29 09:00:00' });
};

describe('RaidReviewService', () => {
  beforeEach(() => { vi.clearAllMocks(); seed(); });

  it('run stores and returns the review with the disabled rules', async () => {
    reviewRepo.getDisabledRules.mockResolvedValueOnce(['RR12']);
    const r = await raidReviewService.run('p1', 'u1');
    expect(reviewRepo.insertReview).toHaveBeenCalledOnce();
    expect(r.disabledRules).toEqual(['RR12']);
    expect(r.itemsChecked).toBe(2);
    expect(r.findings.some(f => f.ruleId === 'RR12')).toBe(false);
    expect(r.score).toBeLessThan(100);
  });

  it('proposes fixes and lists members plus resources without an account', async () => {
    const { fixes, people } = await raidReviewService.proposeFixes('p1');
    expect(people).toEqual([
      { value: 'user:u-marsha', label: 'Marsha Turner' },
      { value: 'resource:res-1', label: 'SubCo Crew' },
    ]);
    expect(fixes.map(f => f.id)).toEqual(expect.arrayContaining(['change_type:r10', 'set_owner:r10', 'set_owner:a1', 'set_due_date:a1', 'set_response_strategy:r10']));
  });

  it('refuses a missing value with a plain message and changes nothing', async () => {
    await expect(raidReviewService.applyFixes('p1', [
      { id: 'change_type:r10', kind: 'change_type', itemId: 'r10', toType: 'action' },
      { id: 'set_owner:a1', kind: 'set_owner', itemId: 'a1' },
    ], 'u1')).rejects.toThrow(new RaidReviewInputError('Pick a person for A-001'));
    expect(riskUpdate).not.toHaveBeenCalled();
    await expect(raidReviewService.applyFixes('p1', [{ id: 'x', kind: 'set_owner', itemId: 'a1', value: 'user:stranger' }], 'u1'))
      .rejects.toBeInstanceOf(RaidReviewInputError);
    await expect(raidReviewService.applyFixes('p1', [{ id: 'x', kind: 'set_due_date', itemId: 'a1', value: 'soon' }], 'u1'))
      .rejects.toThrow('Pick a due date for A-001');
    await expect(raidReviewService.applyFixes('p2', [{ id: 'x', kind: 'set_due_date', itemId: 'a1', value: '2026-10-10' }], 'u1'))
      .rejects.toBeInstanceOf(RaidReviewInputError); // another project's item
  });

  it('applies fixes through RiskService, records previous values, and summarises', async () => {
    const res = await raidReviewService.applyFixes('p1', [
      { id: 'change_type:r10', kind: 'change_type', itemId: 'r10', toType: 'action' },
      { id: 'set_owner:r10', kind: 'set_owner', itemId: 'r10', value: 'user:u-marsha' },
      { id: 'set_owner:a1', kind: 'set_owner', itemId: 'a1', value: 'resource:res-1' },
      { id: 'set_due_date:a1', kind: 'set_due_date', itemId: 'a1', value: '2026-10-13' },
    ], 'u1');
    expect(res).toMatchObject({ applied: 4, summary: 'RAID Review fixes: 1 moved to Actions, 2 owners set, 1 due date set' });
    expect(riskUpdate).toHaveBeenCalledWith('r10', { type: 'action', recordId: 'A-007', sequenceNumber: 7, status: 'open' }, 'u1');
    expect(riskUpdate).toHaveBeenCalledWith('r10', { ownerId: 'u-marsha', ownerResourceId: null, ownerName: null }, 'u1');
    expect(riskUpdate).toHaveBeenCalledWith('a1', { ownerResourceId: 'res-1', ownerId: null, ownerName: null }, 'u1');
    const batch = (reviewRepo.insertBatch.mock.calls[0] as any)[0];
    expect(batch.previous.r10).toMatchObject({ type: 'risk', recordId: 'R-010', sequenceNumber: 10, status: 'monitoring', ownerId: null, ownerName: 'DBJ' });
    expect(batch.previous.a1).toMatchObject({ dueDate: null, ownerResourceId: null });
    expect(batch.itemIds.sort()).toEqual(['a1', 'r10']);
    expect(reviewRepo.insertReview).toHaveBeenCalled(); // re-run
  });

  it('undo restores previous values exactly', async () => {
    reviewRepo.findBatch.mockResolvedValue({
      id: 'b1', projectId: 'p1', summary: 's', createdAt: '2026-09-29 09:00:02', undoneAt: null,
      itemIds: ['r10'], previous: { r10: { type: 'risk', recordId: 'R-010', sequenceNumber: 10, ownerName: 'DBJ', ownerId: null } },
    });
    const res = await raidReviewService.undo('p1', 'b1', 'u1');
    expect(res).toEqual({ restored: 1 });
    expect(repo.update).toHaveBeenCalledWith('r10', { type: 'risk', recordId: 'R-010', sequenceNumber: 10, ownerName: 'DBJ', ownerId: null }, { resolveOwner: false });
    expect(reviewRepo.markUndone).toHaveBeenCalledWith('b1', 'u1');
  });

  it('undo gives a new record id when the old one was reused', async () => {
    repo.recordIdTaken.mockResolvedValueOnce(true);
    items.set('r10', { ...items.get('r10'), type: 'action', recordId: 'A-007' });
    reviewRepo.findBatch.mockResolvedValue({
      id: 'b1', projectId: 'p1', summary: 's', createdAt: '2026-09-29 09:00:02', undoneAt: null,
      itemIds: ['r10'], previous: { r10: { type: 'risk', recordId: 'R-010', sequenceNumber: 10 } },
    });
    await raidReviewService.undo('p1', 'b1', 'u1');
    expect(repo.update).toHaveBeenCalledWith('r10', { type: 'risk', recordId: 'R-099', sequenceNumber: 7 }, { resolveOwner: false });
  });

  it('undo is refused once anything in the register changed since — there is no "undo anyway"', async () => {
    reviewRepo.itemsChangedSince.mockResolvedValueOnce(1);
    reviewRepo.findBatch.mockResolvedValue({
      id: 'b1', projectId: 'p1', summary: 's', createdAt: '2026-09-29 09:00:02', undoneAt: null,
      itemIds: ['a1', 'r10'], previous: { a1: { dueDate: null }, r10: { ownerName: 'DBJ' } },
    });
    const err = await raidReviewService.undo('p1', 'b1', 'u1').catch(e => e);
    expect(err).toBeInstanceOf(RaidUndoConflictError);
    expect(err.code).toBe('not_latest');
    expect(err.message).toMatch(/Only the most recent fixes can be undone/);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('undo of older fixes is refused, even if their items were not touched', async () => {
    reviewRepo.findLatestBatchId.mockResolvedValueOnce('b-newer');
    reviewRepo.findBatch.mockResolvedValue({
      id: 'b1', projectId: 'p1', summary: 's', createdAt: '2026-09-29 09:00:02', undoneAt: null,
      itemIds: ['r10'], previous: { r10: { ownerName: 'DBJ' } },
    });
    await expect(raidReviewService.undo('p1', 'b1', 'u1')).rejects.toMatchObject({ code: 'not_latest' });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('undo of an already-undone batch is refused', async () => {
    reviewRepo.findBatch.mockResolvedValue({ id: 'b1', projectId: 'p1', summary: 's', createdAt: 'x', undoneAt: '2026-09-29', itemIds: [], previous: {} });
    await expect(raidReviewService.undo('p1', 'b1', 'u1')).rejects.toBeInstanceOf(RaidUndoConflictError);
  });

  it('settings keep only known rules and re-run', async () => {
    const out = await raidReviewService.setDisabledRules('p1', ['RR12', 'RR05', 'NOPE', 'RR12'], 'u1');
    expect(out).toEqual(['RR05', 'RR12']);
    expect(reviewRepo.setDisabledRules).toHaveBeenCalledWith('p1', ['RR05', 'RR12']);
    expect(reviewRepo.insertReview).toHaveBeenCalled();
  });
});

describe('namesInOwnerColumn', () => {
  it('splits joint owners into people and leaves out single-word teams', async () => {
    const { namesInOwnerColumn } = await import('../../../services/RaidReviewService');
    expect(namesInOwnerColumn([
      { ownerName: 'Marsha Turner / Rashida Wynter' },
      { ownerName: 'Michel Spence / Claudia Andrews (DBJ)' },
      { ownerName: 'DBJ' },
      { ownerName: 'Claudia Andrews and Sophia Bryan-Terry' },
      { ownerName: null },
    ]).sort()).toEqual(['Claudia Andrews', 'Marsha Turner', 'Michel Spence', 'Rashida Wynter', 'Sophia Bryan-Terry']);
  });
});
