import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before imports
vi.mock('../../database/RiskRepository', () => {
  const mockRepo = {
    findByProject: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    getStats: vi.fn().mockResolvedValue({ totalRisks: 0, totalIssues: 0, totalActions: 0 }),
    create: vi.fn(),
    update: vi.fn(),
    createActivityLog: vi.fn().mockResolvedValue({}),
    getActivityLog: vi.fn().mockResolvedValue([]),
    findByAgentSource: vi.fn().mockResolvedValue([]),
    createUpdate: vi.fn(),
    findUpdateById: vi.fn().mockResolvedValue(null),
    editUpdate: vi.fn(),
    deleteUpdate: vi.fn().mockResolvedValue(undefined),
    getUpdates: vi.fn().mockResolvedValue([]),
  };
  return { riskRepository: mockRepo };
});

vi.mock('../../services/NotificationService', () => ({
  notificationService: { create: vi.fn().mockResolvedValue({}) },
}));

vi.mock('../../database/ProjectMemberRepository', () => ({
  projectMemberRepository: { findByProjectId: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { riskService } from '../../services/RiskService';
import { riskRepository } from '../../database/RiskRepository';
import { notificationService } from '../../services/NotificationService';
import { projectMemberRepository } from '../../database/ProjectMemberRepository';

const mockRepo = riskRepository as any;
const mockNotification = notificationService as any;
const mockMembers = projectMemberRepository as any;

// ---------- Fixtures ----------

const sampleRisk = (): any => ({
  id: 'r1',
  projectId: 'p1',
  type: 'risk',
  title: 'Budget Overrun',
  description: 'Costs may exceed budget',
  category: 'budget',
  severity: 'high',
  probability: 4,
  impact: 5,
  riskScore: 20,
  status: 'open',
  triggerCondition: null,
  triggered: false,
  triggeredAt: null,
  mitigationPlan: null,
  responsePlan: null,
  ownerId: 'u2',
  source: 'manual',
  sourceAgentId: null,
  aiConfidence: null,
  linkedTaskIds: null,
  linkedProposalId: null,
  createdBy: 'u1',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  resolvedAt: null,
  sequenceNumber: 1,
  recordId: 'R-001',
  dueDate: null,
  actionType: null,
  rationale: null,
  decidedBy: null,
  decisionDate: null,
  alternativesConsidered: null,
  stakeholdersConsulted: null,
  cancelReason: null,
  linkedRaidIds: null,
  rootCause: null,
  impactAssessment: null,
  workaround: null,
  validationPlan: null,
  dependentEntity: null,
  forum: null,
  sourceMeeting: null,
  ownerName: null,
});

const sampleDecision = (): any => ({
  ...sampleRisk(),
  id: 'd1',
  type: 'decision',
  title: 'Go with vendor A',
  status: 'decided',
  recordId: 'D-001',
});

const sampleUpdate = (): any => ({
  id: 'upd1',
  raidItemId: 'r1',
  projectId: 'p1',
  userId: 'u1',
  text: 'Investigation ongoing',
  createdAt: '2026-01-02',
  updatedAt: '2026-01-02',
});

const pmMember = { userId: 'pm1', role: 'manager' };
const ownerMember = { userId: 'owner1', role: 'owner' };

// ---------- Tests ----------

describe('RiskService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===================== findByProject =====================
  describe('findByProject', () => {
    it('delegates to repository with no filters', async () => {
      const risks = [sampleRisk()];
      mockRepo.findByProject.mockResolvedValueOnce(risks);

      const result = await riskService.findByProject('p1');
      expect(result).toEqual(risks);
      expect(mockRepo.findByProject).toHaveBeenCalledWith('p1', {});
    });

    it('passes filters through to repository', async () => {
      mockRepo.findByProject.mockResolvedValueOnce([]);
      await riskService.findByProject('p1', { type: 'issue', severity: 'critical' });
      expect(mockRepo.findByProject).toHaveBeenCalledWith('p1', { type: 'issue', severity: 'critical' });
    });
  });

  // ===================== findById =====================
  describe('findById', () => {
    it('returns risk when found', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleRisk());
      const result = await riskService.findById('r1');
      expect(result).not.toBeNull();
      expect(result!.title).toBe('Budget Overrun');
    });

    it('returns null when not found', async () => {
      mockRepo.findById.mockResolvedValueOnce(null);
      const result = await riskService.findById('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ===================== getStats =====================
  describe('getStats', () => {
    it('delegates to repository', async () => {
      const stats = { totalRisks: 5, totalIssues: 2, totalActions: 1 };
      mockRepo.getStats.mockResolvedValueOnce(stats);
      const result = await riskService.getStats('p1');
      expect(result).toEqual(stats);
      expect(mockRepo.getStats).toHaveBeenCalledWith('p1');
    });
  });

  // ===================== create =====================
  describe('create', () => {
    it('creates a risk and returns it', async () => {
      const created = sampleRisk();
      mockRepo.create.mockResolvedValueOnce(created);

      const result = await riskService.create({
        projectId: 'p1',
        type: 'risk',
        title: 'Budget Overrun',
        createdBy: 'u1',
      });

      expect(result.id).toBe('r1');
      expect(mockRepo.create).toHaveBeenCalledOnce();
    });

    it('auto-sets status to proposed for non-PM roles when no status provided', async () => {
      const created = { ...sampleRisk(), status: 'proposed' };
      mockRepo.create.mockResolvedValueOnce(created);

      await riskService.create(
        { projectId: 'p1', type: 'risk', title: 'Test', createdBy: 'u1' },
        'developer',
      );

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'proposed' }),
      );
    });

    it('does not override explicit status for non-PM roles', async () => {
      const created = { ...sampleRisk(), status: 'open' };
      mockRepo.create.mockResolvedValueOnce(created);

      await riskService.create(
        { projectId: 'p1', type: 'risk', title: 'Test', status: 'open', createdBy: 'u1' },
        'developer',
      );

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'open' }),
      );
    });

    it('skips triage for PM roles (admin, project_manager, scrum_master, risk_manager, pmo)', async () => {
      for (const role of ['admin', 'project_manager', 'scrum_master', 'risk_manager', 'pmo']) {
        vi.clearAllMocks();
        mockRepo.create.mockResolvedValueOnce(sampleRisk());

        await riskService.create(
          { projectId: 'p1', type: 'risk', title: 'Test', createdBy: 'u1' },
          role,
        );

        // status should NOT be set to 'proposed'
        const createArg = mockRepo.create.mock.calls[0][0];
        expect(createArg.status).toBeUndefined();
      }
    });

    it('throws on invalid status for given type', async () => {
      await expect(
        riskService.create({
          projectId: 'p1',
          type: 'risk',
          title: 'Test',
          status: 'decided', // not valid for risk type
          createdBy: 'u1',
        }),
      ).rejects.toThrow("Invalid status 'decided' for type 'risk'");
    });

    it('accepts valid statuses for each RAID type', async () => {
      const validCombos: [string, string][] = [
        ['risk', 'mitigating'],
        ['issue', 'in_progress'],
        ['action', 'deferred'],
        ['decision', 'pending_decision'],
        ['assumption', 'validated'],
        ['dependency', 'at_risk'],
      ];

      for (const [type, status] of validCombos) {
        vi.clearAllMocks();
        mockRepo.create.mockResolvedValueOnce({ ...sampleRisk(), type, status });

        await expect(
          riskService.create({
            projectId: 'p1',
            type: type as any,
            title: 'Test',
            status,
            createdBy: 'u1',
          }),
        ).resolves.toBeDefined();
      }
    });

    it('logs activity after creation (fire-and-forget)', async () => {
      mockRepo.create.mockResolvedValueOnce(sampleRisk());
      mockRepo.createActivityLog.mockResolvedValueOnce({});

      await riskService.create({
        projectId: 'p1',
        type: 'risk',
        title: 'Budget Overrun',
        createdBy: 'u1',
      });

      expect(mockRepo.createActivityLog).toHaveBeenCalledWith(
        expect.objectContaining({
          raidItemId: 'r1',
          actionType: 'created',
        }),
      );
    });

    it('notifies project managers on creation', async () => {
      mockRepo.create.mockResolvedValueOnce(sampleRisk());
      mockMembers.findByProjectId.mockResolvedValueOnce([pmMember, ownerMember]);

      await riskService.create({
        projectId: 'p1',
        type: 'risk',
        title: 'Budget Overrun',
        createdBy: 'u1',
      });

      expect(mockNotification.create).toHaveBeenCalledTimes(2); // pm1 + owner1
      expect(mockNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'pm1',
          type: 'raid_item',
        }),
      );
    });

    it('notifies assigned owner when different from creator', async () => {
      const risk = { ...sampleRisk(), ownerId: 'u2' };
      mockRepo.create.mockResolvedValueOnce(risk);
      mockMembers.findByProjectId.mockResolvedValueOnce([]);

      await riskService.create({
        projectId: 'p1',
        type: 'risk',
        title: 'Budget Overrun',
        ownerId: 'u2',
        createdBy: 'u1',
      });

      expect(mockNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u2',
          title: expect.stringContaining('assigned to you'),
        }),
      );
    });

    it('does not notify owner when owner is the creator', async () => {
      const risk = { ...sampleRisk(), ownerId: 'u1' };
      mockRepo.create.mockResolvedValueOnce(risk);
      mockMembers.findByProjectId.mockResolvedValueOnce([]);

      await riskService.create({
        projectId: 'p1',
        type: 'risk',
        title: 'Test',
        ownerId: 'u1',
        createdBy: 'u1',
      });

      // No assignment notification (PM notification may still fire but members list is empty)
      expect(mockNotification.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringContaining('assigned to you') }),
      );
    });

    it('sets triage notification title when status is proposed', async () => {
      const risk = { ...sampleRisk(), status: 'proposed' };
      mockRepo.create.mockResolvedValueOnce(risk);
      mockMembers.findByProjectId.mockResolvedValueOnce([pmMember]);

      await riskService.create(
        { projectId: 'p1', type: 'risk', title: 'Test', createdBy: 'u1' },
        'developer',
      );

      expect(mockNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('requires triage'),
        }),
      );
    });

    it('sets critical severity on notification when risk severity is critical', async () => {
      const risk = { ...sampleRisk(), severity: 'critical' };
      mockRepo.create.mockResolvedValueOnce(risk);
      mockMembers.findByProjectId.mockResolvedValueOnce([pmMember]);

      await riskService.create({
        projectId: 'p1',
        type: 'risk',
        title: 'Test',
        severity: 'critical',
        createdBy: 'u1',
      });

      expect(mockNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'critical' }),
      );
    });

    it('handles notification failure gracefully', async () => {
      mockRepo.create.mockResolvedValueOnce(sampleRisk());
      mockMembers.findByProjectId.mockRejectedValueOnce(new Error('DB down'));

      // Should not throw
      const result = await riskService.create({
        projectId: 'p1',
        type: 'risk',
        title: 'Test',
        createdBy: 'u1',
      });

      expect(result.id).toBe('r1');
    });
  });

  // ===================== update =====================
  describe('update', () => {
    it('returns null when risk not found', async () => {
      mockRepo.findById.mockResolvedValueOnce(null);
      const result = await riskService.update('nonexistent', { title: 'New' });
      expect(result).toBeNull();
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it('updates and returns the risk', async () => {
      const existing = sampleRisk();
      const updated = { ...existing, title: 'Updated Title' };
      mockRepo.findById.mockResolvedValueOnce(existing);
      mockRepo.update.mockResolvedValueOnce(updated);

      const result = await riskService.update('r1', { title: 'Updated Title' });
      expect(result!.title).toBe('Updated Title');
      expect(mockRepo.update).toHaveBeenCalledWith('r1', { title: 'Updated Title' });
    });

    it('throws on invalid status for existing type', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleRisk()); // type=risk

      await expect(
        riskService.update('r1', { status: 'decided' }),
      ).rejects.toThrow("Invalid status 'decided' for type 'risk'");
    });

    it('auto-sets resolvedAt when entering terminal status', async () => {
      const existing = sampleRisk(); // status=open, resolvedAt=null
      mockRepo.findById.mockResolvedValueOnce(existing);
      mockRepo.update.mockResolvedValueOnce({ ...existing, status: 'closed' });

      await riskService.update('r1', { status: 'closed' });

      expect(mockRepo.update).toHaveBeenCalledWith(
        'r1',
        expect.objectContaining({
          status: 'closed',
          resolvedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
        }),
      );
    });

    it('does not overwrite existing resolvedAt when already terminal', async () => {
      const existing = { ...sampleRisk(), status: 'closed', resolvedAt: '2026-01-05 10:00:00' };
      mockRepo.findById.mockResolvedValueOnce(existing);
      mockRepo.update.mockResolvedValueOnce({ ...existing, status: 'cancelled' });

      await riskService.update('r1', { status: 'cancelled' });

      // resolvedAt should NOT be set again since existing already has one
      const updateArg = mockRepo.update.mock.calls[0][1];
      expect(updateArg.resolvedAt).toBeUndefined();
    });

    it('clears resolvedAt when reopening from terminal status', async () => {
      const existing = { ...sampleRisk(), status: 'closed', resolvedAt: '2026-01-05 10:00:00' };
      mockRepo.findById.mockResolvedValueOnce(existing);
      mockRepo.update.mockResolvedValueOnce({ ...existing, status: 'open', resolvedAt: null });

      await riskService.update('r1', { status: 'open' });

      expect(mockRepo.update).toHaveBeenCalledWith(
        'r1',
        expect.objectContaining({ status: 'open', resolvedAt: null }),
      );
    });

    it('logs activity for each changed field', async () => {
      const existing = sampleRisk();
      mockRepo.findById.mockResolvedValueOnce(existing);
      mockRepo.update.mockResolvedValueOnce({ ...existing, severity: 'critical', title: 'New' });

      await riskService.update('r1', { severity: 'critical', title: 'New' }, 'u1');

      // Two field changes: severity + title
      expect(mockRepo.createActivityLog).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'field_update', fieldName: 'severity' }),
      );
      expect(mockRepo.createActivityLog).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'field_update', fieldName: 'title' }),
      );
    });

    it('logs status_change action type for status field', async () => {
      const existing = sampleRisk();
      mockRepo.findById.mockResolvedValueOnce(existing);
      mockRepo.update.mockResolvedValueOnce({ ...existing, status: 'monitoring' });

      await riskService.update('r1', { status: 'monitoring' }, 'u1');

      expect(mockRepo.createActivityLog).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'status_change', fieldName: 'status' }),
      );
    });

    it('does not log activity when no userId provided', async () => {
      const existing = sampleRisk();
      mockRepo.findById.mockResolvedValueOnce(existing);
      mockRepo.update.mockResolvedValueOnce({ ...existing, title: 'New' });

      await riskService.update('r1', { title: 'New' });

      expect(mockRepo.createActivityLog).not.toHaveBeenCalled();
    });

    it('notifies on owner reassignment', async () => {
      const existing = { ...sampleRisk(), ownerId: 'u2' };
      mockRepo.findById.mockResolvedValueOnce(existing);
      mockRepo.update.mockResolvedValueOnce({ ...existing, ownerId: 'u3' });

      await riskService.update('r1', { ownerId: 'u3' }, 'u1');

      expect(mockNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u3',
          title: expect.stringContaining('assigned to you'),
        }),
      );
    });

    it('does not notify owner reassignment when changer is the new owner', async () => {
      const existing = { ...sampleRisk(), ownerId: 'u2' };
      mockRepo.findById.mockResolvedValueOnce(existing);
      mockRepo.update.mockResolvedValueOnce({ ...existing, ownerId: 'u1' });

      await riskService.update('r1', { ownerId: 'u1' }, 'u1');

      expect(mockNotification.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringContaining('assigned to you') }),
      );
    });

    it('notifies owner and PMs on status change (excluding changer)', async () => {
      const existing = { ...sampleRisk(), ownerId: 'u2' };
      mockRepo.findById.mockResolvedValueOnce(existing);
      mockRepo.update.mockResolvedValueOnce({ ...existing, status: 'monitoring' });
      mockMembers.findByProjectId.mockResolvedValueOnce([
        { userId: 'pm1', role: 'manager' },
        { userId: 'u1', role: 'owner' }, // changer — should be excluded
      ]);

      await riskService.update('r1', { status: 'monitoring' }, 'u1');

      // Should notify u2 (owner) and pm1, but not u1 (changer)
      const notifyCalls = mockNotification.create.mock.calls;
      const notifiedUserIds = notifyCalls.map((c: any) => c[0].userId);
      expect(notifiedUserIds).toContain('u2');
      expect(notifiedUserIds).toContain('pm1');
      expect(notifiedUserIds).not.toContain('u1');
    });

    it('sets high severity notification on status cancelled/reversed', async () => {
      const existing = sampleRisk();
      mockRepo.findById.mockResolvedValueOnce(existing);
      mockRepo.update.mockResolvedValueOnce({ ...existing, status: 'cancelled' });
      mockMembers.findByProjectId.mockResolvedValueOnce([pmMember]);

      await riskService.update('r1', { status: 'cancelled' }, 'u1');

      expect(mockNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'high' }),
      );
    });

    it('notifies PMs on severity escalation to critical', async () => {
      const existing = { ...sampleRisk(), severity: 'medium' };
      mockRepo.findById.mockResolvedValueOnce(existing);
      mockRepo.update.mockResolvedValueOnce({ ...existing, severity: 'critical' });
      mockMembers.findByProjectId.mockResolvedValueOnce([pmMember]);

      await riskService.update('r1', { severity: 'critical' }, 'u1');

      expect(mockNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'pm1',
          title: expect.stringContaining('escalated to critical'),
          severity: 'critical',
        }),
      );
    });

    it('does not notify on severity change that is not to critical/high', async () => {
      const existing = { ...sampleRisk(), severity: 'high' };
      mockRepo.findById.mockResolvedValueOnce(existing);
      mockRepo.update.mockResolvedValueOnce({ ...existing, severity: 'medium' });
      mockMembers.findByProjectId.mockResolvedValueOnce([pmMember]);

      await riskService.update('r1', { severity: 'medium' }, 'u1');

      expect(mockNotification.create).not.toHaveBeenCalled();
    });

    it('does not send duplicate severity notification when status also changed', async () => {
      // When status changes, notifyOnUpdate returns early after status notifications
      // so severity escalation notification is skipped (no duplicates)
      const existing = { ...sampleRisk(), severity: 'medium' };
      mockRepo.findById.mockResolvedValueOnce(existing);
      mockRepo.update.mockResolvedValueOnce({ ...existing, status: 'monitoring', severity: 'critical' });
      mockMembers.findByProjectId.mockResolvedValueOnce([pmMember]);

      await riskService.update('r1', { status: 'monitoring', severity: 'critical' }, 'u1');

      // Should only get status change notifications, not severity escalation duplicates
      const titles = mockNotification.create.mock.calls.map((c: any) => c[0].title);
      expect(titles.every((t: string) => t.includes('status'))).toBe(true);
    });

    it('handles notification failure gracefully during update', async () => {
      const existing = sampleRisk();
      mockRepo.findById.mockResolvedValueOnce(existing);
      mockRepo.update.mockResolvedValueOnce({ ...existing, status: 'monitoring' });
      mockMembers.findByProjectId.mockRejectedValueOnce(new Error('Network error'));

      const result = await riskService.update('r1', { status: 'monitoring' }, 'u1');
      expect(result).not.toBeNull();
    });
  });

  // ===================== cancel =====================
  describe('cancel', () => {
    it('returns null when risk not found', async () => {
      mockRepo.findById.mockResolvedValueOnce(null);
      const result = await riskService.cancel('nonexistent', 'No longer relevant', 'u1');
      expect(result).toBeNull();
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it('returns existing risk without updating when already cancelled', async () => {
      const existing = { ...sampleRisk(), status: 'cancelled' };
      mockRepo.findById.mockResolvedValueOnce(existing);

      const result = await riskService.cancel('r1', 'Duplicate', 'u1');
      expect(result).toEqual(existing);
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it('cancels the risk with reason and sets resolvedAt', async () => {
      const existing = sampleRisk();
      const cancelled = { ...existing, status: 'cancelled', cancelReason: 'Duplicate' };
      mockRepo.findById.mockResolvedValueOnce(existing);
      mockRepo.update.mockResolvedValueOnce(cancelled);

      const result = await riskService.cancel('r1', 'Duplicate', 'u1');

      expect(result!.status).toBe('cancelled');
      expect(mockRepo.update).toHaveBeenCalledWith(
        'r1',
        expect.objectContaining({
          status: 'cancelled',
          cancelReason: 'Duplicate',
          resolvedAt: expect.any(String),
        }),
      );
    });

    it('logs cancellation activity', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleRisk());
      mockRepo.update.mockResolvedValueOnce({ ...sampleRisk(), status: 'cancelled' });

      await riskService.cancel('r1', 'No longer needed', 'u1');

      expect(mockRepo.createActivityLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'cancelled',
          oldValue: 'open',
          newValue: 'cancelled',
          comment: 'No longer needed',
        }),
      );
    });
  });

  // ===================== reverse =====================
  describe('reverse', () => {
    it('returns null when risk not found', async () => {
      mockRepo.findById.mockResolvedValueOnce(null);
      const result = await riskService.reverse('nonexistent', 'New info', 'u1');
      expect(result).toBeNull();
    });

    it('throws when type is not decision', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleRisk()); // type=risk

      await expect(
        riskService.reverse('r1', 'Changed mind', 'u1'),
      ).rejects.toThrow('Only decisions can be reversed');
    });

    it('reverses a decision successfully', async () => {
      const decision = sampleDecision();
      const reversed = { ...decision, status: 'reversed', cancelReason: 'New info' };
      mockRepo.findById.mockResolvedValueOnce(decision);
      mockRepo.update.mockResolvedValueOnce(reversed);

      const result = await riskService.reverse('d1', 'New info', 'u1');

      expect(result!.status).toBe('reversed');
      expect(mockRepo.update).toHaveBeenCalledWith(
        'd1',
        expect.objectContaining({
          status: 'reversed',
          cancelReason: 'New info',
          resolvedAt: expect.any(String),
        }),
      );
    });

    it('logs reversal activity', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleDecision());
      mockRepo.update.mockResolvedValueOnce({ ...sampleDecision(), status: 'reversed' });

      await riskService.reverse('d1', 'Strategy pivot', 'u1');

      expect(mockRepo.createActivityLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'reversed',
          oldValue: 'decided',
          newValue: 'reversed',
          comment: 'Strategy pivot',
        }),
      );
    });
  });

  // ===================== addComment =====================
  describe('addComment', () => {
    it('creates an activity log entry with comment', async () => {
      await riskService.addComment('r1', 'p1', 'u1', 'Investigating');

      expect(mockRepo.createActivityLog).toHaveBeenCalledWith({
        raidItemId: 'r1',
        projectId: 'p1',
        userId: 'u1',
        actionType: 'comment',
        comment: 'Investigating',
      });
    });
  });

  // ===================== getActivity =====================
  describe('getActivity', () => {
    it('delegates to repository', async () => {
      const logs = [{ id: 'log1', actionType: 'created' }];
      mockRepo.getActivityLog.mockResolvedValueOnce(logs);

      const result = await riskService.getActivity('r1');
      expect(result).toEqual(logs);
      expect(mockRepo.getActivityLog).toHaveBeenCalledWith('r1');
    });
  });

  // ===================== addUpdate =====================
  describe('addUpdate', () => {
    it('creates update and logs activity', async () => {
      const update = sampleUpdate();
      mockRepo.createUpdate.mockResolvedValueOnce(update);
      mockRepo.findById.mockResolvedValueOnce(sampleRisk());

      const result = await riskService.addUpdate('r1', 'p1', 'u1', 'Investigation ongoing');

      expect(result).toEqual(update);
      expect(mockRepo.createUpdate).toHaveBeenCalledWith({
        raidItemId: 'r1',
        projectId: 'p1',
        userId: 'u1',
        text: 'Investigation ongoing',
      });
      expect(mockRepo.createActivityLog).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'update_added' }),
      );
    });

    it('notifies owner and PMs when update is posted', async () => {
      const risk = { ...sampleRisk(), ownerId: 'u2' };
      mockRepo.createUpdate.mockResolvedValueOnce(sampleUpdate());
      mockRepo.findById.mockResolvedValueOnce(risk);
      mockMembers.findByProjectId.mockResolvedValueOnce([pmMember]);

      await riskService.addUpdate('r1', 'p1', 'u1', 'Status update');

      // Should notify u2 (owner) and pm1
      const notifiedUserIds = mockNotification.create.mock.calls.map((c: any) => c[0].userId);
      expect(notifiedUserIds).toContain('u2');
      expect(notifiedUserIds).toContain('pm1');
    });

    it('does not notify poster when poster is the owner', async () => {
      const risk = { ...sampleRisk(), ownerId: 'u1' }; // poster is owner
      mockRepo.createUpdate.mockResolvedValueOnce(sampleUpdate());
      mockRepo.findById.mockResolvedValueOnce(risk);
      mockMembers.findByProjectId.mockResolvedValueOnce([]);

      await riskService.addUpdate('r1', 'p1', 'u1', 'My update');

      expect(mockNotification.create).not.toHaveBeenCalled();
    });

    it('truncates long update text in notification preview', async () => {
      const longText = 'A'.repeat(100);
      const risk = { ...sampleRisk(), ownerId: 'u2' };
      mockRepo.createUpdate.mockResolvedValueOnce({ ...sampleUpdate(), text: longText });
      mockRepo.findById.mockResolvedValueOnce(risk);
      mockMembers.findByProjectId.mockResolvedValueOnce([]);

      await riskService.addUpdate('r1', 'p1', 'u1', longText);

      const msg = mockNotification.create.mock.calls[0][0].message;
      expect(msg).toContain('...');
      // The preview should be 80 chars + '...'
      expect(msg).toContain('A'.repeat(80) + '...');
    });
  });

  // ===================== editUpdate =====================
  describe('editUpdate', () => {
    it('throws when update not found', async () => {
      mockRepo.findUpdateById.mockResolvedValueOnce(null);
      await expect(
        riskService.editUpdate('nonexistent', 'u1', 'new text'),
      ).rejects.toThrow('Update not found');
    });

    it('throws when user is not the author', async () => {
      mockRepo.findUpdateById.mockResolvedValueOnce({ ...sampleUpdate(), userId: 'u2' });
      await expect(
        riskService.editUpdate('upd1', 'u1', 'new text'),
      ).rejects.toThrow('You can only edit your own updates');
    });

    it('edits update when user is the author', async () => {
      const update = sampleUpdate();
      const edited = { ...update, text: 'Edited text' };
      mockRepo.findUpdateById.mockResolvedValueOnce(update);
      mockRepo.editUpdate.mockResolvedValueOnce(edited);

      const result = await riskService.editUpdate('upd1', 'u1', 'Edited text');
      expect(result.text).toBe('Edited text');
      expect(mockRepo.editUpdate).toHaveBeenCalledWith('upd1', 'Edited text');
    });
  });

  // ===================== deleteUpdate =====================
  describe('deleteUpdate', () => {
    it('throws when update not found', async () => {
      mockRepo.findUpdateById.mockResolvedValueOnce(null);
      await expect(
        riskService.deleteUpdate('nonexistent', 'u1'),
      ).rejects.toThrow('Update not found');
    });

    it('throws when user is not the author', async () => {
      mockRepo.findUpdateById.mockResolvedValueOnce({ ...sampleUpdate(), userId: 'u2' });
      await expect(
        riskService.deleteUpdate('upd1', 'u1'),
      ).rejects.toThrow('You can only delete your own updates');
    });

    it('deletes update and logs activity', async () => {
      mockRepo.findUpdateById.mockResolvedValueOnce(sampleUpdate());

      await riskService.deleteUpdate('upd1', 'u1');

      expect(mockRepo.deleteUpdate).toHaveBeenCalledWith('upd1');
      expect(mockRepo.createActivityLog).toHaveBeenCalledWith(
        expect.objectContaining({
          raidItemId: 'r1',
          actionType: 'update_deleted',
        }),
      );
    });
  });

  // ===================== getUpdates =====================
  describe('getUpdates', () => {
    it('delegates to repository', async () => {
      const updates = [sampleUpdate()];
      mockRepo.getUpdates.mockResolvedValueOnce(updates);

      const result = await riskService.getUpdates('r1');
      expect(result).toEqual(updates);
      expect(mockRepo.getUpdates).toHaveBeenCalledWith('r1');
    });
  });

  // ===================== checkDuplicates =====================
  describe('checkDuplicates', () => {
    it('returns empty map when no matches', async () => {
      mockRepo.findByProject.mockResolvedValueOnce([]);
      const result = await riskService.checkDuplicates('p1', [{ title: 'New Risk' }]);
      expect(result.size).toBe(0);
    });

    it('finds duplicates by case-insensitive title match', async () => {
      const existing = { ...sampleRisk(), title: 'Budget Overrun', severity: 'high', status: 'open' };
      mockRepo.findByProject.mockResolvedValueOnce([existing]);

      const result = await riskService.checkDuplicates('p1', [
        { title: '  BUDGET OVERRUN  ' }, // different case and whitespace
      ]);

      expect(result.size).toBe(1);
      const match = result.get('budget overrun');
      expect(match).toBeDefined();
      expect(match!.existingId).toBe('R-001'); // uses recordId
      expect(match!.currentSeverity).toBe('high');
    });

    it('uses source filter when provided', async () => {
      mockRepo.findByProject.mockResolvedValueOnce([]);
      await riskService.checkDuplicates('p1', [{ title: 'Test' }], 'ai_detected');
      expect(mockRepo.findByProject).toHaveBeenCalledWith('p1', { source: 'ai_detected' });
    });

    it('defaults severity to medium when not set', async () => {
      const existing = { ...sampleRisk(), title: 'No Severity', severity: undefined, status: 'open' };
      mockRepo.findByProject.mockResolvedValueOnce([existing]);

      const result = await riskService.checkDuplicates('p1', [{ title: 'No Severity' }]);
      const match = result.get('no severity');
      expect(match!.currentSeverity).toBe('medium');
    });
  });

  // ===================== importFromAIScan =====================
  describe('importFromAIScan', () => {
    it('imports new risks', async () => {
      mockRepo.findByProject.mockResolvedValueOnce([]); // no existing
      mockRepo.create.mockResolvedValue(sampleRisk());

      const result = await riskService.importFromAIScan('p1', [
        { title: 'New Risk', description: 'desc', severity: 'high' },
      ], 'u1');

      expect(result.imported).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.skipped).toBe(0);
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'ai_detected',
          type: 'risk',
        }),
      );
    });

    it('updates existing risk when severity changed', async () => {
      const existing = { ...sampleRisk(), title: 'Existing Risk', severity: 'medium', source: 'ai_detected' };
      mockRepo.findByProject.mockResolvedValueOnce([existing]);
      mockRepo.update.mockResolvedValueOnce({ ...existing, severity: 'high' });

      const result = await riskService.importFromAIScan('p1', [
        { title: 'Existing Risk', description: 'desc', severity: 'high' },
      ], 'u1');

      expect(result.imported).toBe(0);
      expect(result.updated).toBe(1);
      expect(result.skipped).toBe(0);
      expect(mockRepo.update).toHaveBeenCalledWith(existing.id, { severity: 'high' });
    });

    it('skips existing risk when no fields changed', async () => {
      const existing = {
        ...sampleRisk(),
        title: 'Same Risk',
        severity: 'high',
        probability: 4,
        impact: 5,
        source: 'ai_detected',
      };
      mockRepo.findByProject.mockResolvedValueOnce([existing]);

      const result = await riskService.importFromAIScan('p1', [
        { title: 'Same Risk', description: 'desc', severity: 'high', probability: 4, impact: 5 },
      ], 'u1');

      expect(result.imported).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it('handles mixed import/update/skip', async () => {
      const existing = { ...sampleRisk(), title: 'Exists', severity: 'low', source: 'ai_detected' };
      const existingSame = { ...sampleRisk(), id: 'r2', title: 'Same', severity: 'high', probability: 3, impact: 3, source: 'ai_detected' };
      mockRepo.findByProject.mockResolvedValueOnce([existing, existingSame]);
      mockRepo.update.mockResolvedValueOnce({ ...existing, severity: 'critical' });
      mockRepo.create.mockResolvedValueOnce(sampleRisk());

      const result = await riskService.importFromAIScan('p1', [
        { title: 'Exists', description: 'd', severity: 'critical' },       // update
        { title: 'Same', description: 'd', severity: 'high' },             // skip (no change)
        { title: 'Brand New', description: 'd', severity: 'medium' },      // import
      ], 'u1');

      expect(result).toEqual({ imported: 1, updated: 1, skipped: 1 });
    });

    it('uses default probability and impact when not provided', async () => {
      mockRepo.findByProject.mockResolvedValueOnce([]);
      mockRepo.create.mockResolvedValueOnce(sampleRisk());

      await riskService.importFromAIScan('p1', [
        { title: 'No Scores', description: 'desc', severity: 'medium' },
      ], 'u1');

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ probability: 3, impact: 3 }),
      );
    });

    it('joins mitigations array into newline-separated string', async () => {
      mockRepo.findByProject.mockResolvedValueOnce([]);
      mockRepo.create.mockResolvedValueOnce(sampleRisk());

      await riskService.importFromAIScan('p1', [
        { title: 'R1', description: 'd', severity: 'high', mitigations: ['Step 1', 'Step 2'] },
      ], 'u1');

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ mitigationPlan: 'Step 1\nStep 2' }),
      );
    });
  });

  // ===================== importFromAgent =====================
  describe('importFromAgent', () => {
    it('imports new agent risks and skips duplicates', async () => {
      const existing = { ...sampleRisk(), title: 'Known Risk', source: 'agent', sourceAgentId: 'agent1' };
      mockRepo.findByAgentSource.mockResolvedValueOnce([existing]);
      mockRepo.create.mockResolvedValueOnce(sampleRisk());

      const created = await riskService.importFromAgent('p1', 'agent1', [
        { title: 'Known Risk', description: 'd', severity: 'high' },  // duplicate
        { title: 'New Risk', description: 'd', severity: 'medium' },   // new
      ], 'proposal1', 'u1');

      expect(created).toBe(1);
      expect(mockRepo.create).toHaveBeenCalledOnce();
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'agent',
          sourceAgentId: 'agent1',
          linkedProposalId: 'proposal1',
        }),
      );
    });

    it('uses system as createdBy when userId not provided', async () => {
      mockRepo.findByAgentSource.mockResolvedValueOnce([]);
      mockRepo.create.mockResolvedValueOnce(sampleRisk());

      await riskService.importFromAgent('p1', 'agent1', [
        { title: 'R1', description: 'd', severity: 'high' },
      ]);

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ createdBy: 'system' }),
      );
    });

    it('returns 0 when all risks are duplicates', async () => {
      const existing = { ...sampleRisk(), title: 'Risk A', source: 'agent' };
      mockRepo.findByAgentSource.mockResolvedValueOnce([existing]);

      const created = await riskService.importFromAgent('p1', 'agent1', [
        { title: 'Risk A', description: 'd', severity: 'high' },
      ]);

      expect(created).toBe(0);
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('defaults category to other when not provided', async () => {
      mockRepo.findByAgentSource.mockResolvedValueOnce([]);
      mockRepo.create.mockResolvedValueOnce(sampleRisk());

      await riskService.importFromAgent('p1', 'agent1', [
        { title: 'R1', description: 'd', severity: 'high' },
      ], undefined, 'u1');

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'other' }),
      );
    });
  });

  // ===================== mapAICategory =====================
  describe('mapAICategory', () => {
    it('maps known AI categories', () => {
      expect(riskService.mapAICategory('schedule')).toBe('schedule');
      expect(riskService.mapAICategory('Budget')).toBe('budget');
      expect(riskService.mapAICategory('RESOURCE')).toBe('resource');
      expect(riskService.mapAICategory('technical')).toBe('technical');
      expect(riskService.mapAICategory('stakeholder')).toBe('stakeholder');
      expect(riskService.mapAICategory('dependency')).toBe('dependency');
      expect(riskService.mapAICategory('weather')).toBe('weather');
      expect(riskService.mapAICategory('regulatory')).toBe('regulatory');
    });

    it('returns other for unknown categories', () => {
      expect(riskService.mapAICategory('unknown_type')).toBe('other');
      expect(riskService.mapAICategory('foobar')).toBe('other');
    });

    it('returns other when undefined', () => {
      expect(riskService.mapAICategory(undefined)).toBe('other');
    });

    it('returns other when empty string', () => {
      expect(riskService.mapAICategory('')).toBe('other');
    });
  });
});
