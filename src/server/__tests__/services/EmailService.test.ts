import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks (must be before imports) ---

vi.mock('../../config', () => ({
  config: {
    RESEND_API_KEY: 'test-resend-key',
    RESEND_FROM_EMAIL: 'noreply@kovarti.com',
    APP_URL: 'https://pm.kpbc.ca',
  },
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskPii: vi.fn((v: string) => '***masked***'),
}));

vi.mock('../../services/RedisService', () => ({
  redisService: {
    isConnected: vi.fn().mockReturnValue(false),
    getClient: vi.fn().mockReturnValue({
      incr: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
    }),
    get: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: vi.fn() },
    domains: { list: vi.fn() },
  })),
}));

// --- Imports (after mocks) ---

import { EmailService } from '../../services/EmailService';
import { config } from '../../config';
import logger from '../../utils/logger';
import { redisService } from '../../services/RedisService';

// --- Helpers ---

function createService(): EmailService {
  return new EmailService();
}

function successResult() {
  return { data: { id: 'email-id-123' }, error: null };
}

function errorResult(message = 'Bad request') {
  return { data: null, error: { message } };
}

/** Get the mocked emails.send function from a service's internal Resend client */
function getMockSend(svc: EmailService): ReturnType<typeof vi.fn> {
  const client = (svc as any).getClient();
  return client.emails.send;
}

/** Get the mocked Redis incr function */
function getMockIncr(): ReturnType<typeof vi.fn> {
  return (redisService.getClient() as any).incr;
}

// --- Tests ---

