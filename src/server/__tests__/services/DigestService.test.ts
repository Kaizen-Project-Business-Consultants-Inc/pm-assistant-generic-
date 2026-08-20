import { describe, it, expect, vi, beforeEach } from 'vitest';

const sharedMockQuery = vi.hoisted(() => vi.fn().mockResolvedValue([]));
vi.mock('../../database/connection', () => ({
  databaseService: {
    query: sharedMockQuery,
    queryControlPlane: sharedMockQuery,
  },
}));

vi.mock('../../services/EmailService', () => ({
  emailService: { sendDigestEmail: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  maskPii: vi.fn((v: string) => '***masked***'),
}));

import { DigestService } from '../../services/DigestService';
import { databaseService } from '../../database/connection';
import { emailService } from '../../services/EmailService';
import logger from '../../utils/logger';

const mockQuery = sharedMockQuery;
const mockSendDigestEmail = emailService.sendDigestEmail as ReturnType<typeof vi.fn>;

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    username: 'alice',
    email: 'alice@example.com',
    full_name: 'Alice Smith',
    digest_frequency: 'daily',
    digest_last_sent_at: null, // never sent => always due
    digest_preferred_hour: 7,
    digest_sections: null,
    ...overrides,
  };
}

/**
 * Enqueue mock responses for a single user's buildDigest call.
 * Order: project_members, overdueTasks, upcomingDeadlines, unreadCount,
 *        getRecentChanges(project_members), actionItems
 * (meetings and sprints skip DB call when projectIds is empty)
 */
function mockBuildDigest(opts: {
  overdueTasks?: any[];
  upcomingDeadlines?: any[];
  unreadCount?: number | null;
  projectMembers?: any[];
  actionItems?: any[];
} = {}) {
  // project_members query at top of buildDigest
  mockQuery.mockResolvedValueOnce(opts.projectMembers ?? []);
  // findOverdueTasks
  mockQuery.mockResolvedValueOnce(opts.overdueTasks ?? []);
  // findUpcomingDeadlines
  mockQuery.mockResolvedValueOnce(opts.upcomingDeadlines ?? []);
  // countUnreadNotifications
  const cnt = opts.unreadCount;
  mockQuery.mockResolvedValueOnce(cnt != null ? [{ cnt }] : [{ cnt: 0 }]);
  // getRecentChangesForUser -> project_members
  mockQuery.mockResolvedValueOnce([]);
  // findOverdueActionItems
  mockQuery.mockResolvedValueOnce(opts.actionItems ?? []);
  // findUpcomingMeetings / findActiveSprintSummary skipped when projectIds=[]
}

