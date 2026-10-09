import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../database/PolicyRepository', () => {
  const mockRepo = {
    findActive: vi.fn().mockResolvedValue([]),
    findByProject: vi.fn().mockResolvedValue([]),
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    insert: vi.fn(),
    updateFields: vi.fn(),
    deleteById: vi.fn().mockResolvedValue(false),
    // one line per policy, as the tests below read them
    logEvaluation: vi.fn().mockResolvedValue(undefined),
    getEvaluationStats: vi.fn().mockResolvedValue({ total: 0, allowed: 0, blocked: 0, pendingApproval: 0 }),
  };
  // the lines are now written in one statement (2026-10-09); each is handed to logEvaluation so the
  // checks below still see every policy's line
  (mockRepo as any).logEvaluations = vi.fn(async (rows: any[]) => {
    for (const r of rows) await mockRepo.logEvaluation(r.policyId, r.action, r.actorId, r.entityType, r.entityId, r.matched, r.enforcementResult, r.contextSnapshot);
  });
  return { policyRepository: mockRepo };
});

vi.mock('uuid', () => ({ v4: vi.fn().mockReturnValue('generated-uuid') }));

import { PolicyEngineService, EvaluationContext } from '../../services/PolicyEngineService';
import { policyRepository, Policy } from '../../database/PolicyRepository';

const mockRepo = policyRepository as any;

function makePolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    id: 'pol-1',
    projectId: null,
    name: 'Test Policy',
    description: null,
    actionPattern: 'task.create',
    conditionExpr: { field: '', op: '==', value: '' },
    enforcement: 'block',
    isActive: true,
    createdBy: 'admin',
    createdAt: '2026-01-01',
    ...overrides,
  };
}

