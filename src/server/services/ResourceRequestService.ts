import { resourceRequestRepository, type ResourceRequest } from '../database/ResourceRequestRepository';
import { notificationService } from './NotificationService';
import { emailService } from './EmailService';
import { userService } from './UserService';
import { auditLedgerService } from './AuditLedgerService';
import { deadLetterService } from './DeadLetterService';
import { config } from '../config';
import logger from '../utils/logger';

class ResourceRequestService {
  async createRequest(projectId: string, data: {
    resourceRole: string;
    resourceGroup?: string;
    hoursNeeded: number;
    startDate: string;
    endDate: string;
    justification?: string;
    skillsRequired?: string[];
    priority?: string;
  }, userId: string): Promise<ResourceRequest> {
    if (new Date(data.startDate) > new Date(data.endDate)) {
      throw new Error('Start date must be before end date');
    }
    const rr = await resourceRequestRepository.create({ ...data, projectId, requestedBy: userId });

    auditLedgerService.append({
      actorId: userId, actorType: 'user', action: 'resource_request.create',
      entityType: 'resource_request', entityId: rr.id, projectId,
      payload: { resourceRole: data.resourceRole, hoursNeeded: data.hoursNeeded },
      source: 'web',
    }).catch(err => deadLetterService.capture('audit.append', {}, err));

    return rr;
  }

  async submitRequest(id: string, userId: string): Promise<ResourceRequest> {
    const rr = await resourceRequestRepository.findById(id);
    if (!rr) throw new Error('Resource request not found');
    if (rr.status !== 'draft') throw new Error('Only draft requests can be submitted');
    if (rr.requestedBy !== userId) throw new Error('Only the requester can submit');

    const updated = await resourceRequestRepository.updateStatus(id, 'pending');

    auditLedgerService.append({
      actorId: userId, actorType: 'user', action: 'resource_request.submit',
      entityType: 'resource_request', entityId: id, projectId: rr.projectId,
      payload: { status: 'pending' }, source: 'web',
    }).catch(err => deadLetterService.capture('audit.append', {}, err));

    return updated;
  }

  async approveRequest(id: string, userId: string, comment?: string): Promise<ResourceRequest> {
    const rr = await resourceRequestRepository.findById(id);
    if (!rr) throw new Error('Resource request not found');
    if (rr.status !== 'pending') throw new Error('Only pending requests can be approved');

    const updated = await resourceRequestRepository.updateStatus(id, 'approved', {
      approvedBy: userId,
      reviewerComment: comment,
    });

    auditLedgerService.append({
      actorId: userId, actorType: 'user', action: 'resource_request.approve',
      entityType: 'resource_request', entityId: id, projectId: rr.projectId,
      payload: { status: 'approved', comment }, source: 'web',
    }).catch(err => deadLetterService.capture('audit.append', {}, err));

    // Notify requester (fire-and-forget)
    if (rr.requestedBy !== userId) {
      notificationService.create({
        userId: rr.requestedBy,
        type: 'resource_request_approved',
        severity: 'medium',
        title: 'Resource Request Approved',
        message: `Your request for "${rr.resourceRole}" has been approved${comment ? ': ' + comment : ''}`,
        projectId: rr.projectId,
        linkType: 'resource_request',
        linkId: id,
      }).catch(err => logger.warn('Failed to notify resource request approval', { error: err.message }));

      userService.findById(rr.requestedBy).then(requester => {
        if (requester?.email && requester.emailNotificationsEnabled) {
          emailService.sendNotificationEmail(
            requester.email,
            'Resource Request Approved',
            'Resource Request Approved',
            `Your request for "${rr.resourceRole}" on ${rr.projectName || 'your project'} has been approved.${comment ? ' Comment: ' + comment : ''}`,
            `${config.APP_URL}/resources`,
            'View Resources',
          ).catch(err => logger.warn('Failed to email resource request approval', { error: err.message }));
        }
      }).catch(() => {});
    }

    return updated;
  }