describe('EmailService', () => {
  let service: EmailService;
  let mockSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    (redisService.isConnected as any).mockReturnValue(false);
    service = createService();
    mockSend = getMockSend(service);
    mockSend.mockResolvedValue(successResult());
  });

  // =========================================================================
  // getClient / isConfigured
  // =========================================================================

  describe('getClient', () => {
    it('throws when RESEND_API_KEY is empty', () => {
      const origKey = (config as any).RESEND_API_KEY;
      (config as any).RESEND_API_KEY = '';
      const svc = createService();
      expect(() => (svc as any).getClient()).toThrow('RESEND_API_KEY is not configured');
      (config as any).RESEND_API_KEY = origKey;
    });

    it('creates Resend client on first call and reuses it', () => {
      const svc = createService();
      const client1 = (svc as any).getClient();
      const client2 = (svc as any).getClient();
      // Resend constructor called once for this instance
      expect(client1).toBe(client2);
    });
  });

  // =========================================================================
  // sendEmail (private, tested through public methods)
  // =========================================================================

  describe('sendEmail (via sendVerificationEmail)', () => {
    it('sends email successfully and tracks success', async () => {
      await service.sendVerificationEmail('user@test.com', 'token123');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const callArgs = mockSend.mock.calls[0][0];
      expect(callArgs.from).toBe('noreply@kovarti.com');
      expect(callArgs.to).toBe('user@test.com');
      expect(callArgs.subject).toBe('Verify your Kovarti PM Assistant account');
      expect(callArgs.html).toContain('token123');

      const stats = service.getStats();
      expect(stats.sent).toBe(1);
      expect(stats.failed).toBe(0);
    });

    it('tracks failure when Resend API returns error object', async () => {
      mockSend.mockResolvedValueOnce(errorResult('Invalid API key'));

      await expect(service.sendVerificationEmail('user@test.com', 'tok'))
        .rejects.toThrow('Resend API error: Invalid API key');

      const stats = service.getStats();
      // trackSend(false) called twice: once inside the if(result.error) block, once in the catch
      expect(stats.failed).toBeGreaterThanOrEqual(1);
    });

    it('tracks failure when send throws an exception', async () => {
      mockSend.mockRejectedValueOnce(new Error('Network failure'));

      await expect(service.sendVerificationEmail('user@test.com', 'tok'))
        .rejects.toThrow('Network failure');

      const stats = service.getStats();
      expect(stats.failed).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // trackSend + Redis integration
  // =========================================================================

  describe('trackSend', () => {
    it('increments Redis counters when connected', async () => {
      (redisService.isConnected as any).mockReturnValue(true);
      const mockIncr = getMockIncr();

      await service.sendVerificationEmail('user@test.com', 'tok');

      expect(mockIncr).toHaveBeenCalled();
      const incrKey = mockIncr.mock.calls[0][0];
      expect(incrKey).toMatch(/^email:sent:\d{4}-\d{2}$/);
    });

    it('does not call Redis when disconnected', async () => {
      (redisService.isConnected as any).mockReturnValue(false);
      const mockIncr = getMockIncr();

      await service.sendVerificationEmail('user@test.com', 'tok');

      expect(mockIncr).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // getStats
  // =========================================================================

  describe('getStats', () => {
    it('returns zero counts for new instance', () => {
      expect(service.getStats()).toEqual({ sent: 0, failed: 0 });
    });

    it('accumulates sent and failed counts', async () => {
      // 2 successes
      await service.sendVerificationEmail('a@t.com', 't1');
      await service.sendVerificationEmail('b@t.com', 't2');
      // 1 failure
      mockSend.mockRejectedValueOnce(new Error('fail'));
      await service.sendVerificationEmail('c@t.com', 't3').catch(() => {});

      const stats = service.getStats();
      expect(stats.sent).toBe(2);
      expect(stats.failed).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // getMonthlyStats (static)
  // =========================================================================

  describe('getMonthlyStats', () => {
    it('returns zeros when Redis is disconnected', async () => {
      (redisService.isConnected as any).mockReturnValue(false);
      const stats = await EmailService.getMonthlyStats();
      expect(stats).toEqual({ sent: 0, failed: 0 });
    });

    it('parses Redis values when connected', async () => {
      (redisService.isConnected as any).mockReturnValue(true);
      (redisService.get as any)
        .mockResolvedValueOnce('42')
        .mockResolvedValueOnce('3');

      const stats = await EmailService.getMonthlyStats();
      expect(stats).toEqual({ sent: 42, failed: 3 });
    });

    it('handles null Redis values as zero', async () => {
      (redisService.isConnected as any).mockReturnValue(true);
      (redisService.get as any)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const stats = await EmailService.getMonthlyStats();
      expect(stats).toEqual({ sent: 0, failed: 0 });
    });
  });

  // =========================================================================
  // verifyConnection
  // =========================================================================

  describe('verifyConnection', () => {
    it('logs warning and returns when API key not set', async () => {
      const origKey = (config as any).RESEND_API_KEY;
      (config as any).RESEND_API_KEY = '';
      const svc = createService();

      await svc.verifyConnection();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('RESEND_API_KEY not set'),
      );
      (config as any).RESEND_API_KEY = origKey;
    });

    it('logs success when domains list succeeds', async () => {
      const svc = createService();
      const mockClient = (svc as any).getClient();
      mockClient.domains = {
        list: vi.fn().mockResolvedValue({
          data: { data: [{ name: 'kovarti.com' }] },
          error: null,
        }),
      };

      await svc.verifyConnection();

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Resend connection verified'),
      );
    });

    it('logs error when domains list returns error', async () => {
      const svc = createService();
      const mockClient = (svc as any).getClient();
      mockClient.domains = {
        list: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Unauthorized' },
        }),
      };

      await svc.verifyConnection();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('RESEND API KEY IS INVALID'),
      );
    });

    it('logs error when domains list throws', async () => {
      const svc = createService();
      const mockClient = (svc as any).getClient();
      mockClient.domains = {
        list: vi.fn().mockRejectedValue(new Error('Connection refused')),
      };

      await svc.verifyConnection();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('RESEND CONNECTION FAILED'),
      );
    });
  });

  // =========================================================================
  // sendVerificationEmail
  // =========================================================================

  describe('sendVerificationEmail', () => {
    it('skips sending when not configured', async () => {
      const origKey = (config as any).RESEND_API_KEY;
      (config as any).RESEND_API_KEY = '';
      const svc = createService();

      await svc.sendVerificationEmail('user@test.com', 'tok');

      expect(mockSend).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('skipping verification email'),
      );
      (config as any).RESEND_API_KEY = origKey;
    });

    it('builds correct verification URL', async () => {
      await service.sendVerificationEmail('user@test.com', 'abc123');

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('https://pm.kpbc.ca/verify-email?token=abc123');
    });
  });

  // =========================================================================
  // sendPasswordResetEmail
  // =========================================================================

  describe('sendPasswordResetEmail', () => {
    it('skips sending when not configured', async () => {
      const origKey = (config as any).RESEND_API_KEY;
      (config as any).RESEND_API_KEY = '';
      const svc = createService();

      await svc.sendPasswordResetEmail('user@test.com', 'tok');

      expect(mockSend).not.toHaveBeenCalled();
      (config as any).RESEND_API_KEY = origKey;
    });

    it('builds correct reset URL and subject', async () => {
      await service.sendPasswordResetEmail('user@test.com', 'resetTok');

      const args = mockSend.mock.calls[0][0];
      expect(args.subject).toBe('Reset your Kovarti PM Assistant password');
      expect(args.html).toContain('https://pm.kpbc.ca/reset-password?token=resetTok');
      expect(args.html).toContain('expires in 1 hour');
    });
  });

  // =========================================================================
  // sendNotificationEmail
  // =========================================================================

  describe('sendNotificationEmail', () => {
    it('skips sending when not configured', async () => {
      const origKey = (config as any).RESEND_API_KEY;
      (config as any).RESEND_API_KEY = '';
      const svc = createService();

      await svc.sendNotificationEmail('user@test.com', 'Subj', 'Title', 'Msg');

      expect(mockSend).not.toHaveBeenCalled();
      (config as any).RESEND_API_KEY = origKey;
    });

    it('sends notification without CTA', async () => {
      await service.sendNotificationEmail('user@test.com', 'Test Subject', 'Test Title', 'Hello world');

      const args = mockSend.mock.calls[0][0];
      expect(args.subject).toBe('Test Subject');
      expect(args.html).toContain('Hello world');
      expect(args.html).not.toContain('View Details');
    });

    it('sends notification with CTA button', async () => {
      await service.sendNotificationEmail(
        'user@test.com', 'Subj', 'Title', 'Msg',
        'https://pm.kpbc.ca/tasks/1', 'Open Task',
      );

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('https://pm.kpbc.ca/tasks/1');
      expect(html).toContain('Open Task');
    });

    it('uses default CTA label when not provided', async () => {
      await service.sendNotificationEmail(
        'user@test.com', 'Subj', 'Title', 'Msg',
        'https://pm.kpbc.ca/tasks/1',
      );

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('View Details');
    });

    it('escapes HTML in message and title', async () => {
      await service.sendNotificationEmail(
        'user@test.com', 'Subj', '<script>alert("x")</script>',
        'Hello <b>world</b>',
      );

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('&lt;script&gt;');
      expect(html).toContain('&lt;b&gt;world&lt;/b&gt;');
      expect(html).not.toContain('<script>');
    });
  });

  // =========================================================================
  // sendDigestEmail
  // =========================================================================

  describe('sendDigestEmail', () => {
    const minDigest = {
      overdueTasks: [],
      upcomingDeadlines: [],
      unreadCount: 0,
      recentChanges: [] as any,
    };

    it('skips sending when not configured', async () => {
      const origKey = (config as any).RESEND_API_KEY;
      (config as any).RESEND_API_KEY = '';
      const svc = createService();

      await svc.sendDigestEmail('user@test.com', 'Alice', minDigest);

      expect(mockSend).not.toHaveBeenCalled();
      (config as any).RESEND_API_KEY = origKey;
    });

    it('sends minimal digest with no sections', async () => {
      await service.sendDigestEmail('user@test.com', 'Alice', minDigest);

      const args = mockSend.mock.calls[0][0];
      expect(args.subject).toContain('Digest');
      expect(args.html).toContain('Hi Alice');
      expect(args.html).toContain('Open Dashboard');
    });

    it('renders overdue tasks section', async () => {
      await service.sendDigestEmail('user@test.com', 'Bob', {
        ...minDigest,
        overdueTasks: [{ name: 'Fix bug', dueDate: '2026-09-01' }],
      });

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('Overdue Tasks (1)');
      expect(html).toContain('Fix bug');
      expect(html).toContain('2026-09-01');
    });

    it('renders upcoming deadlines section', async () => {
      await service.sendDigestEmail('user@test.com', 'Bob', {
        ...minDigest,
        upcomingDeadlines: [{ name: 'Deploy v2', dueDate: '2026-09-15' }],
      });

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('Upcoming Deadlines (1)');
      expect(html).toContain('Deploy v2');
    });

    it('renders action items section', async () => {
      await service.sendDigestEmail('user@test.com', 'Bob', {
        ...minDigest,
        actionItems: [{ title: 'Review PR', dueDate: '2026-09-10', meetingTitle: 'Sprint Planning' }],
      });

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('Overdue Action Items (1)');
      expect(html).toContain('Review PR');
      expect(html).toContain('Sprint Planning');
    });

    it('renders upcoming meetings section', async () => {
      await service.sendDigestEmail('user@test.com', 'Bob', {
        ...minDigest,
        upcomingMeetings: [{ title: 'Standup', scheduledDate: '2026-09-14', meetingType: 'daily_standup' }],
      });

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('Upcoming Meetings (1)');
      expect(html).toContain('Standup');
      expect(html).toContain('daily standup');
    });

    it('renders active sprints with progress bar', async () => {
      await service.sendDigestEmail('user@test.com', 'Bob', {
        ...minDigest,
        activeSprints: [{ name: 'Sprint 5', pending: 2, inProgress: 3, completed: 5, total: 10 }],
      });

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('Active Sprints');
      expect(html).toContain('Sprint 5');
      expect(html).toContain('50%');
    });

    it('renders recent changes grouped by category', async () => {
      await service.sendDigestEmail('user@test.com', 'Bob', {
        ...minDigest,
        recentChanges: [
          { category: 'Tasks', action: 'created', count: 3 },
          { category: 'Tasks', action: 'completed', count: 2 },
        ],
      });

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('Recent Activity');
      expect(html).toContain('Tasks');
      expect(html).toContain('5 changes');
    });

    it('handles recentChanges as number (legacy format)', async () => {
      await service.sendDigestEmail('user@test.com', 'Bob', {
        ...minDigest,
        recentChanges: 7,
      });

      // Should not crash; recentChanges: number results in empty changes array
      const html = mockSend.mock.calls[0][0].html;
      expect(html).not.toContain('Recent Activity');
    });

    it('renders unread count notification', async () => {
      await service.sendDigestEmail('user@test.com', 'Bob', {
        ...minDigest,
        unreadCount: 5,
      });

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('5');
      expect(html).toContain('unread notifications');
    });

    it('uses singular "notification" for unreadCount of 1', async () => {
      await service.sendDigestEmail('user@test.com', 'Bob', {
        ...minDigest,
        unreadCount: 1,
      });

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('1');
      expect(html).not.toContain('notifications');
    });

    it('limits overdue tasks to 10 items', async () => {
      const overdueTasks = Array.from({ length: 15 }, (_, i) => ({
        name: `Task ${i + 1}`,
        dueDate: '2026-09-01',
      }));

      await service.sendDigestEmail('user@test.com', 'Bob', {
        ...minDigest,
        overdueTasks,
      });

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('Task 10');
      expect(html).not.toContain('Task 11');
    });
  });

  // =========================================================================
  // sendReportEmail
  // =========================================================================

  describe('sendReportEmail', () => {
    it('skips sending when not configured', async () => {
      const origKey = (config as any).RESEND_API_KEY;
      (config as any).RESEND_API_KEY = '';
      const svc = createService();

      await svc.sendReportEmail(['a@t.com'], 'My Report', 'col1,col2\n1,2');

      expect(mockSend).not.toHaveBeenCalled();
      (config as any).RESEND_API_KEY = origKey;
    });

    it('sends report with CSV attachment', async () => {
      await service.sendReportEmail(['a@t.com', 'b@t.com'], 'Weekly Tasks', 'id,name\n1,Fix');

      const args = mockSend.mock.calls[0][0];
      expect(args.to).toEqual(['a@t.com', 'b@t.com']);
      expect(args.subject).toBe('Scheduled Report: Weekly Tasks');
      expect(args.attachments).toHaveLength(1);
      expect(args.attachments[0].filename).toBe('Weekly_Tasks.csv');
      expect(args.attachments[0].content).toBe(
        Buffer.from('id,name\n1,Fix').toString('base64'),
      );
    });

    it('sanitizes filename for special characters', async () => {
      await service.sendReportEmail(['a@t.com'], 'My Report: Q3/2026!', 'data');

      const filename = mockSend.mock.calls[0][0].attachments[0].filename;
      expect(filename).toBe('My_Report__Q3_2026_.csv');
      expect(filename).not.toMatch(/[/:!]/);
    });
  });

  // =========================================================================
  // sendStatusReportEmail
  // =========================================================================

  describe('sendStatusReportEmail', () => {
    it('skips sending when not configured', async () => {
      const origKey = (config as any).RESEND_API_KEY;
      (config as any).RESEND_API_KEY = '';
      const svc = createService();

      await svc.sendStatusReportEmail(['a@t.com'], 'Project X', '<p>Report</p>');

      expect(mockSend).not.toHaveBeenCalled();
      (config as any).RESEND_API_KEY = origKey;
    });

    it('sends status report with project name in subject', async () => {
      await service.sendStatusReportEmail(['a@t.com'], 'Alpha Project', '<p>Good progress</p>');

      const args = mockSend.mock.calls[0][0];
      expect(args.subject).toContain('Status Report: Alpha Project');
      expect(args.html).toContain('Good progress');
      expect(args.html).toContain('Open Dashboard');
    });
  });

  // =========================================================================
  // sendRAIDReportEmail
  // =========================================================================

  describe('sendRAIDReportEmail', () => {
    it('skips sending when not configured', async () => {
      const origKey = (config as any).RESEND_API_KEY;
      (config as any).RESEND_API_KEY = '';
      const svc = createService();

      await svc.sendRAIDReportEmail(['a@t.com'], 'Project X', '<p>RAID</p>');

      expect(mockSend).not.toHaveBeenCalled();
      (config as any).RESEND_API_KEY = origKey;
    });

    it('sends RAID report with correct subject', async () => {
      await service.sendRAIDReportEmail(['a@t.com'], 'Beta', '<div>Risks listed</div>');

      const args = mockSend.mock.calls[0][0];
      expect(args.subject).toContain('RAID Report: Beta');
      expect(args.html).toContain('Risks listed');
    });
  });

  // =========================================================================
  // sendStandupEmail
  // =========================================================================

  describe('sendStandupEmail', () => {
    it('skips sending when not configured', async () => {
      const origKey = (config as any).RESEND_API_KEY;
      (config as any).RESEND_API_KEY = '';
      const svc = createService();

      await svc.sendStandupEmail('user@t.com', {}, null);

      expect(mockSend).not.toHaveBeenCalled();
      (config as any).RESEND_API_KEY = origKey;
    });

    it('sends standup with all change sections', async () => {
      const changes = {
        completions: [{ taskName: 'Task A', completedBy: 'Alice' }],
        statusChanges: [{ taskName: 'Task B', fromStatus: 'todo', toStatus: 'in_progress' }],
        newTasks: [{ taskName: 'Task C' }],
        newRisks: [{ title: 'Risk 1', severity: 'high' }],
        blockers: [{ taskName: 'Task D' }],
      };

      await service.sendStandupEmail('user@t.com', changes, null);

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('Completed (1)');
      expect(html).toContain('Task A');
      expect(html).toContain('Status Changes (1)');
      expect(html).toContain('todo');
      expect(html).toContain('New Tasks (1)');
      expect(html).toContain('New Risks (1)');
      expect(html).toContain('Blockers (1)');
    });

    it('includes narrative when provided', async () => {
      await service.sendStandupEmail('user@t.com', {}, 'Everything is on track.');

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('Everything is on track.');
    });

    it('shows fallback message when no changes', async () => {
      await service.sendStandupEmail('user@t.com', {}, null);

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('No notable changes yesterday.');
    });

    it('limits items to 15 per section', async () => {
      const completions = Array.from({ length: 20 }, (_, i) => ({
        taskName: `Task ${i + 1}`, completedBy: 'Test',
      }));

      await service.sendStandupEmail('user@t.com', { completions }, null);

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('Task 15');
      expect(html).not.toContain('Task 16');
    });
  });

  // =========================================================================
  // sendLoginVerificationEmail
  // =========================================================================

  describe('sendLoginVerificationEmail', () => {
    it('skips sending when not configured', async () => {
      const origKey = (config as any).RESEND_API_KEY;
      (config as any).RESEND_API_KEY = '';
      const svc = createService();

      await svc.sendLoginVerificationEmail('u@t.com', 'tok', 'Alice');

      expect(mockSend).not.toHaveBeenCalled();
      (config as any).RESEND_API_KEY = origKey;
    });

    it('sends login verification with correct URL and username', async () => {
      await service.sendLoginVerificationEmail('u@t.com', 'loginTok', 'Bob');

      const args = mockSend.mock.calls[0][0];
      expect(args.subject).toBe('Confirm your Kovarti PM login');
      expect(args.html).toContain('https://pm.kpbc.ca/api/v1/auth/verify-login?token=loginTok');
      expect(args.html).toContain('Bob');
      expect(args.html).toContain('expires in 10 minutes');
    });
  });

  // =========================================================================
  // sendWelcomeEmail
  // =========================================================================

  describe('sendWelcomeEmail', () => {
    it('skips sending when not configured', async () => {
      const origKey = (config as any).RESEND_API_KEY;
      (config as any).RESEND_API_KEY = '';
      const svc = createService();

      await svc.sendWelcomeEmail('u@t.com', 'Alice');

      expect(mockSend).not.toHaveBeenCalled();
      (config as any).RESEND_API_KEY = origKey;
    });

    it('sends welcome email with name and login link', async () => {
      await service.sendWelcomeEmail('u@t.com', 'Charlie');

      const args = mockSend.mock.calls[0][0];
      expect(args.subject).toBe('Welcome to Kovarti PM Assistant!');
      expect(args.html).toContain('Welcome, Charlie!');
      expect(args.html).toContain('https://pm.kpbc.ca/login');
    });

    it('escapes HTML in name', async () => {
      await service.sendWelcomeEmail('u@t.com', '<img src=x>');

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('&lt;img src=x&gt;');
      expect(html).not.toContain('<img src=x>');
    });
  });

  // =========================================================================
  // sendTrialReminderEmail
  // =========================================================================

  describe('sendTrialReminderEmail', () => {
    it('skips sending when not configured', async () => {
      const origKey = (config as any).RESEND_API_KEY;
      (config as any).RESEND_API_KEY = '';
      const svc = createService();

      await svc.sendTrialReminderEmail('u@t.com', 'Alice', 3);

      expect(mockSend).not.toHaveBeenCalled();
      (config as any).RESEND_API_KEY = origKey;
    });

    it('uses "tomorrow" wording when 1 day left', async () => {
      await service.sendTrialReminderEmail('u@t.com', 'Alice', 1);

      const args = mockSend.mock.calls[0][0];
      expect(args.subject).toBe('Your Kovarti PM trial ends tomorrow');
      expect(args.html).toContain('tomorrow');
    });

    it('uses "in N days" wording for multiple days', async () => {
      await service.sendTrialReminderEmail('u@t.com', 'Alice', 5);

      const args = mockSend.mock.calls[0][0];
      expect(args.subject).toBe('Your Kovarti PM trial ends in 5 days');
      expect(args.html).toContain('in 5 days');
    });

    it('includes pricing page link', async () => {
      await service.sendTrialReminderEmail('u@t.com', 'Alice', 3);

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('https://pm.kpbc.ca/pricing');
    });
  });

  // =========================================================================
  // sendTrialExpiredEmail
  // =========================================================================

  describe('sendTrialExpiredEmail', () => {
    it('skips sending when not configured', async () => {
      const origKey = (config as any).RESEND_API_KEY;
      (config as any).RESEND_API_KEY = '';
      const svc = createService();

      await svc.sendTrialExpiredEmail('u@t.com', 'Alice');

      expect(mockSend).not.toHaveBeenCalled();
      (config as any).RESEND_API_KEY = origKey;
    });

    it('sends trial expired email with correct content', async () => {
      await service.sendTrialExpiredEmail('u@t.com', 'Alice');

      const args = mockSend.mock.calls[0][0];
      expect(args.subject).toBe('Your Kovarti PM trial has ended');
      expect(args.html).toContain('read-only mode');
      expect(args.html).toContain('https://pm.kpbc.ca/pricing');
    });
  });

  // =========================================================================
  // sendProjectInviteEmail
  // =========================================================================

  describe('sendProjectInviteEmail', () => {
    const baseParams = {
      projectName: 'Alpha',
      projectId: 'proj-1',
      inviterName: 'Alice',
      role: 'editor',
      isRegistered: true,
    };

    it('skips sending when not configured', async () => {
      const origKey = (config as any).RESEND_API_KEY;
      (config as any).RESEND_API_KEY = '';
      const svc = createService();

      await svc.sendProjectInviteEmail('u@t.com', baseParams);

      expect(mockSend).not.toHaveBeenCalled();
      (config as any).RESEND_API_KEY = origKey;
    });

    it('links to project for registered users', async () => {
      await service.sendProjectInviteEmail('u@t.com', { ...baseParams, isRegistered: true });

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('https://pm.kpbc.ca/projects/proj-1');
      expect(html).toContain('View Project');
    });

    it('links to register for unregistered users', async () => {
      await service.sendProjectInviteEmail('u@t.com', { ...baseParams, isRegistered: false });

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('https://pm.kpbc.ca/register');
      expect(html).toContain('Create Account');
    });

    it('includes inviter name, project name, and role', async () => {
      await service.sendProjectInviteEmail('u@t.com', baseParams);

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('Alice');
      expect(html).toContain('Alpha');
      expect(html).toContain('editor');
    });
  });

  // =========================================================================
  // sendResourceInviteEmail
  // =========================================================================

  describe('sendResourceInviteEmail', () => {
    const baseParams = {
      resourceName: 'Bob',
      role: 'developer',
      inviterName: 'Alice',
      isRegistered: true,
    };

    it('skips sending when not configured', async () => {
      const origKey = (config as any).RESEND_API_KEY;
      (config as any).RESEND_API_KEY = '';
      const svc = createService();

      await svc.sendResourceInviteEmail('u@t.com', baseParams);

      expect(mockSend).not.toHaveBeenCalled();
      (config as any).RESEND_API_KEY = origKey;
    });

    it('links to login for registered users', async () => {
      await service.sendResourceInviteEmail('u@t.com', { ...baseParams, isRegistered: true });

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('https://pm.kpbc.ca/login');
      expect(html).toContain('Log In');
    });

    it('links to register with invite token for unregistered users', async () => {
      await service.sendResourceInviteEmail('u@t.com', {
        ...baseParams,
        isRegistered: false,
        inviteToken: 'inv-tok-123',
      });

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('https://pm.kpbc.ca/register?invite=inv-tok-123');
      expect(html).toContain('Create Account');
    });

    it('links to register without token when none provided', async () => {
      await service.sendResourceInviteEmail('u@t.com', {
        ...baseParams,
        isRegistered: false,
      });

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('https://pm.kpbc.ca/register');
      expect(html).not.toContain('invite=');
    });
  });

  // =========================================================================
  // sendViewerInviteEmail
  // =========================================================================

  describe('sendViewerInviteEmail', () => {
    it('skips sending when not configured', async () => {
      const origKey = (config as any).RESEND_API_KEY;
      (config as any).RESEND_API_KEY = '';
      const svc = createService();

      await svc.sendViewerInviteEmail('u@t.com', 'Org', 'Alice', null, 'tok');

      expect(mockSend).not.toHaveBeenCalled();
      (config as any).RESEND_API_KEY = origKey;
    });

    it('includes project name when provided', async () => {
      await service.sendViewerInviteEmail('u@t.com', 'MyOrg', 'Alice', 'Project X', 'tok');

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('Project X');
      expect(html).toContain('MyOrg');
    });

    it('omits project line when project name is null', async () => {
      await service.sendViewerInviteEmail('u@t.com', 'MyOrg', 'Alice', null, 'tok');

      const html = mockSend.mock.calls[0][0].html;
      expect(html).not.toContain('You&#39;ll have access to the project');
    });

    it('builds invite register URL with token', async () => {
      await service.sendViewerInviteEmail('u@t.com', 'MyOrg', 'Alice', null, 'abc123');

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('https://pm.kpbc.ca/register?invite=abc123');
    });
  });

  // =========================================================================
  // sendApprovalActionEmail
  // =========================================================================

  describe('sendApprovalActionEmail', () => {
    it('skips sending when not configured', async () => {
      const origKey = (config as any).RESEND_API_KEY;
      (config as any).RESEND_API_KEY = '';
      const svc = createService();

      await svc.sendApprovalActionEmail('u@t.com', 'CR-1', 'approved', 'Review');

      expect(mockSend).not.toHaveBeenCalled();
      (config as any).RESEND_API_KEY = origKey;
    });

    it('sends approved action with green color', async () => {
      await service.sendApprovalActionEmail('u@t.com', 'Add feature X', 'approved', 'Legal Review');

      const args = mockSend.mock.calls[0][0];
      expect(args.subject).toContain('Change Request Approved');
      expect(args.html).toContain('#059669');
      expect(args.html).toContain('Add feature X');
      expect(args.html).toContain('Legal Review');
    });

    it('sends rejected action with red color', async () => {
      await service.sendApprovalActionEmail('u@t.com', 'CR-2', 'rejected', 'PM Review');

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('#dc2626');
      expect(html).toContain('Rejected');
    });

    it('includes reviewer comment when provided', async () => {
      await service.sendApprovalActionEmail('u@t.com', 'CR-3', 'approved', 'Step 1', 'Looks good!');

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('Looks good!');
      expect(html).toContain('Reviewer comment');
    });

    it('includes CTA button when URL provided', async () => {
      await service.sendApprovalActionEmail(
        'u@t.com', 'CR-4', 'approved', 'Step 1',
        undefined, 'https://pm.kpbc.ca/cr/4',
      );

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('https://pm.kpbc.ca/cr/4');
      expect(html).toContain('View Change Request');
    });

    it('omits CTA button when no URL', async () => {
      await service.sendApprovalActionEmail('u@t.com', 'CR-5', 'approved', 'Step 1');

      const html = mockSend.mock.calls[0][0].html;
      expect(html).not.toContain('View Change Request');
    });
  });

  // =========================================================================
  // sendMeetingMinutes
  // =========================================================================

  describe('sendMeetingMinutes', () => {
    it('skips sending when not configured', async () => {
      const origKey = (config as any).RESEND_API_KEY;
      (config as any).RESEND_API_KEY = '';
      const svc = createService();

      await svc.sendMeetingMinutes(['a@t.com'], 'Sprint Retro', '2026-09-10', 'Summary', [], [], []);

      expect(mockSend).not.toHaveBeenCalled();
      (config as any).RESEND_API_KEY = origKey;
    });

    it('sends meeting minutes with all sections', async () => {
      const actionItems = [
        { description: 'Update docs', assignee: 'Alice', dueDate: '2026-09-15', priority: 'high' },
      ];
      const decisions = [
        { decision: 'Use React', madeBy: 'Bob' },
      ];
      const attendees = ['Alice', 'Bob', 'Charlie'];

      await service.sendMeetingMinutes(
        ['a@t.com', 'b@t.com'],
        'Sprint Planning',
        '2026-09-10',
        'Good meeting overall.',
        actionItems,
        decisions,
        attendees,
      );

      const args = mockSend.mock.calls[0][0];
      expect(args.subject).toContain('Meeting Minutes: Sprint Planning');
      expect(args.to).toEqual(['a@t.com', 'b@t.com']);

      const html = args.html;
      expect(html).toContain('2026-09-10');
      expect(html).toContain('Alice');
      expect(html).toContain('Good meeting overall.');
      expect(html).toContain('Action Items (1)');
      expect(html).toContain('Update docs');
      expect(html).toContain('Decisions (1)');
      expect(html).toContain('Use React');
      expect(html).toContain('Bob');
    });

    it('omits action items section when empty', async () => {
      await service.sendMeetingMinutes(
        ['a@t.com'], 'Retro', '2026-09-10', 'Summary', [], [], ['Alice'],
      );

      const html = mockSend.mock.calls[0][0].html;
      expect(html).not.toContain('Action Items');
    });

    it('omits decisions section when empty', async () => {
      await service.sendMeetingMinutes(
        ['a@t.com'], 'Retro', '2026-09-10', 'Summary', [], [], ['Alice'],
      );

      const html = mockSend.mock.calls[0][0].html;
      expect(html).not.toContain('Decisions');
    });

    it('handles action item without due date', async () => {
      const actionItems = [
        { description: 'TBD task', assignee: 'Alice', priority: 'low' },
      ] as any;

      await service.sendMeetingMinutes(
        ['a@t.com'], 'Retro', '2026-09-10', 'Sum', actionItems, [], ['Alice'],
      );

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('TBD task');
      // The "-" fallback for missing dueDate
      expect(html).toContain('>-<');
    });

    it('handles decision without madeBy', async () => {
      const decisions = [{ decision: 'Go with plan B' }] as any;

      await service.sendMeetingMinutes(
        ['a@t.com'], 'Retro', '2026-09-10', 'Sum', [], decisions, ['Alice'],
      );

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('Go with plan B');
    });
  });

  // =========================================================================
  // sendOrgInviteEmail
  // =========================================================================

  describe('sendOrgInviteEmail', () => {
    it('skips sending when not configured', async () => {
      const origKey = (config as any).RESEND_API_KEY;
      (config as any).RESEND_API_KEY = '';
      const svc = createService();

      await svc.sendOrgInviteEmail('u@t.com', 'Acme Corp', 'Alice');

      expect(mockSend).not.toHaveBeenCalled();
      (config as any).RESEND_API_KEY = origKey;
    });

    it('sends org invite with correct content', async () => {
      await service.sendOrgInviteEmail('u@t.com', 'Acme Corp', 'Alice');

      const args = mockSend.mock.calls[0][0];
      expect(args.subject).toContain('Acme Corp');
      expect(args.html).toContain('Alice');
      expect(args.html).toContain('Acme Corp');
      expect(args.html).toContain('https://pm.kpbc.ca/register');
    });
  });

  // =========================================================================
  // sendWaitlistNotification
  // =========================================================================

  describe('sendWaitlistNotification', () => {
    it('skips sending when not configured', async () => {
      const origKey = (config as any).RESEND_API_KEY;
      (config as any).RESEND_API_KEY = '';
      const svc = createService();

      await svc.sendWaitlistNotification('sub@test.com');

      expect(mockSend).not.toHaveBeenCalled();
      (config as any).RESEND_API_KEY = origKey;
    });

    it('sends waitlist notification to sales email', async () => {
      await service.sendWaitlistNotification('sub@test.com');

      const args = mockSend.mock.calls[0][0];
      expect(args.to).toBe('sales@kovarti.com');
      expect(args.subject).toContain('sub@test.com');
      expect(args.html).toContain('sub@test.com');
    });
  });

  // =========================================================================
  // sendLaunchAnnouncementEmail
  // =========================================================================

  describe('sendLaunchAnnouncementEmail', () => {
    it('skips sending when not configured', async () => {
      const origKey = (config as any).RESEND_API_KEY;
      (config as any).RESEND_API_KEY = '';
      const svc = createService();

      await svc.sendLaunchAnnouncementEmail('u@t.com');

      expect(mockSend).not.toHaveBeenCalled();
      (config as any).RESEND_API_KEY = origKey;
    });

    it('sends launch announcement with correct content', async () => {
      await service.sendLaunchAnnouncementEmail('u@t.com');

      const args = mockSend.mock.calls[0][0];
      expect(args.subject).toContain('Kovarti PM is Live');
      expect(args.html).toContain('14-day free trial');
      expect(args.html).toContain('20% off');
      expect(args.html).toContain('https://pm.kpbc.ca/register');
    });
  });

  // =========================================================================
  // wrapHtml (tested indirectly through sendNotificationEmail)
  // =========================================================================

  describe('wrapHtml', () => {
    it('escapes the title parameter', async () => {
      await service.sendNotificationEmail(
        'u@t.com', 'Subj', '<script>xss</script>', 'body text',
      );

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('&lt;script&gt;xss&lt;/script&gt;');
    });

    it('wraps body with Kovarti branding and footer', async () => {
      await service.sendNotificationEmail('u@t.com', 'Subj', 'Title', 'Body content');

      const html = mockSend.mock.calls[0][0].html;
      expect(html).toContain('Kovarti PM Assistant');
      expect(html).toContain('AI-Powered Project Management');
    });
  });
});