describe('PolicyEngineService', () => {
  let service: PolicyEngineService;

  beforeEach(() => {
    service = new PolicyEngineService();
    vi.clearAllMocks();
  });

  // ── evaluate() ──

  describe('evaluate', () => {
    const baseContext: EvaluationContext = {
      actorId: 'user-1',
      actorRole: 'team_member',
    };

    it('returns allowed when no policies exist', async () => {
      mockRepo.findActive.mockResolvedValueOnce([]);
      const result = await service.evaluate('task.create', baseContext);
      expect(result).toEqual({
        allowed: true,
        enforcement: 'allowed',
        matchedPolicies: [],
      });
    });

    it('returns blocked when a block policy matches the action', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ enforcement: 'block', conditionExpr: { field: '', op: '==', value: '' } }),
      ]);
      const result = await service.evaluate('task.create', baseContext);
      expect(result.allowed).toBe(false);
      expect(result.enforcement).toBe('blocked');
      expect(result.matchedPolicies).toHaveLength(1);
      expect(result.matchedPolicies[0]).toEqual({
        policyId: 'pol-1',
        policyName: 'Test Policy',
        enforcement: 'block',
      });
    });

    it('returns pending_approval for require_approval enforcement', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ id: 'pol-2', enforcement: 'require_approval', conditionExpr: { field: '', op: '==', value: '' } }),
      ]);
      const result = await service.evaluate('task.create', baseContext);
      expect(result.allowed).toBe(true);
      expect(result.enforcement).toBe('pending_approval');
      expect(result.matchedPolicies).toHaveLength(1);
    });

    it('returns allowed for log_only enforcement', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ enforcement: 'log_only', conditionExpr: { field: '', op: '==', value: '' } }),
      ]);
      const result = await service.evaluate('task.create', baseContext);
      expect(result.allowed).toBe(true);
      expect(result.enforcement).toBe('allowed');
      expect(result.matchedPolicies).toHaveLength(1);
    });

    it('picks the strictest enforcement when multiple policies match', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ id: 'pol-a', enforcement: 'require_approval', conditionExpr: { field: '', op: '==', value: '' } }),
        makePolicy({ id: 'pol-b', enforcement: 'block', conditionExpr: { field: '', op: '==', value: '' } }),
      ]);
      const result = await service.evaluate('task.create', baseContext);
      expect(result.allowed).toBe(false);
      expect(result.enforcement).toBe('blocked');
      expect(result.matchedPolicies).toHaveLength(2);
    });

    it('strictest enforcement: block wins over log_only', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ id: 'pol-a', enforcement: 'log_only', conditionExpr: { field: '', op: '==', value: '' } }),
        makePolicy({ id: 'pol-b', enforcement: 'block', conditionExpr: { field: '', op: '==', value: '' } }),
      ]);
      const result = await service.evaluate('task.create', baseContext);
      expect(result.enforcement).toBe('blocked');
      expect(result.allowed).toBe(false);
    });

    it('strictest enforcement: pending_approval wins over log_only', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ id: 'pol-a', enforcement: 'log_only', conditionExpr: { field: '', op: '==', value: '' } }),
        makePolicy({ id: 'pol-b', enforcement: 'require_approval', conditionExpr: { field: '', op: '==', value: '' } }),
      ]);
      const result = await service.evaluate('task.create', baseContext);
      expect(result.enforcement).toBe('pending_approval');
      expect(result.allowed).toBe(true);
    });

    it('does not match when action pattern differs', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ actionPattern: 'project.delete', enforcement: 'block' }),
      ]);
      const result = await service.evaluate('task.create', baseContext);
      expect(result.allowed).toBe(true);
      expect(result.matchedPolicies).toHaveLength(0);
    });

    it('logs evaluation for each policy via repository', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ conditionExpr: { field: '', op: '==', value: '' } }),
      ]);
      await service.evaluate('task.create', baseContext);
      expect(mockRepo.logEvaluation).toHaveBeenCalledTimes(1);
      expect(mockRepo.logEvaluation).toHaveBeenCalledWith(
        'pol-1', 'task.create', 'user-1', null, null, true, 'blocked',
        expect.objectContaining({ actor_id: 'user-1', actor_role: 'team_member' }),
      );
    });

    it('logs allowed enforcement result when condition does not match', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ enforcement: 'block', conditionExpr: { field: 'budget', op: '>', value: 1000 } }),
      ]);
      const result = await service.evaluate('task.create', { ...baseContext, data: { budget: 500 } });
      expect(result.allowed).toBe(true);
      expect(result.matchedPolicies).toHaveLength(0);
      expect(mockRepo.logEvaluation).toHaveBeenCalledWith(
        'pol-1', 'task.create', 'user-1', null, null, false, 'allowed',
        expect.objectContaining({ budget: 500 }),
      );
    });

    it('logs evaluation for non-matching action patterns too (skips logEvaluation)', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ actionPattern: 'project.delete' }),
      ]);
      await service.evaluate('task.create', baseContext);
      // Pattern didn't match, so logEvaluation should NOT be called
      expect(mockRepo.logEvaluation).not.toHaveBeenCalled();
    });

    it('swallows logEvaluation errors without affecting result', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ conditionExpr: { field: '', op: '==', value: '' } }),
      ]);
      mockRepo.logEvaluation.mockRejectedValueOnce(new Error('DB down'));
      const result = await service.evaluate('task.create', baseContext);
      expect(result.enforcement).toBe('blocked');
    });

    it('three policies: their log lines go in one write', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ id: 'a', conditionExpr: { field: '', op: '==', value: '' } }),
        makePolicy({ id: 'b', conditionExpr: { field: 'budget', op: '>', value: 1000 } }),
        makePolicy({ id: 'c', actionPattern: 'project.delete' }),
      ]);
      await service.evaluate('task.create', { ...baseContext, data: { budget: 5 } });
      expect(mockRepo.logEvaluations).toHaveBeenCalledTimes(1);
      expect(mockRepo.logEvaluations.mock.calls[0][0].map((r: any) => [r.policyId, r.matched, r.enforcementResult])).toEqual([
        ['a', true, 'blocked'], ['b', false, 'allowed'],
      ]);
    });

    it('passes projectId to getActivePolicies', async () => {
      mockRepo.findActive.mockResolvedValueOnce([]);
      await service.evaluate('task.create', { ...baseContext, projectId: 'proj-1' });
      expect(mockRepo.findActive).toHaveBeenCalledWith('proj-1');
    });

    it('passes undefined projectId when not provided', async () => {
      mockRepo.findActive.mockResolvedValueOnce([]);
      await service.evaluate('task.create', baseContext);
      expect(mockRepo.findActive).toHaveBeenCalledWith(undefined);
    });

    it('returns empty matchedPolicies when findActive throws', async () => {
      mockRepo.findActive.mockRejectedValueOnce(new Error('DB error'));
      const result = await service.evaluate('task.create', baseContext);
      expect(result.allowed).toBe(true);
      expect(result.matchedPolicies).toHaveLength(0);
    });

    it('includes entityType and entityId in logged context', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ conditionExpr: { field: '', op: '==', value: '' } }),
      ]);
      await service.evaluate('task.create', {
        ...baseContext,
        entityType: 'task',
        entityId: 'task-42',
      });
      expect(mockRepo.logEvaluation).toHaveBeenCalledWith(
        'pol-1', 'task.create', 'user-1', 'task', 'task-42', true, 'blocked',
        expect.objectContaining({ entity_type: 'task', entity_id: 'task-42' }),
      );
    });

    it('merges context.data with actor/entity fields for condition evaluation', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ conditionExpr: { field: 'custom_field', op: '==', value: 'yes' } }),
      ]);
      await service.evaluate('task.create', {
        ...baseContext,
        data: { custom_field: 'yes' },
      });
      expect(mockRepo.logEvaluation).toHaveBeenCalledWith(
        'pol-1', 'task.create', 'user-1', null, null, true, 'blocked',
        expect.objectContaining({ custom_field: 'yes', actor_role: 'team_member' }),
      );
    });

    it('evaluates multiple policies independently', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({
          id: 'pol-match', actionPattern: 'task.create',
          conditionExpr: { field: 'budget', op: '>', value: 10 }, enforcement: 'require_approval',
        }),
        makePolicy({
          id: 'pol-nomatch', actionPattern: 'task.create',
          conditionExpr: { field: 'budget', op: '>', value: 1000 }, enforcement: 'block',
        }),
      ]);
      const result = await service.evaluate('task.create', { ...baseContext, data: { budget: 50 } });
      expect(result.matchedPolicies).toHaveLength(1);
      expect(result.matchedPolicies[0].policyId).toBe('pol-match');
      expect(result.enforcement).toBe('pending_approval');
      expect(result.allowed).toBe(true);
    });
  });

  // ── Pattern matching ──

  describe('pattern matching', () => {
    const ctx: EvaluationContext = { actorId: 'u1' };

    it('matches wildcard * against any action', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ actionPattern: '*', conditionExpr: { field: '', op: '==', value: '' } }),
      ]);
      const result = await service.evaluate('anything.at.all', ctx);
      expect(result.matchedPolicies).toHaveLength(1);
    });

    it('matches prefix wildcard task.* against task.create', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ actionPattern: 'task.*', conditionExpr: { field: '', op: '==', value: '' } }),
      ]);
      const result = await service.evaluate('task.create', ctx);
      expect(result.matchedPolicies).toHaveLength(1);
    });

    it('matches prefix wildcard task.* against exact prefix task', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ actionPattern: 'task.*', conditionExpr: { field: '', op: '==', value: '' } }),
      ]);
      const result = await service.evaluate('task', ctx);
      expect(result.matchedPolicies).toHaveLength(1);
    });

    it('does not match prefix wildcard task.* against project.create', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ actionPattern: 'task.*', conditionExpr: { field: '', op: '==', value: '' } }),
      ]);
      const result = await service.evaluate('project.create', ctx);
      expect(result.matchedPolicies).toHaveLength(0);
    });

    it('does not match task.* against taskExtra (no dot separator)', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ actionPattern: 'task.*', conditionExpr: { field: '', op: '==', value: '' } }),
      ]);
      const result = await service.evaluate('taskExtra', ctx);
      expect(result.matchedPolicies).toHaveLength(0);
    });

    it('matches exact action pattern', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ actionPattern: 'task.delete', conditionExpr: { field: '', op: '==', value: '' } }),
      ]);
      const result = await service.evaluate('task.delete', ctx);
      expect(result.matchedPolicies).toHaveLength(1);
    });

    it('does not match different exact patterns', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ actionPattern: 'task.delete', conditionExpr: { field: '', op: '==', value: '' } }),
      ]);
      const result = await service.evaluate('task.create', ctx);
      expect(result.matchedPolicies).toHaveLength(0);
    });
  });

  // ── Condition evaluation operators ──

  describe('condition evaluation', () => {
    const ctx: EvaluationContext = { actorId: 'u1' };

    it('evaluates > correctly when value exceeds threshold', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ conditionExpr: { field: 'budget', op: '>', value: 100 } }),
      ]);
      const result = await service.evaluate('task.create', { ...ctx, data: { budget: 200 } });
      expect(result.matchedPolicies).toHaveLength(1);
    });

    it('evaluates > as false when value is less', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ conditionExpr: { field: 'budget', op: '>', value: 100 } }),
      ]);
      const result = await service.evaluate('task.create', { ...ctx, data: { budget: 50 } });
      expect(result.matchedPolicies).toHaveLength(0);
    });

    it('evaluates > as false when value equals threshold', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ conditionExpr: { field: 'budget', op: '>', value: 100 } }),
      ]);
      const result = await service.evaluate('task.create', { ...ctx, data: { budget: 100 } });
      expect(result.matchedPolicies).toHaveLength(0);
    });

    it('evaluates < correctly', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ conditionExpr: { field: 'priority', op: '<', value: 5 } }),
      ]);
      const result = await service.evaluate('task.create', { ...ctx, data: { priority: 3 } });
      expect(result.matchedPolicies).toHaveLength(1);
    });

    it('evaluates >= matches when equal', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ conditionExpr: { field: 'score', op: '>=', value: 10 } }),
      ]);
      const result = await service.evaluate('task.create', { ...ctx, data: { score: 10 } });
      expect(result.matchedPolicies).toHaveLength(1);
    });

    it('evaluates >= does not match when less', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ conditionExpr: { field: 'score', op: '>=', value: 10 } }),
      ]);
      const result = await service.evaluate('task.create', { ...ctx, data: { score: 9 } });
      expect(result.matchedPolicies).toHaveLength(0);
    });

    it('evaluates <= matches when equal', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ conditionExpr: { field: 'score', op: '<=', value: 10 } }),
      ]);
      const result = await service.evaluate('task.create', { ...ctx, data: { score: 10 } });
      expect(result.matchedPolicies).toHaveLength(1);
    });

    it('evaluates <= does not match when greater', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ conditionExpr: { field: 'score', op: '<=', value: 10 } }),
      ]);
      const result = await service.evaluate('task.create', { ...ctx, data: { score: 11 } });
      expect(result.matchedPolicies).toHaveLength(0);
    });

    it('evaluates == correctly (string comparison)', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ conditionExpr: { field: 'status', op: '==', value: 'draft' } }),
      ]);
      const result = await service.evaluate('task.create', { ...ctx, data: { status: 'draft' } });
      expect(result.matchedPolicies).toHaveLength(1);
    });

    it('evaluates == as false when values differ', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ conditionExpr: { field: 'status', op: '==', value: 'draft' } }),
      ]);
      const result = await service.evaluate('task.create', { ...ctx, data: { status: 'active' } });
      expect(result.matchedPolicies).toHaveLength(0);
    });

    it('evaluates != correctly', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ conditionExpr: { field: 'status', op: '!=', value: 'approved' } }),
      ]);
      const result = await service.evaluate('task.create', { ...ctx, data: { status: 'draft' } });
      expect(result.matchedPolicies).toHaveLength(1);
    });

    it('evaluates != as false when values are equal', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ conditionExpr: { field: 'status', op: '!=', value: 'approved' } }),
      ]);
      const result = await service.evaluate('task.create', { ...ctx, data: { status: 'approved' } });
      expect(result.matchedPolicies).toHaveLength(0);
    });

    it('evaluates in operator when value is in list', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ conditionExpr: { field: 'actor_role', op: 'in', value: ['admin', 'pmo'] } }),
      ]);
      const result = await service.evaluate('task.create', { ...ctx, actorRole: 'admin' });
      expect(result.matchedPolicies).toHaveLength(1);
    });

    it('evaluates in operator as false when not in list', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ conditionExpr: { field: 'actor_role', op: 'in', value: ['admin', 'pmo'] } }),
      ]);
      const result = await service.evaluate('task.create', { ...ctx, actorRole: 'team_member' });
      expect(result.matchedPolicies).toHaveLength(0);
    });

    it('evaluates not_in operator when value is not in list', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ conditionExpr: { field: 'actor_role', op: 'not_in', value: ['admin', 'pmo'] } }),
      ]);
      const result = await service.evaluate('task.create', { ...ctx, actorRole: 'team_member' });
      expect(result.matchedPolicies).toHaveLength(1);
    });

    it('evaluates not_in as false when value is in list', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ conditionExpr: { field: 'actor_role', op: 'not_in', value: ['admin', 'pmo'] } }),
      ]);
      const result = await service.evaluate('task.create', { ...ctx, actorRole: 'admin' });
      expect(result.matchedPolicies).toHaveLength(0);
    });

    it('evaluates contains operator', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ conditionExpr: { field: 'entity_type', op: 'contains', value: 'task' } }),
      ]);
      const result = await service.evaluate('task.create', { ...ctx, entityType: 'task_item' });
      expect(result.matchedPolicies).toHaveLength(1);
    });

    it('evaluates contains as false when substring not found', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ conditionExpr: { field: 'entity_type', op: 'contains', value: 'project' } }),
      ]);
      const result = await service.evaluate('task.create', { ...ctx, entityType: 'task_item' });
      expect(result.matchedPolicies).toHaveLength(0);
    });

    it('returns false when field is missing from data', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ conditionExpr: { field: 'missing_field', op: '==', value: 'x' } }),
      ]);
      const result = await service.evaluate('task.create', ctx);
      expect(result.matchedPolicies).toHaveLength(0);
    });

    it('returns true for empty field condition (always matches)', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ conditionExpr: { field: '', op: '==', value: '' } }),
      ]);
      const result = await service.evaluate('task.create', ctx);
      expect(result.matchedPolicies).toHaveLength(1);
    });

    it('uses actor_role from context for condition evaluation', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ conditionExpr: { field: 'actor_role', op: '==', value: 'admin' } }),
      ]);
      const result = await service.evaluate('task.create', { ...ctx, actorRole: 'admin' });
      expect(result.matchedPolicies).toHaveLength(1);
    });

    it('uses actor_id from context for condition evaluation', async () => {
      mockRepo.findActive.mockResolvedValueOnce([
        makePolicy({ conditionExpr: { field: 'actor_id', op: '==', value: 'u1' } }),
      ]);
      const result = await service.evaluate('task.create', ctx);
      expect(result.matchedPolicies).toHaveLength(1);
    });
  });

  // ── CRUD operations ──

  describe('getProjectPolicies', () => {
    it('returns policies from repository', async () => {
      const policies = [makePolicy()];
      mockRepo.findByProject.mockResolvedValueOnce(policies);
      const result = await service.getProjectPolicies('proj-1');
      expect(result).toEqual(policies);
      expect(mockRepo.findByProject).toHaveBeenCalledWith('proj-1');
    });

    it('returns empty array on repository error', async () => {
      mockRepo.findByProject.mockRejectedValueOnce(new Error('fail'));
      const result = await service.getProjectPolicies('proj-1');
      expect(result).toEqual([]);
    });
  });

  describe('getAllPolicies', () => {
    it('returns all policies', async () => {
      const policies = [makePolicy(), makePolicy({ id: 'pol-2' })];
      mockRepo.findAll.mockResolvedValueOnce(policies);
      const result = await service.getAllPolicies();
      expect(result).toEqual(policies);
    });

    it('returns empty array on error', async () => {
      mockRepo.findAll.mockRejectedValueOnce(new Error('fail'));
      const result = await service.getAllPolicies();
      expect(result).toEqual([]);
    });
  });

  describe('getPolicyById', () => {
    it('returns policy when found', async () => {
      const policy = makePolicy();
      mockRepo.findById.mockResolvedValueOnce(policy);
      const result = await service.getPolicyById('pol-1');
      expect(result).toEqual(policy);
    });

    it('returns null when not found', async () => {
      mockRepo.findById.mockResolvedValueOnce(null);
      const result = await service.getPolicyById('nonexistent');
      expect(result).toBeNull();
    });

    it('returns null on error', async () => {
      mockRepo.findById.mockRejectedValueOnce(new Error('fail'));
      const result = await service.getPolicyById('pol-1');
      expect(result).toBeNull();
    });
  });

  describe('createPolicy', () => {
    it('generates UUID and delegates to repository insert', async () => {
      const created = makePolicy();
      mockRepo.insert.mockResolvedValueOnce(created);
      const result = await service.createPolicy({
        name: 'Test Policy',
        actionPattern: 'task.create',
        conditionExpr: { field: 'budget', op: '>', value: 100 },
        enforcement: 'block',
        createdBy: 'admin',
      });
      expect(mockRepo.insert).toHaveBeenCalledWith(
        'generated-uuid', null, 'Test Policy', null,
        'task.create', { field: 'budget', op: '>', value: 100 },
        'block', 'admin',
      );
      expect(result).toEqual(created);
    });

    it('passes projectId when provided', async () => {
      mockRepo.insert.mockResolvedValueOnce(makePolicy({ projectId: 'proj-1' }));
      await service.createPolicy({
        projectId: 'proj-1',
        name: 'Scoped Policy',
        description: 'A description',
        actionPattern: '*',
        conditionExpr: { field: '', op: '==', value: '' },
        enforcement: 'require_approval',
        createdBy: 'admin',
      });
      expect(mockRepo.insert).toHaveBeenCalledWith(
        'generated-uuid', 'proj-1', 'Scoped Policy', 'A description',
        '*', { field: '', op: '==', value: '' },
        'require_approval', 'admin',
      );
    });

    it('treats null projectId same as undefined', async () => {
      mockRepo.insert.mockResolvedValueOnce(makePolicy());
      await service.createPolicy({
        projectId: null,
        name: 'Global Policy',
        actionPattern: '*',
        conditionExpr: { field: '', op: '==', value: '' },
        enforcement: 'log_only',
        createdBy: 'admin',
      });
      expect(mockRepo.insert).toHaveBeenCalledWith(
        'generated-uuid', null, 'Global Policy', null,
        '*', expect.any(Object), 'log_only', 'admin',
      );
    });
  });

  describe('updatePolicy', () => {
    it('builds SET clauses for provided fields', async () => {
      const updated = makePolicy({ name: 'Updated' });
      mockRepo.findById.mockResolvedValueOnce(updated);
      await service.updatePolicy('pol-1', {
        name: 'Updated',
        enforcement: 'require_approval',
        isActive: false,
      });
      expect(mockRepo.updateFields).toHaveBeenCalledWith(
        'pol-1',
        ['name = ?', 'enforcement = ?', 'is_active = ?'],
        ['Updated', 'require_approval', 0],
      );
    });

    it('serializes conditionExpr as JSON', async () => {
      mockRepo.findById.mockResolvedValueOnce(makePolicy());
      await service.updatePolicy('pol-1', {
        conditionExpr: { field: 'x', op: '==', value: 'y' },
      });
      expect(mockRepo.updateFields).toHaveBeenCalledWith(
        'pol-1',
        ['condition_expr = ?'],
        [JSON.stringify({ field: 'x', op: '==', value: 'y' })],
      );
    });

    it('returns current policy without updating when no fields given', async () => {
      const existing = makePolicy();
      mockRepo.findById.mockResolvedValueOnce(existing);
      const result = await service.updatePolicy('pol-1', {});
      expect(mockRepo.updateFields).not.toHaveBeenCalled();
      expect(result).toEqual(existing);
    });

    it('converts isActive true to 1', async () => {
      mockRepo.findById.mockResolvedValueOnce(makePolicy());
      await service.updatePolicy('pol-1', { isActive: true });
      expect(mockRepo.updateFields).toHaveBeenCalledWith(
        'pol-1',
        ['is_active = ?'],
        [1],
      );
    });

    it('converts isActive false to 0', async () => {
      mockRepo.findById.mockResolvedValueOnce(makePolicy());
      await service.updatePolicy('pol-1', { isActive: false });
      expect(mockRepo.updateFields).toHaveBeenCalledWith(
        'pol-1',
        ['is_active = ?'],
        [0],
      );
    });

    it('updates description field', async () => {
      mockRepo.findById.mockResolvedValueOnce(makePolicy());
      await service.updatePolicy('pol-1', { description: 'New description' });
      expect(mockRepo.updateFields).toHaveBeenCalledWith(
        'pol-1',
        ['description = ?'],
        ['New description'],
      );
    });

    it('updates actionPattern field', async () => {
      mockRepo.findById.mockResolvedValueOnce(makePolicy());
      await service.updatePolicy('pol-1', { actionPattern: 'project.*' });
      expect(mockRepo.updateFields).toHaveBeenCalledWith(
        'pol-1',
        ['action_pattern = ?'],
        ['project.*'],
      );
    });
  });

  describe('deletePolicy', () => {
    it('returns true when repository deletes successfully', async () => {
      mockRepo.deleteById.mockResolvedValueOnce(true);
      const result = await service.deletePolicy('pol-1');
      expect(result).toBe(true);
      expect(mockRepo.deleteById).toHaveBeenCalledWith('pol-1');
    });

    it('returns false when policy not found', async () => {
      mockRepo.deleteById.mockResolvedValueOnce(false);
      const result = await service.deletePolicy('nonexistent');
      expect(result).toBe(false);
    });
  });

  // ── Evaluation stats ──

  describe('getEvaluationStats', () => {
    it('returns stats from repository', async () => {
      const stats = { total: 50, allowed: 30, blocked: 15, pendingApproval: 5 };
      mockRepo.getEvaluationStats.mockResolvedValueOnce(stats);
      const result = await service.getEvaluationStats('proj-1', '2026-01-01');
      expect(result).toEqual(stats);
      expect(mockRepo.getEvaluationStats).toHaveBeenCalledWith('proj-1', '2026-01-01');
    });

    it('returns zeroed stats on error', async () => {
      mockRepo.getEvaluationStats.mockRejectedValueOnce(new Error('fail'));
      const result = await service.getEvaluationStats();
      expect(result).toEqual({ total: 0, allowed: 0, blocked: 0, pendingApproval: 0 });
    });

    it('calls without arguments when no filters provided', async () => {
      mockRepo.getEvaluationStats.mockResolvedValueOnce({ total: 10, allowed: 10, blocked: 0, pendingApproval: 0 });
      await service.getEvaluationStats();
      expect(mockRepo.getEvaluationStats).toHaveBeenCalledWith(undefined, undefined);
    });

    it('passes only projectId when since is omitted', async () => {
      mockRepo.getEvaluationStats.mockResolvedValueOnce({ total: 5, allowed: 5, blocked: 0, pendingApproval: 0 });
      await service.getEvaluationStats('proj-1');
      expect(mockRepo.getEvaluationStats).toHaveBeenCalledWith('proj-1', undefined);
    });
  });
});
