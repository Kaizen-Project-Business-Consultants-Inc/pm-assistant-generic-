import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../database/NotificationRepository', () => {
  const mockRepo = {
    insert: vi.fn().mockResolvedValue(undefined),
    findByUser: vi.fn().mockResolvedValue([]),
    markRead: vi.fn().mockResolvedValue(undefined),
    markAllRead: vi.fn().mockResolvedValue(undefined),
    countByUser: vi.fn().mockResolvedValue(0),
    countUnread: vi.fn().mockResolvedValue(0),
  };
  return { notificationRepository: mockRepo };
});

vi.mock('../../services/WebSocketService', () => ({
  WebSocketService: {
    broadcast: vi.fn(),
    sendToUser: vi.fn(),
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

vi.mock('../../config', () => ({
  config: {
    APP_URL: 'https://pm.kpbc.ca',
  },
}));

vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('test-uuid-1234'),
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { NotificationService } from '../../services/NotificationService';
import { notificationRepository } from '../../database/NotificationRepository';
import { WebSocketService } from '../../services/WebSocketService';
import { emailService } from '../../services/EmailService';
import { userService } from '../../services/UserService';
import logger from '../../utils/logger';

const mockRepo = notificationRepository as any;
const mockWs = WebSocketService as any;
const mockEmail = emailService as any;
const mockUserService = userService as any;

const sampleNotification = {
  id: 'test-uuid-1234',
  userId: 'user-1',
  type: 'info',
  severity: 'medium' as const,
  title: 'Test Notification',
  message: 'This is a test',
  projectId: null,
  scheduleId: null,
  linkType: null,
  linkId: null,
  isRead: false,
  createdAt: '2026-07-04 12:00:00',
};

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    service = new NotificationService();
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('inserts notification with defaults and returns DTO', async () => {
      const result = await service.create({
        userId: 'user-1',
        title: 'Test Notification',
        message: 'This is a test',
      });

      expect(mockRepo.insert).toHaveBeenCalledWith(
        'test-uuid-1234',
        'user-1',
        'info',       // default type
        'medium',     // default severity
        'Test Notification',
        'This is a test',
        null, null, null, null,
        expect.any(String), // createdAt timestamp
      );

      expect(result.id).toBe('test-uuid-1234');
      expect(result.userId).toBe('user-1');
      expect(result.type).toBe('info');
      expect(result.severity).toBe('medium');
      expect(result.isRead).toBe(false);
    });

    it('defaults type to info and severity to medium', async () => {
      const dto = await service.create({
        userId: 'user-1',
        title: 'Default Test',
        message: 'Defaults',
      });

      expect(dto.type).toBe('info');
      expect(dto.severity).toBe('medium');
    });

    it('uses provided type and severity', async () => {
      const result = await service.create({
        userId: 'user-1',
        type: 'alert',
        severity: 'critical',
        title: 'Critical Alert',
        message: 'Something is wrong',
      });

      expect(mockRepo.insert).toHaveBeenCalledWith(
        'test-uuid-1234',
        'user-1',
        'alert',
        'critical',
        'Critical Alert',
        'Something is wrong',
        null, null, null, null,
        expect.any(String),
      );
      expect(result.type).toBe('alert');
      expect(result.severity).toBe('critical');
    });

    it('passes projectId, scheduleId, linkType, linkId when provided', async () => {
      await service.create({
        userId: 'user-1',
        title: 'Task Update',
        message: 'Task was updated',
        projectId: 'proj-1',
        scheduleId: 'sched-1',
        linkType: 'task',
        linkId: 'task-42',
      });

      expect(mockRepo.insert).toHaveBeenCalledWith(
        'test-uuid-1234',
        'user-1',
        'info',
        'medium',
        'Task Update',
        'Task was updated',
        'proj-1',
        'sched-1',
        'task',
        'task-42',
        expect.any(String),
      );
    });

    it('broadcasts notification via WebSocket', async () => {
      await service.create({
        userId: 'user-1',
        title: 'WS Test',
        message: 'Broadcast this',
      });

      expect(mockWs.sendToUser).toHaveBeenCalledWith(
        'user-1',
        {
          type: 'notification',
          payload: expect.objectContaining({
            id: 'test-uuid-1234',
            title: 'WS Test',
            userId: 'user-1',
            isRead: false,
          }),
        },
      );
    });

    it('does not send email for medium severity', async () => {
      await service.create({
        userId: 'user-1',
        severity: 'medium',
        title: 'Medium',
        message: 'Not urgent',
      });

      expect(mockEmail.sendNotificationEmail).not.toHaveBeenCalled();
    });

    it('does not send email for low severity', async () => {
      await service.create({
        userId: 'user-1',
        severity: 'low',
        title: 'Low Priority',
        message: 'Informational',
      });

      expect(mockEmail.sendNotificationEmail).not.toHaveBeenCalled();
    });

    it('sends email for critical severity when user has email enabled', async () => {
      mockUserService.findById.mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@example.com',
        emailNotificationsEnabled: true,
        emailVerified: true,
      });

      await service.create({
        userId: 'user-1',
        severity: 'critical',
        title: 'Critical Issue',
        message: 'Server is down',
        linkType: 'task',
        linkId: 'task-99',
      });

      // Wait for the fire-and-forget async to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockUserService.findById).toHaveBeenCalledWith('user-1');
      expect(mockEmail.sendNotificationEmail).toHaveBeenCalledWith(
        'user@example.com',
        '[CRITICAL] Critical Issue',
        'Critical Issue',
        'Server is down',
        'https://pm.kpbc.ca/tasks/task-99',
        'View Details',
      );
    });

    it('sends email for high severity when user has email enabled', async () => {
      mockUserService.findById.mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@example.com',
        emailNotificationsEnabled: true,
        emailVerified: true,
      });

      await service.create({
        userId: 'user-1',
        severity: 'high',
        title: 'High Priority',
        message: 'Needs attention',
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockUserService.findById).toHaveBeenCalledWith('user-1');
      expect(mockEmail.sendNotificationEmail).toHaveBeenCalledWith(
        'user@example.com',
        '[HIGH] High Priority',
        'High Priority',
        'Needs attention',
        undefined, // no linkType/linkId
        'View Details',
      );
    });

    it('does not send email when user has email notifications disabled', async () => {
      mockUserService.findById.mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@example.com',
        emailNotificationsEnabled: false,
        emailVerified: true,
      });

      await service.create({
        userId: 'user-1',
        severity: 'critical',
        title: 'Critical',
        message: 'Urgent',
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockUserService.findById).toHaveBeenCalledWith('user-1');
      expect(mockEmail.sendNotificationEmail).not.toHaveBeenCalled();
    });

    it('does not send email when user email is not verified', async () => {
      mockUserService.findById.mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@example.com',
        emailNotificationsEnabled: true,
        emailVerified: false,
      });

      await service.create({
        userId: 'user-1',
        severity: 'high',
        title: 'Important',
        message: 'Check this',
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockEmail.sendNotificationEmail).not.toHaveBeenCalled();
    });

    it('does not send email when user has no email address', async () => {
      mockUserService.findById.mockResolvedValueOnce({
        id: 'user-1',
        email: null,
        emailNotificationsEnabled: true,
        emailVerified: true,
      });

      await service.create({
        userId: 'user-1',
        severity: 'critical',
        title: 'Critical',
        message: 'No email',
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockEmail.sendNotificationEmail).not.toHaveBeenCalled();
    });

    it('does not send email when user is not found', async () => {
      mockUserService.findById.mockResolvedValueOnce(null);

      await service.create({
        userId: 'user-1',
        severity: 'critical',
        title: 'Critical',
        message: 'No user',
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockEmail.sendNotificationEmail).not.toHaveBeenCalled();
    });

    it('swallows user lookup errors without affecting notification creation', async () => {
      mockUserService.findById.mockRejectedValueOnce(new Error('DB down'));
      const result = await service.create({
        userId: 'user-1',
        severity: 'critical',
        title: 'Critical',
        message: 'Lookup will fail',
      });

      // Notification was still created and returned (defaults to all-on when lookup fails)
      expect(result.id).toBe('test-uuid-1234');
      expect(mockRepo.insert).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        '[NotificationService] Failed to look up user preferences:',
        expect.any(Error),
      );
    });

    it('skips in-app insert when category inApp is disabled', async () => {
      mockUserService.findById.mockResolvedValueOnce({
        id: 'user-1',
        notificationTypePreferences: {
          agent_proposals: { inApp: false, email: false },
        },
      });

      const result = await service.create({
        userId: 'user-1',
        type: 'agent_proposal',
        severity: 'medium',
        title: 'Proposal',
        message: 'New proposal',
      });

      expect(mockRepo.insert).not.toHaveBeenCalled();
      expect(mockWs.sendToUser).not.toHaveBeenCalled();
      expect(result.id).toBe('test-uuid-1234');
    });

    it('skips email when category email is disabled but still inserts in-app', async () => {
      mockUserService.findById.mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@example.com',
        emailNotificationsEnabled: true,
        emailVerified: true,
        notificationTypePreferences: {
          budget_finance: { inApp: true, email: false },
        },
      });

      await service.create({
        userId: 'user-1',
        type: 'budget_alert',
        severity: 'critical',
        title: 'Budget Alert',
        message: 'Over budget',
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockRepo.insert).toHaveBeenCalled();
      expect(mockEmail.sendNotificationEmail).not.toHaveBeenCalled();
    });

    it('never suppresses system_alert for admin users', async () => {
      mockUserService.findById.mockResolvedValueOnce({
        id: 'user-1',
        role: 'admin',
        email: 'admin@example.com',
        emailNotificationsEnabled: true,
        emailVerified: true,
        notificationTypePreferences: {
          system_alerts: { inApp: false, email: false },
        },
      });

      await service.create({
        userId: 'user-1',
        type: 'system_alert',
        severity: 'critical',
        title: 'System Down',
        message: 'Critical system alert',
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockRepo.insert).toHaveBeenCalled();
      expect(mockWs.sendToUser).toHaveBeenCalled();
      expect(mockEmail.sendNotificationEmail).toHaveBeenCalled();
    });

    it('omits ctaUrl when linkId is missing', async () => {
      mockUserService.findById.mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@example.com',
        emailNotificationsEnabled: true,
        emailVerified: true,
      });

      await service.create({
        userId: 'user-1',
        severity: 'high',
        title: 'No Link',
        message: 'No CTA',
        linkType: 'project', // linkId missing
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockEmail.sendNotificationEmail).toHaveBeenCalledWith(
        'user@example.com',
        '[HIGH] No Link',
        'No Link',
        'No CTA',
        undefined, // ctaUrl should be undefined since linkId is missing
        'View Details',
      );
    });
  });

  describe('getByUserId', () => {
    it('delegates to repository with default limit and offset', async () => {
      mockRepo.findByUser.mockResolvedValueOnce([sampleNotification]);

      const result = await service.getByUserId('user-1');

      expect(mockRepo.findByUser).toHaveBeenCalledWith('user-1', 50, 0);
      expect(result).toEqual([sampleNotification]);
    });

    it('passes custom limit and offset', async () => {
      mockRepo.findByUser.mockResolvedValueOnce([]);

      await service.getByUserId('user-1', 10, 20);

      expect(mockRepo.findByUser).toHaveBeenCalledWith('user-1', 10, 20);
    });

    it('returns empty array when no notifications exist', async () => {
      const result = await service.getByUserId('user-no-notifs');

      expect(result).toEqual([]);
    });
  });

  describe('markRead', () => {
    it('delegates to repository', async () => {
      await service.markRead('notif-1');

      expect(mockRepo.markRead).toHaveBeenCalledWith('notif-1');
    });
  });

  describe('markAllRead', () => {
    it('delegates to repository', async () => {
      await service.markAllRead('user-1');

      expect(mockRepo.markAllRead).toHaveBeenCalledWith('user-1');
    });
  });

  describe('countByUserId', () => {
    it('delegates to repository and returns count', async () => {
      mockRepo.countByUser.mockResolvedValueOnce(42);

      const result = await service.countByUserId('user-1');

      expect(mockRepo.countByUser).toHaveBeenCalledWith('user-1');
      expect(result).toBe(42);
    });

    it('returns 0 when no notifications exist', async () => {
      const result = await service.countByUserId('user-empty');

      expect(result).toBe(0);
    });
  });

  describe('getUnreadCount', () => {
    it('delegates to repository and returns unread count', async () => {
      mockRepo.countUnread.mockResolvedValueOnce(7);

      const result = await service.getUnreadCount('user-1');

      expect(mockRepo.countUnread).toHaveBeenCalledWith('user-1');
      expect(result).toBe(7);
    });

    it('returns 0 when all notifications are read', async () => {
      const result = await service.getUnreadCount('user-1');

      expect(result).toBe(0);
    });
  });
});
