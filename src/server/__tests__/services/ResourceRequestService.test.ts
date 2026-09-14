import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks (hoisted) ───────────────────────────────────────────────────────

vi.mock('../../database/ResourceRequestRepository', () => ({
  resourceRequestRepository: {
    create: vi.fn(),
    findById: vi.fn(),
    updateStatus: vi.fn(),
    findAll: vi.fn(),
    findPendingForApproval: vi.fn(),
    countByStatus: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../../services/NotificationService', () => ({
  notificationService: {
    create: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../services/EmailService', () => ({
  emailService: {
    sendNotificationEmail: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/UserService', () => ({
  userService: {
    findById: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../services/AuditLedgerService', () => ({
  auditLedgerService: {
    append: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/DeadLetterService', () => ({
  deadLetterService: {
    capture: vi.fn(),
  },
}));

vi.mock('../../config', () => ({
  config: {
    APP_URL: 'https://app.test',
  },
}));

vi.mock('../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Import SUT + mocked deps ──────────────────────────────────────────────

import { resourceRequestService } from '../../services/ResourceRequestService';
import { resourceRequestRepository } from '../../database/ResourceRequestRepository';
import { auditLedgerService } from '../../services/AuditLedgerService';
import { notificationService } from '../../services/NotificationService';
import { userService } from '../../services/UserService';
import { emailService } from '../../services/EmailService';
import type { ResourceRequest } from '../../database/ResourceRequestRepository';

// Cast repository methods for easy mock access
const repo = resourceRequestRepository as unknown as {
  create: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  updateStatus: ReturnType<typeof vi.fn>;
  findAll: ReturnType<typeof vi.fn>;
  findPendingForApproval: ReturnType<typeof vi.fn>;
  countByStatus: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<ResourceRequest> = {}): ResourceRequest {
  return {
    id: 'rr-1',
    projectId: 'proj-1',
    requestedBy: 'user-1',
    resourceRole: 'Developer',
    resourceGroup: null,
    hoursNeeded: 40,
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    justification: null,
    skillsRequired: null,
    priority: 'medium',
    status: 'draft',
    approvedBy: null,
    approvedAt: null,
    fulfilledResourceId: null,
    reviewerComment: null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    projectName: 'Test Project',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ResourceRequestService', () => {
  // ────────────────────────────────────────────────────────────────────────
  // createRequest
  // ────────────────────────────────────────────────────────────────────────
  describe('createRequest', () => {
    const validData = {
      resourceRole: 'Developer',
      hoursNeeded: 40,
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    };

    it('creates a request and returns it', async () => {
      const created = makeRequest();
      repo.create.mockResolvedValue(created);

      const result = await resourceRequestService.createRequest('proj-1', validData, 'user-1');

      expect(result).toEqual(created);
      expect(repo.create).toHaveBeenCalledWith({
        ...validData,
        projectId: 'proj-1',
        requestedBy: 'user-1',
      });
    });

    it('appends an audit entry on create', async () => {
      repo.create.mockResolvedValue(makeRequest());

      await resourceRequestService.createRequest('proj-1', validData, 'user-1');

      expect(auditLedgerService.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'resource_request.create',
          entityType: 'resource_request',
          entityId: 'rr-1',
          projectId: 'proj-1',
        }),
      );
    });

    it('throws when startDate is after endDate', async () => {
      const badData = { ...validData, startDate: '2026-10-01', endDate: '2026-09-01' };

      await expect(
        resourceRequestService.createRequest('proj-1', badData, 'user-1'),
      ).rejects.toThrow('Start date must be before end date');

      expect(repo.create).not.toHaveBeenCalled();
    });

    it('passes optional fields through to the repository', async () => {
      const dataWithOptionals = {
        ...validData,
        resourceGroup: 'Engineering',
        justification: 'Critical need',
        skillsRequired: ['TypeScript', 'React'],
        priority: 'high',
      };
      repo.create.mockResolvedValue(makeRequest());

      await resourceRequestService.createRequest('proj-1', dataWithOptionals, 'user-1');

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceGroup: 'Engineering',
          justification: 'Critical need',
          skillsRequired: ['TypeScript', 'React'],
          priority: 'high',
        }),
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // submitRequest
  // ────────────────────────────────────────────────────────────────────────
  describe('submitRequest', () => {
    it('submits a draft request', async () => {
      const rr = makeRequest({ status: 'draft', requestedBy: 'user-1' });
      const updated = makeRequest({ status: 'pending' });
      repo.findById.mockResolvedValue(rr);
      repo.updateStatus.mockResolvedValue(updated);

      const result = await resourceRequestService.submitRequest('rr-1', 'user-1');

      expect(result.status).toBe('pending');
      expect(repo.updateStatus).toHaveBeenCalledWith('rr-1', 'pending');
    });

    it('throws if request not found', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        resourceRequestService.submitRequest('rr-999', 'user-1'),
      ).rejects.toThrow('Resource request not found');
    });

    it('throws if status is not draft', async () => {
      repo.findById.mockResolvedValue(makeRequest({ status: 'pending' }));

      await expect(
        resourceRequestService.submitRequest('rr-1', 'user-1'),
      ).rejects.toThrow('Only draft requests can be submitted');
    });

    it('throws if user is not the requester', async () => {
      repo.findById.mockResolvedValue(makeRequest({ status: 'draft', requestedBy: 'user-1' }));

      await expect(
        resourceRequestService.submitRequest('rr-1', 'user-other'),
      ).rejects.toThrow('Only the requester can submit');
    });

    it('appends an audit entry on submit', async () => {
      repo.findById.mockResolvedValue(makeRequest({ status: 'draft', requestedBy: 'user-1' }));
      repo.updateStatus.mockResolvedValue(makeRequest({ status: 'pending' }));

      await resourceRequestService.submitRequest('rr-1', 'user-1');

      expect(auditLedgerService.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'resource_request.submit',
          payload: { status: 'pending' },
        }),
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // approveRequest
  // ────────────────────────────────────────────────────────────────────────
  describe('approveRequest', () => {
    it('approves a pending request', async () => {
      const rr = makeRequest({ status: 'pending' });
      const updated = makeRequest({ status: 'approved', approvedBy: 'admin-1' });
      repo.findById.mockResolvedValue(rr);
      repo.updateStatus.mockResolvedValue(updated);

      const result = await resourceRequestService.approveRequest('rr-1', 'admin-1', 'Looks good');

      expect(result.status).toBe('approved');
      expect(repo.updateStatus).toHaveBeenCalledWith('rr-1', 'approved', {
        approvedBy: 'admin-1',
        reviewerComment: 'Looks good',
      });
    });

    it('throws if request not found', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        resourceRequestService.approveRequest('rr-999', 'admin-1'),
      ).rejects.toThrow('Resource request not found');
    });

    it('throws if status is not pending', async () => {
      repo.findById.mockResolvedValue(makeRequest({ status: 'draft' }));

      await expect(
        resourceRequestService.approveRequest('rr-1', 'admin-1'),
      ).rejects.toThrow('Only pending requests can be approved');
    });

    it('sends notification to requester when approver is different user', async () => {
      const rr = makeRequest({ status: 'pending', requestedBy: 'user-1' });
      repo.findById.mockResolvedValue(rr);
      repo.updateStatus.mockResolvedValue(makeRequest({ status: 'approved' }));

      await resourceRequestService.approveRequest('rr-1', 'admin-1', 'Approved');

      expect(notificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          type: 'resource_request_approved',
          title: 'Resource Request Approved',
        }),
      );
    });

    it('does not notify when approver is the requester', async () => {
      const rr = makeRequest({ status: 'pending', requestedBy: 'user-1' });
      repo.findById.mockResolvedValue(rr);
      repo.updateStatus.mockResolvedValue(makeRequest({ status: 'approved' }));

      await resourceRequestService.approveRequest('rr-1', 'user-1');

      expect(notificationService.create).not.toHaveBeenCalled();
    });

    it('sends email when requester has email notifications enabled', async () => {
      const rr = makeRequest({ status: 'pending', requestedBy: 'user-1' });
      repo.findById.mockResolvedValue(rr);
      repo.updateStatus.mockResolvedValue(makeRequest({ status: 'approved' }));
      (userService.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        email: 'user@test.com',
        emailNotificationsEnabled: true,
      });

      await resourceRequestService.approveRequest('rr-1', 'admin-1', 'Great');

      // Allow fire-and-forget promises to resolve
      await new Promise(r => setTimeout(r, 10));

      expect(emailService.sendNotificationEmail).toHaveBeenCalledWith(
        'user@test.com',
        'Resource Request Approved',
        'Resource Request Approved',
        expect.stringContaining('has been approved'),
        'https://app.test/resources',
        'View Resources',
      );
    });

    it('does not send email when requester has email notifications disabled', async () => {
      const rr = makeRequest({ status: 'pending', requestedBy: 'user-1' });
      repo.findById.mockResolvedValue(rr);
      repo.updateStatus.mockResolvedValue(makeRequest({ status: 'approved' }));
      (userService.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        email: 'user@test.com',
        emailNotificationsEnabled: false,
      });

      await resourceRequestService.approveRequest('rr-1', 'admin-1');
      await new Promise(r => setTimeout(r, 10));

      expect(emailService.sendNotificationEmail).not.toHaveBeenCalled();
    });

    it('includes comment in notification message when provided', async () => {
      const rr = makeRequest({ status: 'pending', requestedBy: 'user-1' });
      repo.findById.mockResolvedValue(rr);
      repo.updateStatus.mockResolvedValue(makeRequest({ status: 'approved' }));

      await resourceRequestService.approveRequest('rr-1', 'admin-1', 'Well justified');

      expect(notificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Well justified'),
        }),
      );
    });

    it('appends an audit entry on approve', async () => {
      repo.findById.mockResolvedValue(makeRequest({ status: 'pending' }));
      repo.updateStatus.mockResolvedValue(makeRequest({ status: 'approved' }));

      await resourceRequestService.approveRequest('rr-1', 'admin-1', 'OK');

      expect(auditLedgerService.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'resource_request.approve',
          payload: { status: 'approved', comment: 'OK' },
        }),
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // rejectRequest
  // ────────────────────────────────────────────────────────────────────────
  describe('rejectRequest', () => {
    it('rejects a pending request with comment', async () => {
      const rr = makeRequest({ status: 'pending' });
      const updated = makeRequest({ status: 'rejected', reviewerComment: 'Not needed' });
      repo.findById.mockResolvedValue(rr);
      repo.updateStatus.mockResolvedValue(updated);

      const result = await resourceRequestService.rejectRequest('rr-1', 'admin-1', 'Not needed');

      expect(result.status).toBe('rejected');
      expect(repo.updateStatus).toHaveBeenCalledWith('rr-1', 'rejected', {
        approvedBy: 'admin-1',
        reviewerComment: 'Not needed',
      });
    });

    it('throws if request not found', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        resourceRequestService.rejectRequest('rr-999', 'admin-1', 'No'),
      ).rejects.toThrow('Resource request not found');
    });

    it('throws if status is not pending', async () => {
      repo.findById.mockResolvedValue(makeRequest({ status: 'approved' }));

      await expect(
        resourceRequestService.rejectRequest('rr-1', 'admin-1', 'No'),
      ).rejects.toThrow('Only pending requests can be rejected');
    });

    it('throws if comment is empty', async () => {
      repo.findById.mockResolvedValue(makeRequest({ status: 'pending' }));

      await expect(
        resourceRequestService.rejectRequest('rr-1', 'admin-1', ''),
      ).rejects.toThrow('Comment is required when rejecting');
    });

    it('sends rejection notification to requester', async () => {
      const rr = makeRequest({ status: 'pending', requestedBy: 'user-1' });
      repo.findById.mockResolvedValue(rr);
      repo.updateStatus.mockResolvedValue(makeRequest({ status: 'rejected' }));

      await resourceRequestService.rejectRequest('rr-1', 'admin-1', 'Budget constraints');

      expect(notificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          type: 'resource_request_rejected',
          severity: 'high',
          message: expect.stringContaining('Budget constraints'),
        }),
      );
    });

    it('does not notify when rejector is the requester', async () => {
      const rr = makeRequest({ status: 'pending', requestedBy: 'user-1' });
      repo.findById.mockResolvedValue(rr);
      repo.updateStatus.mockResolvedValue(makeRequest({ status: 'rejected' }));

      await resourceRequestService.rejectRequest('rr-1', 'user-1', 'Self reject');

      expect(notificationService.create).not.toHaveBeenCalled();
    });

    it('sends rejection email when requester has email notifications enabled', async () => {
      const rr = makeRequest({ status: 'pending', requestedBy: 'user-1' });
      repo.findById.mockResolvedValue(rr);
      repo.updateStatus.mockResolvedValue(makeRequest({ status: 'rejected' }));
      (userService.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        email: 'user@test.com',
        emailNotificationsEnabled: true,
      });

      await resourceRequestService.rejectRequest('rr-1', 'admin-1', 'Denied');
      await new Promise(r => setTimeout(r, 10));

      expect(emailService.sendNotificationEmail).toHaveBeenCalledWith(
        'user@test.com',
        'Resource Request Rejected',
        'Resource Request Rejected',
        expect.stringContaining('was rejected'),
        'https://app.test/resources',
        'View Resources',
      );
    });

    it('appends an audit entry on reject', async () => {
      repo.findById.mockResolvedValue(makeRequest({ status: 'pending' }));
      repo.updateStatus.mockResolvedValue(makeRequest({ status: 'rejected' }));

      await resourceRequestService.rejectRequest('rr-1', 'admin-1', 'No budget');

      expect(auditLedgerService.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'resource_request.reject',
          payload: { status: 'rejected', comment: 'No budget' },
        }),
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // fulfillRequest
  // ────────────────────────────────────────────────────────────────────────
  describe('fulfillRequest', () => {
    it('fulfills an approved request', async () => {
      const rr = makeRequest({ status: 'approved' });
      const updated = makeRequest({ status: 'fulfilled', fulfilledResourceId: 'res-1' });
      repo.findById.mockResolvedValue(rr);
      repo.updateStatus.mockResolvedValue(updated);

      const result = await resourceRequestService.fulfillRequest('rr-1', 'res-1', 'admin-1');

      expect(result.status).toBe('fulfilled');
      expect(repo.updateStatus).toHaveBeenCalledWith('rr-1', 'fulfilled', {
        fulfilledResourceId: 'res-1',
      });
    });

    it('throws if request not found', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        resourceRequestService.fulfillRequest('rr-999', 'res-1', 'admin-1'),
      ).rejects.toThrow('Resource request not found');
    });

    it('throws if status is not approved', async () => {
      repo.findById.mockResolvedValue(makeRequest({ status: 'pending' }));

      await expect(
        resourceRequestService.fulfillRequest('rr-1', 'res-1', 'admin-1'),
      ).rejects.toThrow('Only approved requests can be fulfilled');
    });

    it('appends an audit entry on fulfill', async () => {
      repo.findById.mockResolvedValue(makeRequest({ status: 'approved' }));
      repo.updateStatus.mockResolvedValue(makeRequest({ status: 'fulfilled' }));

      await resourceRequestService.fulfillRequest('rr-1', 'res-1', 'admin-1');

      expect(auditLedgerService.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'resource_request.fulfill',
          payload: { status: 'fulfilled', resourceId: 'res-1' },
        }),
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // cancelRequest
  // ────────────────────────────────────────────────────────────────────────
  describe('cancelRequest', () => {
    it('cancels a draft request', async () => {
      const rr = makeRequest({ status: 'draft', requestedBy: 'user-1' });
      const updated = makeRequest({ status: 'cancelled' });
      repo.findById.mockResolvedValue(rr);
      repo.updateStatus.mockResolvedValue(updated);

      const result = await resourceRequestService.cancelRequest('rr-1', 'user-1');

      expect(result.status).toBe('cancelled');
      expect(repo.updateStatus).toHaveBeenCalledWith('rr-1', 'cancelled');
    });

    it('cancels a pending request', async () => {
      const rr = makeRequest({ status: 'pending', requestedBy: 'user-1' });
      const updated = makeRequest({ status: 'cancelled' });
      repo.findById.mockResolvedValue(rr);
      repo.updateStatus.mockResolvedValue(updated);

      const result = await resourceRequestService.cancelRequest('rr-1', 'user-1');

      expect(result.status).toBe('cancelled');
    });

    it('throws if request not found', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        resourceRequestService.cancelRequest('rr-999', 'user-1'),
      ).rejects.toThrow('Resource request not found');
    });

    it('throws if status is approved', async () => {
      repo.findById.mockResolvedValue(makeRequest({ status: 'approved', requestedBy: 'user-1' }));

      await expect(
        resourceRequestService.cancelRequest('rr-1', 'user-1'),
      ).rejects.toThrow('Only draft or pending requests can be cancelled');
    });

    it('throws if status is fulfilled', async () => {
      repo.findById.mockResolvedValue(makeRequest({ status: 'fulfilled', requestedBy: 'user-1' }));

      await expect(
        resourceRequestService.cancelRequest('rr-1', 'user-1'),
      ).rejects.toThrow('Only draft or pending requests can be cancelled');
    });

    it('throws if user is not the requester', async () => {
      repo.findById.mockResolvedValue(makeRequest({ status: 'draft', requestedBy: 'user-1' }));

      await expect(
        resourceRequestService.cancelRequest('rr-1', 'user-other'),
      ).rejects.toThrow('Only the requester can cancel');
    });

    it('appends an audit entry on cancel', async () => {
      repo.findById.mockResolvedValue(makeRequest({ status: 'draft', requestedBy: 'user-1' }));
      repo.updateStatus.mockResolvedValue(makeRequest({ status: 'cancelled' }));

      await resourceRequestService.cancelRequest('rr-1', 'user-1');

      expect(auditLedgerService.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'resource_request.cancel',
          payload: { status: 'cancelled' },
        }),
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // getRequests
  // ────────────────────────────────────────────────────────────────────────
  describe('getRequests', () => {
    it('returns all requests without filters', async () => {
      const requests = [makeRequest(), makeRequest({ id: 'rr-2' })];
      repo.findAll.mockResolvedValue(requests);

      const result = await resourceRequestService.getRequests();

      expect(result).toEqual(requests);
      expect(repo.findAll).toHaveBeenCalledWith(undefined);
    });

    it('passes filters to repository', async () => {
      repo.findAll.mockResolvedValue([]);
      const filters = { projectId: 'proj-1', status: 'pending', priority: 'high' };

      await resourceRequestService.getRequests(filters);

      expect(repo.findAll).toHaveBeenCalledWith(filters);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // getPendingApprovals
  // ────────────────────────────────────────────────────────────────────────
  describe('getPendingApprovals', () => {
    it('delegates to repository', async () => {
      const pending = [makeRequest({ status: 'pending' })];
      repo.findPendingForApproval.mockResolvedValue(pending);

      const result = await resourceRequestService.getPendingApprovals();

      expect(result).toEqual(pending);
      expect(repo.findPendingForApproval).toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // getSummary
  // ────────────────────────────────────────────────────────────────────────
  describe('getSummary', () => {
    it('returns status counts from repository', async () => {
      const summary = { draft: 2, pending: 3, approved: 1 };
      repo.countByStatus.mockResolvedValue(summary);

      const result = await resourceRequestService.getSummary();

      expect(result).toEqual(summary);
      expect(repo.countByStatus).toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // getRequest
  // ────────────────────────────────────────────────────────────────────────
  describe('getRequest', () => {
    it('returns request by id', async () => {
      const rr = makeRequest();
      repo.findById.mockResolvedValue(rr);

      const result = await resourceRequestService.getRequest('rr-1');

      expect(result).toEqual(rr);
      expect(repo.findById).toHaveBeenCalledWith('rr-1');
    });

    it('returns null when not found', async () => {
      repo.findById.mockResolvedValue(null);

      const result = await resourceRequestService.getRequest('rr-999');

      expect(result).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // updateRequest
  // ────────────────────────────────────────────────────────────────────────
  describe('updateRequest', () => {
    it('updates a draft request by the requester', async () => {
      const rr = makeRequest({ status: 'draft', requestedBy: 'user-1' });
      const updated = makeRequest({ status: 'draft', hoursNeeded: 80 });
      repo.findById.mockResolvedValue(rr);
      repo.update.mockResolvedValue(updated);

      const result = await resourceRequestService.updateRequest('rr-1', { hoursNeeded: 80 }, 'user-1');

      expect(result.hoursNeeded).toBe(80);
      expect(repo.update).toHaveBeenCalledWith('rr-1', { hoursNeeded: 80 });
    });

    it('throws if request not found', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        resourceRequestService.updateRequest('rr-999', {}, 'user-1'),
      ).rejects.toThrow('Resource request not found');
    });

    it('throws if status is not draft', async () => {
      repo.findById.mockResolvedValue(makeRequest({ status: 'pending', requestedBy: 'user-1' }));

      await expect(
        resourceRequestService.updateRequest('rr-1', { hoursNeeded: 80 }, 'user-1'),
      ).rejects.toThrow('Only draft requests can be edited');
    });

    it('throws if user is not the requester', async () => {
      repo.findById.mockResolvedValue(makeRequest({ status: 'draft', requestedBy: 'user-1' }));

      await expect(
        resourceRequestService.updateRequest('rr-1', { hoursNeeded: 80 }, 'user-other'),
      ).rejects.toThrow('Only the requester can edit');
    });
  });
});