describe('DigestService', () => {
  let service: DigestService;

  beforeEach(() => {
    service = new DigestService();
    vi.clearAllMocks();
  });

  describe('sendPendingDigests', () => {
    it('sends digest to users with notifications enabled and overdue tasks', async () => {
      const user = makeUser();

      mockQuery.mockResolvedValueOnce([user]); // findEligibleUsers
      mockBuildDigest({ overdueTasks: [{ name: 'Fix bug', end_date: '2026-06-30 00:00:00' }], unreadCount: 2 });
      mockQuery.mockResolvedValueOnce(undefined); // updateLastSent

      const count = await service.sendPendingDigests();

      expect(count).toBe(1);
      expect(mockSendDigestEmail).toHaveBeenCalledTimes(1);
      expect(mockSendDigestEmail).toHaveBeenCalledWith(
        'alice@example.com',
        'Alice Smith',
        expect.objectContaining({
          overdueTasks: [{ name: 'Fix bug', dueDate: '2026-06-30' }],
          upcomingDeadlines: [],
          unreadCount: 2,
        }),
      );
    });

    it('returns 0 and sends no email when no users are found', async () => {
      mockQuery.mockResolvedValueOnce([]); // no users

      const count = await service.sendPendingDigests();

      expect(count).toBe(0);
      expect(mockSendDigestEmail).not.toHaveBeenCalled();
    });

    it('skips users whose digest is not yet due', async () => {
      const recentlySent = makeUser({
        digest_frequency: 'daily',
        digest_last_sent_at: new Date().toISOString(), // sent just now
      });

      mockQuery.mockResolvedValueOnce([recentlySent]);

      const count = await service.sendPendingDigests();

      expect(count).toBe(0);
      expect(mockSendDigestEmail).not.toHaveBeenCalled();
    });

    it('skips sending email but updates timestamp when digest content is empty', async () => {
      const user = makeUser();

      mockQuery.mockResolvedValueOnce([user]); // findEligibleUsers
      mockBuildDigest(); // all empty
      mockQuery.mockResolvedValueOnce(undefined); // updateLastSent

      const count = await service.sendPendingDigests();

      expect(count).toBe(0);
      expect(mockSendDigestEmail).not.toHaveBeenCalled();
    });

    it('continues processing other users when one email send fails', async () => {
      const user1 = makeUser({ id: 'u1', email: 'alice@example.com' });
      const user2 = makeUser({ id: 'u2', username: 'bob', email: 'bob@example.com', full_name: 'Bob Jones' });

      mockQuery.mockResolvedValueOnce([user1, user2]);

      // User 1: has overdue tasks
      mockBuildDigest({ overdueTasks: [{ name: 'Task A', end_date: '2026-06-28 00:00:00' }], unreadCount: 1 });

      // User 2: has upcoming deadlines
      mockBuildDigest({ upcomingDeadlines: [{ name: 'Task B', end_date: '2026-07-05 00:00:00' }] });
      mockQuery.mockResolvedValueOnce(undefined); // updateLastSent for user 2

      // First email fails, second succeeds
      mockSendDigestEmail
        .mockRejectedValueOnce(new Error('SMTP connection refused'))
        .mockResolvedValueOnce(undefined);

      const count = await service.sendPendingDigests();

      expect(count).toBe(1);
      expect(mockSendDigestEmail).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('[DigestService] Failed to send digest'),
        'SMTP connection refused',
      );
    });

    it('sends digest when user has only unread notifications', async () => {
      const user = makeUser();

      mockQuery.mockResolvedValueOnce([user]); // findEligibleUsers
      mockBuildDigest({ unreadCount: 5 });
      mockQuery.mockResolvedValueOnce(undefined); // updateLastSent

      const count = await service.sendPendingDigests();

      expect(count).toBe(1);
      expect(mockSendDigestEmail).toHaveBeenCalledWith(
        'alice@example.com',
        'Alice Smith',
        expect.objectContaining({ unreadCount: 5 }),
      );
    });

    it('uses username as fallback when full_name is empty', async () => {
      const user = makeUser({ full_name: '' });

      mockQuery.mockResolvedValueOnce([user]); // findEligibleUsers
      mockBuildDigest({ overdueTasks: [{ name: 'Overdue task', end_date: '2026-06-25 12:00:00' }] });
      mockQuery.mockResolvedValueOnce(undefined); // updateLastSent

      await service.sendPendingDigests();

      expect(mockSendDigestEmail).toHaveBeenCalledWith(
        'alice@example.com',
        'alice',
        expect.any(Object),
      );
    });

    it('handles weekly digest frequency - due on Monday after 167+ hours', async () => {
      const monday = new Date('2026-07-06T10:00:00Z'); // July 6, 2026 is a Monday
      vi.useFakeTimers();
      vi.setSystemTime(monday);

      const user = makeUser({
        digest_frequency: 'weekly',
        digest_last_sent_at: null,
        digest_preferred_hour: 10, // Match the hour
      });

      mockQuery.mockResolvedValueOnce([user]); // findEligibleUsers
      mockBuildDigest({ overdueTasks: [{ name: 'Weekly task', end_date: '2026-07-01 00:00:00' }] });
      mockQuery.mockResolvedValueOnce(undefined); // updateLastSent

      const count = await service.sendPendingDigests();

      expect(count).toBe(1);

      vi.useRealTimers();
    });

    it('skips weekly digest when day is not Monday', async () => {
      const wednesday = new Date('2026-07-08T10:00:00Z'); // Wednesday
      vi.useFakeTimers();
      vi.setSystemTime(wednesday);

      const user = makeUser({
        digest_frequency: 'weekly',
        digest_last_sent_at: null,
      });

      mockQuery.mockResolvedValueOnce([user]);

      const count = await service.sendPendingDigests();

      expect(count).toBe(0);
      expect(mockSendDigestEmail).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('skips weekly digest on Monday when sent less than 167 hours ago', async () => {
      const monday = new Date('2026-07-06T10:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(monday);

      const lastSent = new Date(monday.getTime() - 100 * 60 * 60 * 1000).toISOString();
      const user = makeUser({
        digest_frequency: 'weekly',
        digest_last_sent_at: lastSent,
        digest_preferred_hour: 10,
      });

      mockQuery.mockResolvedValueOnce([user]);

      const count = await service.sendPendingDigests();

      expect(count).toBe(0);

      vi.useRealTimers();
    });

    it('processes multiple users and counts only successfully sent digests', async () => {
      const users = [
        makeUser({ id: 'u1', email: 'a@test.com', full_name: 'A' }),
        makeUser({ id: 'u2', username: 'b', email: 'b@test.com', full_name: 'B' }),
        makeUser({ id: 'u3', username: 'c', email: 'c@test.com', full_name: 'C' }),
      ];

      mockQuery.mockResolvedValueOnce(users);

      // User 1: has content
      mockBuildDigest({ overdueTasks: [{ name: 'T1', end_date: '2026-06-30 00:00:00' }] });
      mockQuery.mockResolvedValueOnce(undefined); // updateLastSent

      // User 2: empty digest (no content)
      mockBuildDigest();
      mockQuery.mockResolvedValueOnce(undefined); // updateLastSent (still called for empty)

      // User 3: has content
      mockBuildDigest({ upcomingDeadlines: [{ name: 'T3', end_date: '2026-07-06 00:00:00' }], unreadCount: 3 });
      mockQuery.mockResolvedValueOnce(undefined); // updateLastSent

      mockSendDigestEmail.mockResolvedValue(undefined);

      const count = await service.sendPendingDigests();

      expect(count).toBe(2);
      expect(mockSendDigestEmail).toHaveBeenCalledTimes(2);
    });

    it('handles unread count query returning empty array gracefully', async () => {
      const user = makeUser();

      mockQuery.mockResolvedValueOnce([user]); // findEligibleUsers
      // Manually mock: project_members, overdueTasks, upcomingDeadlines, unreadCount (empty array), project_members, actionItems
      mockQuery.mockResolvedValueOnce([]); // project_members
      mockQuery.mockResolvedValueOnce([{ name: 'Task', end_date: '2026-06-30 00:00:00' }]); // overdueTasks
      mockQuery.mockResolvedValueOnce([]); // upcomingDeadlines
      mockQuery.mockResolvedValueOnce([]); // unread count: empty array
      mockQuery.mockResolvedValueOnce([]); // getRecentChanges project_members
      mockQuery.mockResolvedValueOnce([]); // actionItems
      mockQuery.mockResolvedValueOnce(undefined); // updateLastSent

      const count = await service.sendPendingDigests();

      expect(count).toBe(1);
      expect(mockSendDigestEmail).toHaveBeenCalledWith(
        'alice@example.com',
        'Alice Smith',
        expect.objectContaining({ unreadCount: 0 }),
      );
    });
  });
});
