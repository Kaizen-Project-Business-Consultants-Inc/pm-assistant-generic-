import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing
vi.mock('../../services/claudeService', () => {
  const mockComplete = vi.fn();
  const mockIsAvailable = vi.fn();
  return {
    claudeService: {
      complete: mockComplete,
      isAvailable: mockIsAvailable,
    },
    promptTemplates: {
      statusReport: {
        render: vi.fn((vars: Record<string, string>) => `System prompt with ${vars.projectData}`),
      },
    },
  };
});

vi.mock('../../services/aiContextBuilder', () => ({
  AIContextBuilder: vi.fn().mockImplementation(() => ({
    buildProjectContext: vi.fn().mockResolvedValue({
      project: { name: 'Test Project', projectType: 'software' },
      schedules: [],
    }),
    buildStatusReportContext: vi.fn().mockResolvedValue({
      projectContext: { project: { name: 'Test Project', projectType: 'software' }, schedules: [] },
      promptString: 'Project: Test Project\nType: software',
      milestones: [],
      completedTasks: [],
      upcomingTasks: [],
      raidItems: [],
      criticalHighItems: [],
      changeRequests: [],
    }),
    toPromptString: vi.fn().mockReturnValue('Project: Test Project\nType: software'),
  })),
}));

vi.mock('../../services/EmailService', () => ({
  emailService: {
    sendStatusReportEmail: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/UserService', () => ({
  userService: {
    findById: vi.fn().mockResolvedValue({ fullName: 'Test User', username: 'testuser' }),
  },
}));

vi.mock('../../services/aiUsageLogger', () => ({
  logAIUsage: vi.fn(),
}));

vi.mock('../../database/connection', () => ({
  databaseService: {
    query: vi.fn().mockResolvedValue([]),
    queryControlPlane: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { ProjectStatusReportService } from '../../services/ProjectStatusReportService';
import { claudeService } from '../../services/claudeService';
import { emailService } from '../../services/EmailService';

const MOCK_AI_RESPONSE = JSON.stringify({
  executiveSummary: 'Project is on track with minor schedule concerns.',
  overallStatus: { status: 'amber', comments: 'Schedule pressure' },
  areas: [
    { name: 'Scope', status: 'green', comments: 'No changes' },
    { name: 'Schedule', status: 'amber', comments: '2 tasks overdue' },
    { name: 'Cost / Budget', status: 'green', comments: 'On track' },
    { name: 'Quality', status: 'green', comments: 'All tasks have estimates' },
    { name: 'Risks & Issues', status: 'amber', comments: '1 high risk' },
    { name: 'Resources', status: 'green', comments: 'Fully staffed' },
    { name: 'Governance & Stakeholders', status: 'green', comments: 'On track' },
  ],
  achievements: ['Completed sprint 3 deliverables', 'Resolved critical bug'],
  plannedActivities: ['Start UAT — QA Lead — Aug 25', 'Deploy to staging — DevOps — Aug 20'],
  managementAttention: [
    {
      ref: 'MA-001',
      matter: 'Review overdue tasks in sprint 3',
      raised: '2026-08-15',
      owner: 'PM',
      dateNeeded: '2026-08-20',
      impactIfDelayed: '1-week schedule slip',
    },
  ],
});

describe('ProjectStatusReportService', () => {
  let service: ProjectStatusReportService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ProjectStatusReportService();
  });

  it('generates a structured report with AI when available', async () => {
    vi.mocked(claudeService.isAvailable).mockReturnValue(true);
    vi.mocked(claudeService.complete).mockResolvedValue({
      content: MOCK_AI_RESPONSE,
      usage: { inputTokens: 100, outputTokens: 200 },
      latencyMs: 500,
      model: 'claude-sonnet-4-6',
    });

    const result = await service.generate('proj-1', 'user-1');

    expect(result.aiPowered).toBe(true);
    expect(result.html).toContain('EXECUTIVE SUMMARY');
    expect(result.html).toContain('OVERALL STATUS');
    // 1 overall + 7 dimensions = 8 areas
    expect(result.data.areas).toHaveLength(8);
    expect(result.data.areas[0].name).toBe('Overall Status');
    expect(result.data.areas[1].name).toBe('Scope');
    expect(result.data.areas[2].name).toBe('Schedule');
    expect(result.data.areas[2].status).toBe('amber');
    expect(result.data.achievements).toHaveLength(2);
    expect(result.data.managementAttention).toHaveLength(1);
    expect(result.data.reportNumber).toMatch(/^SR-\d{3}$/);
    expect(result.data.preparedBy).toBe('Test User');
    expect(result.emailSent).toBe(false);
  });

  it('generates fallback report when AI unavailable', async () => {
    vi.mocked(claudeService.isAvailable).mockReturnValue(false);

    const result = await service.generate('proj-1', 'user-1');

    expect(result.aiPowered).toBe(false);
    // 1 overall + 7 dimensions = 8 areas
    expect(result.data.areas).toHaveLength(8);
    expect(result.data.areas.every(a => a.status === 'amber')).toBe(true);
    expect(result.html).toContain('Template Report');
  });

  it('generates fallback when Claude fails', async () => {
    vi.mocked(claudeService.isAvailable).mockReturnValue(true);
    vi.mocked(claudeService.complete).mockRejectedValue(new Error('API error'));

    const result = await service.generate('proj-1', 'user-1');

    expect(result.aiPowered).toBe(false);
    expect(result.data.areas).toHaveLength(8);
  });

  it('sends email with HTML when sendEmail is true', async () => {
    vi.mocked(claudeService.isAvailable).mockReturnValue(true);
    vi.mocked(claudeService.complete).mockResolvedValue({
      content: MOCK_AI_RESPONSE,
      usage: { inputTokens: 50, outputTokens: 100 },
      latencyMs: 300,
      model: 'claude-sonnet-4-6',
    });

    const result = await service.generate('proj-1', 'user-1', {
      sendEmail: true,
      recipients: ['test@example.com'],
    });

    expect(result.emailSent).toBe(true);
    expect(emailService.sendStatusReportEmail).toHaveBeenCalledWith(
      ['test@example.com'],
      'Test Project',
      expect.stringContaining('EXECUTIVE SUMMARY'),
    );
  });

  it('does not send email when sendEmail is false', async () => {
    vi.mocked(claudeService.isAvailable).mockReturnValue(true);
    vi.mocked(claudeService.complete).mockResolvedValue({
      content: MOCK_AI_RESPONSE,
      usage: { inputTokens: 50, outputTokens: 100 },
      latencyMs: 300,
      model: 'claude-sonnet-4-6',
    });

    const result = await service.generate('proj-1', 'user-1', {
      sendEmail: false,
      recipients: ['test@example.com'],
    });

    expect(result.emailSent).toBe(false);
    expect(emailService.sendStatusReportEmail).not.toHaveBeenCalled();
  });

  it('handles email failure gracefully', async () => {
    vi.mocked(claudeService.isAvailable).mockReturnValue(true);
    vi.mocked(claudeService.complete).mockResolvedValue({
      content: MOCK_AI_RESPONSE,
      usage: { inputTokens: 50, outputTokens: 100 },
      latencyMs: 300,
      model: 'claude-sonnet-4-6',
    });
    vi.mocked(emailService.sendStatusReportEmail).mockRejectedValue(new Error('SMTP error'));

    const result = await service.generate('proj-1', 'user-1', {
      sendEmail: true,
      recipients: ['test@example.com'],
    });

    expect(result.emailSent).toBe(false);
    expect(result.html).toContain('EXECUTIVE SUMMARY');
  });

  it('computes trend from previous report', async () => {
    const { databaseService } = await import('../../database/connection');
    // First call: getPreviousRAG, second call: getNextReportNumber, third+: storeReport
    vi.mocked(databaseService.queryControlPlane)
      .mockResolvedValueOnce([
        {
          messages: JSON.stringify([{
            content: JSON.stringify({
              areas: [
                { name: 'Overall Status', status: 'green' },
                { name: 'Scope', status: 'green' },
                { name: 'Schedule', status: 'green' },
                { name: 'Cost / Budget', status: 'green' },
                { name: 'Quality', status: 'green' },
                { name: 'Risks & Issues', status: 'green' },
                { name: 'Resources', status: 'green' },
                { name: 'Governance & Stakeholders', status: 'green' },
              ],
            }),
          }]),
        },
      ] as any)
      .mockResolvedValueOnce([{ cnt: 1 }] as any)
      .mockResolvedValue([] as any);

    vi.mocked(claudeService.isAvailable).mockReturnValue(true);
    vi.mocked(claudeService.complete).mockResolvedValue({
      content: MOCK_AI_RESPONSE,
      usage: { inputTokens: 50, outputTokens: 100 },
      latencyMs: 300,
      model: 'claude-sonnet-4-6',
    });

    const result = await service.generate('proj-1', 'user-1');

    const schedule = result.data.areas.find(a => a.name === 'Schedule');
    expect(schedule?.previousStatus).toBe('green');
    expect(schedule?.trend).toBe('declining'); // green -> amber
    const budget = result.data.areas.find(a => a.name === 'Cost / Budget');
    expect(budget?.previousStatus).toBe('green');
    expect(budget?.trend).toBe('stable'); // green -> green

    expect(result.data.reportNumber).toBe('SR-002');
  });

  it('includes all 8 sections in sample report', () => {
    const result = service.generateSample('proj-1');

    expect(result.data.reportNumber).toBe('SR-001');
    expect(result.data.preparedBy).toBe('Sample User');
    expect(result.data.milestones).toHaveLength(3);
    expect(result.data.achievements).toHaveLength(3);
    expect(result.data.plannedActivities).toHaveLength(3);
    expect(result.data.managementAttention).toHaveLength(2);
    expect(result.html).toContain('MILESTONE STATUS');
    expect(result.html).toContain('ACHIEVEMENTS THIS PERIOD');
    expect(result.html).toContain('PLANNED ACTIVITIES');
    expect(result.html).toContain('FOR MANAGEMENT ATTENTION');
  });
});
