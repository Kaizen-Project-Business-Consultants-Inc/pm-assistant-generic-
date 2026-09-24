import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../database/connection', () => ({
  databaseService: {
    query: vi.fn().mockResolvedValue([]),
    transaction: vi.fn(async (cb: any) => cb({})),
    queryOn: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('uuid', () => ({ v4: () => 'test-raid-id' }));

import { riskRepository } from '../../database/RiskRepository';
import { databaseService } from '../../database/connection';

const mockQuery = databaseService.query as ReturnType<typeof vi.fn>;
const mockQueryOn = databaseService.queryOn as ReturnType<typeof vi.fn>;

const sampleRow = {
  id: 'r1', project_id: 'p1', type: 'risk', title: 'Test', description: null,
  category: 'other', severity: 'medium', probability: 3, impact: 3, risk_score: 9,
  status: 'open', trigger_condition: null, triggered: 0, triggered_at: null,
  mitigation_plan: null, response_plan: null, owner_id: null, owner_resource_id: null,
  source: 'manual', source_agent_id: null, ai_confidence: null, linked_task_ids: null,
  linked_proposal_id: null, created_by: 'u1', created_at: '2026-01-01', updated_at: '2026-01-01',
  resolved_at: null, sequence_number: 1, record_id: 'R-001', due_date: null,
  action_type: null, rationale: null, decided_by: null, decision_date: null,
  alternatives_considered: null, stakeholders_consulted: null, cancel_reason: null,
  linked_raid_ids: null, root_cause: null, impact_assessment: null, workaround: null,
  validation_plan: null, dependent_entity: null, forum: null, source_meeting: null,
  owner_name: null,
};

describe('RiskRepository — resource ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryOn.mockResolvedValue([]); // nextSequenceId
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('INSERT') || sql.startsWith('UPDATE')) return [];
      return [sampleRow]; // findById
    });
  });

  it('create() writes ownerResourceId directly when explicitly given, and clears ownerId', async () => {
    await riskRepository.create({
      projectId: 'p1', type: 'risk', title: 'Test', createdBy: 'u1',
      ownerResourceId: 'res-1',
    } as any);

    const insertCall = mockQuery.mock.calls.find((c) => String(c[0]).startsWith('INSERT'));
    expect(insertCall![0]).toContain('owner_resource_id');
    expect(insertCall![1]).toContain('res-1');
  });

  it('create() resolves ownerName to a resource id when no user matches', async () => {
    // resolveOwnerId (searches resources WHERE user_id IS NOT NULL) finds nothing;
    // resolveOwnerResourceId (no such filter) finds the resource.
    mockQuery.mockImplementation(async (sql: string, params?: any[]) => {
      if (sql.includes('user_id IS NOT NULL')) return []; // resolveOwnerId: no linked account
      if (sql.startsWith('SELECT id FROM resources')) return [{ id: 'res-sapphire' }]; // resolveOwnerResourceId
      if (sql.startsWith('INSERT') || sql.startsWith('UPDATE')) return [];
      return [sampleRow];
    });

    await riskRepository.create({
      projectId: 'p1', type: 'risk', title: 'Test', createdBy: 'u1',
      ownerName: 'Sapphire Team',
    } as any);

    const insertCall = mockQuery.mock.calls.find((c) => String(c[0]).startsWith('INSERT'));
    expect(insertCall![1]).toContain('res-sapphire');
  });

  it('update() clears ownerResourceId when ownerId is set explicitly', async () => {
    await riskRepository.update('r1', { ownerId: 'user-1' });

    const updateCall = mockQuery.mock.calls.find((c) => String(c[0]).startsWith('UPDATE'));
    expect(updateCall![0]).toContain('owner_resource_id = ?');
    expect(updateCall![0]).toContain('owner_id = ?');
  });

  it('update() clears ownerId when ownerResourceId is set explicitly', async () => {
    await riskRepository.update('r1', { ownerResourceId: 'res-1' });

    const updateCall = mockQuery.mock.calls.find((c) => String(c[0]).startsWith('UPDATE'));
    expect(updateCall![0]).toContain('owner_id = ?');
    expect(updateCall![0]).toContain('owner_resource_id = ?');
  });

  it('row mapper surfaces ownerResourceId', async () => {
    mockQuery.mockResolvedValueOnce([{ ...sampleRow, owner_resource_id: 'res-1', owner_id: null }]);
    const risk = await riskRepository.findById('r1');
    expect(risk!.ownerResourceId).toBe('res-1');
  });
});