  async rejectRequest(id: string, userId: string, comment: string): Promise<ResourceRequest> {
    const rr = await resourceRequestRepository.findById(id);
    if (!rr) throw new Error('Resource request not found');
    if (rr.status !== 'pending') throw new Error('Only pending requests can be rejected');
    if (!comment) throw new Error('Comment is required when rejecting');

    const updated = await resourceRequestRepository.updateStatus(id, 'rejected', {
      approvedBy: userId,
      reviewerComment: comment,
    });

    auditLedgerService.append({
      actorId: userId, actorType: 'user', action: 'resource_request.reject',
      entityType: 'resource_request', entityId: id, projectId: rr.projectId,
      payload: { status: 'rejected', comment }, source: 'web',
    }).catch(err => deadLetterService.capture('audit.append', {}, err));

    // Notify requester (fire-and-forget)
    if (rr.requestedBy !== userId) {
      notificationService.create({
        userId: rr.requestedBy,
        type: 'resource_request_rejected',
        severity: 'high',
        title: 'Resource Request Rejected',
        message: `Your request for "${rr.resourceRole}" was rejected: ${comment}`,
        projectId: rr.projectId,
        linkType: 'resource_request',
        linkId: id,
      }).catch(err => logger.warn('Failed to notify resource request rejection', { error: err.message }));

      userService.findById(rr.requestedBy).then(requester => {
        if (requester?.email && requester.emailNotificationsEnabled) {
          emailService.sendNotificationEmail(
            requester.email,
            'Resource Request Rejected',
            'Resource Request Rejected',
            `Your request for "${rr.resourceRole}" on ${rr.projectName || 'your project'} was rejected. Reason: ${comment}`,
            `${config.APP_URL}/resources`,
            'View Resources',
          ).catch(err => logger.warn('Failed to email resource request rejection', { error: err.message }));
        }
      }).catch(() => {});
    }

    return updated;
  }

  async fulfillRequest(id: string, resourceId: string, userId: string): Promise<ResourceRequest> {
    const rr = await resourceRequestRepository.findById(id);
    if (!rr) throw new Error('Resource request not found');
    if (rr.status !== 'approved') throw new Error('Only approved requests can be fulfilled');

    const updated = await resourceRequestRepository.updateStatus(id, 'fulfilled', {
      fulfilledResourceId: resourceId,
    });

    auditLedgerService.append({
      actorId: userId, actorType: 'user', action: 'resource_request.fulfill',
      entityType: 'resource_request', entityId: id, projectId: rr.projectId,
      payload: { status: 'fulfilled', resourceId }, source: 'web',
    }).catch(err => deadLetterService.capture('audit.append', {}, err));

    return updated;
  }

  async cancelRequest(id: string, userId: string): Promise<ResourceRequest> {
    const rr = await resourceRequestRepository.findById(id);
    if (!rr) throw new Error('Resource request not found');
    if (!['draft', 'pending'].includes(rr.status)) throw new Error('Only draft or pending requests can be cancelled');
    if (rr.requestedBy !== userId) throw new Error('Only the requester can cancel');

    const updated = await resourceRequestRepository.updateStatus(id, 'cancelled');

    auditLedgerService.append({
      actorId: userId, actorType: 'user', action: 'resource_request.cancel',
      entityType: 'resource_request', entityId: id, projectId: rr.projectId,
      payload: { status: 'cancelled' }, source: 'web',
    }).catch(err => deadLetterService.capture('audit.append', {}, err));

    return updated;
  }

  async getRequests(filters?: { projectId?: string; status?: string; priority?: string }): Promise<ResourceRequest[]> {
    return resourceRequestRepository.findAll(filters);
  }

  async getPendingApprovals(): Promise<ResourceRequest[]> {
    return resourceRequestRepository.findPendingForApproval();
  }

  async getSummary(): Promise<Record<string, number>> {
    return resourceRequestRepository.countByStatus();
  }

  async getRequest(id: string): Promise<ResourceRequest | null> {
    return resourceRequestRepository.findById(id);
  }

  async updateRequest(id: string, data: Record<string, any>, userId: string): Promise<ResourceRequest> {
    const rr = await resourceRequestRepository.findById(id);
    if (!rr) throw new Error('Resource request not found');
    if (rr.status !== 'draft') throw new Error('Only draft requests can be edited');
    if (rr.requestedBy !== userId) throw new Error('Only the requester can edit');

    return resourceRequestRepository.update(id, data);
  }
}

export const resourceRequestService = new ResourceRequestService();
