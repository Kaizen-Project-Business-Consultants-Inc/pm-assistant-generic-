import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────
const mockFindByProject = vi.fn();
vi.mock('../../utils/clientReportContext', () => ({
  clientReportContext: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../database/RiskRepository', () => ({
  riskRepository: {
    findByProject: (...args: any[]) => mockFindByProject(...args),
  },
}));

const mockFindByProjectId = vi.fn();
vi.mock('../../database/ProjectMemberRepository', () => ({
  projectMemberRepository: {
    findByProjectId: (...args: any[]) => mockFindByProjectId(...args),
  },
}));

const mockSendRAIDReportEmail = vi.fn();
vi.mock('../../services/EmailService', () => ({
  emailService: {
    sendRAIDReportEmail: (...args: any[]) => mockSendRAIDReportEmail(...args),
  },
}));

const mockQuery = vi.fn();
const mockQueryControlPlane = vi.fn();
vi.mock('../../database/connection', () => ({
  databaseService: {
    query: (...args: any[]) => mockQuery(...args),
    queryControlPlane: (...args: any[]) => mockQueryControlPlane(...args),
  },
}));

const mockRenderRAIDReportHtml = vi.fn(() => '<html>report</html>');
vi.mock('../../utils/raidReportRenderer', () => ({
  renderRAIDReportHtml: (...args: any[]) => mockRenderRAIDReportHtml(...args),
}));

vi.mock('../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock crypto.randomUUID
vi.mock('crypto', () => ({
  randomUUID: () => 'test-uuid-1234',
}));

import { RAIDReportService } from '../../services/RAIDReportService';
import type { ProjectRisk } from '../../database/RiskRepository';

// ── Helpers ──────────────────────────────────────────────────────────
function makeRisk(overrides: Partial<ProjectRisk> = {}): ProjectRisk {
  return {
    id: overrides.id ?? 'risk-1',
    projectId: overrides.projectId ?? 'proj-1',
    type: overrides.type ?? 'risk',
    title: overrides.title ?? 'Test Risk',
    description: overrides.description ?? null,
    category: overrides.category ?? 'Technical',
    severity: overrides.severity ?? 'high',
    probability: overrides.probability ?? 3,
    impact: overrides.impact ?? 4,
    riskScore: overrides.riskScore ?? 12,
    status: overrides.status ?? 'open',
    triggerCondition: overrides.triggerCondition ?? null,
    triggered: overrides.triggered ?? false,
    triggeredAt: overrides.triggeredAt ?? null,
    mitigationPlan: overrides.mitigationPlan ?? null,
    responsePlan: overrides.responsePlan ?? null,
    ownerId: overrides.ownerId ?? null,
    source: overrides.source ?? 'manual',
    sourceAgentId: overrides.sourceAgentId ?? null,
    aiConfidence: overrides.aiConfidence ?? null,
    linkedTaskIds: overrides.linkedTaskIds ?? null,
    linkedProposalId: overrides.linkedProposalId ?? null,
    createdBy: overrides.createdBy ?? 'user-1',
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
    resolvedAt: overrides.resolvedAt ?? null,
    sequenceNumber: overrides.sequenceNumber !== undefined ? overrides.sequenceNumber : 1,
    recordId: overrides.recordId !== undefined ? overrides.recordId : 'R-001',
    dueDate: overrides.dueDate !== undefined ? overrides.dueDate : null,
  } as ProjectRisk;
}

function makeMember(overrides: Partial<{
  id: string;
  projectId: string;
  userId: string;
  userName: string;
  email: string;
  role: string;
  addedAt: string;
}> = {}) {
  return {
    id: overrides.id ?? 'mem-1',
    projectId: overrides.projectId ?? 'proj-1',
    userId: overrides.userId ?? 'user-1',
    userName: overrides.userName ?? 'Jane Smith',
    email: overrides.email ?? 'jane@example.com',
    role: overrides.role ?? 'owner',
    addedAt: overrides.addedAt ?? '2026-01-01T00:00:00.000Z',
  };
}

// ── Tests ────────────────────────────────────────────────────────────
describe('RAIDReportService', () => {
  let service: RAIDReportService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RAIDReportService();
    mockFindByProject.mockResolvedValue([]);
    mockFindByProjectId.mockResolvedValue([]);
    mockQuery.mockResolvedValue([{ name: 'Test Project' }]);
    mockQueryControlPlane.mockResolvedValue([]);
    mockSendRAIDReportEmail.mockResolvedValue(undefined);
  });

  // ── generate() ──────────────────────────────────────────────────

  describe('generate()', () => {
    it('returns a report with correct structure on happy path', async () => {
      const items = [
        makeRisk({ id: 'r1', type: 'risk', severity: 'critical', status: 'open', recordId: 'R-001' }),
        makeRisk({ id: 'r2', type: 'issue', severity: 'high', status: 'in_progress', recordId: 'I-001' }),
      ];
      mockFindByProject.mockResolvedValue(items);
      mockFindByProjectId.mockResolvedValue([makeMember()]);

      const result = await service.generate('proj-1', 'user-1');

      expect(result).toMatchObject({
        id: 'test-uuid-1234',
        projectId: 'proj-1',
        html: '<html>report</html>',
        emailSent: false,
        itemCount: 2,
      });
      expect(result.generatedAt).toBeDefined();
    });

    it('fetches all items and members for the project', async () => {
      await service.generate('proj-1', 'user-1');

      expect(mockFindByProject).toHaveBeenCalledWith('proj-1');
      expect(mockFindByProjectId).toHaveBeenCalledWith('proj-1');
    });

    it('fetches the project name from the database', async () => {
      mockQuery.mockResolvedValue([{ name: 'My Cool Project' }]);
      await service.generate('proj-1', 'user-1');

      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT name FROM projects WHERE id = ?',
        ['proj-1'],
      );
      // Verify the project name was passed to the renderer
      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      expect(renderCall.projectName).toBe('My Cool Project');
    });

    it('uses default project name when query returns empty', async () => {
      mockQuery.mockResolvedValue([]);
      await service.generate('proj-1', 'user-1');

      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      expect(renderCall.projectName).toBe('Project');
    });

    it('uses default project name when query throws', async () => {
      mockQuery.mockRejectedValue(new Error('DB error'));
      await service.generate('proj-1', 'user-1');

      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      expect(renderCall.projectName).toBe('Project');
    });

    // ── Filtering ──────────────────────────────────────────────────

    it('filters out non-open status items by default', async () => {
      const items = [
        makeRisk({ status: 'open' }),
        makeRisk({ status: 'closed', id: 'closed-1' }),
        makeRisk({ status: 'resolved', id: 'resolved-1' }),
        makeRisk({ status: 'monitoring', id: 'mon-1' }),
        makeRisk({ status: 'mitigating', id: 'mit-1' }),
        makeRisk({ status: 'in_progress', id: 'ip-1' }),
        makeRisk({ status: 'pending_decision', id: 'pd-1' }),
        makeRisk({ status: 'completed', id: 'comp-1' }),
      ];
      mockFindByProject.mockResolvedValue(items);

      await service.generate('proj-1', 'user-1');

      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      // open, monitoring, mitigating, in_progress, pending_decision = 5 items
      expect(renderCall.items).toHaveLength(5);
    });

    it('filters by types when specified', async () => {
      const items = [
        makeRisk({ type: 'risk', status: 'open', id: 'r1' }),
        makeRisk({ type: 'issue', status: 'open', id: 'i1' }),
        makeRisk({ type: 'action', status: 'open', id: 'a1' }),
      ];
      mockFindByProject.mockResolvedValue(items);

      await service.generate('proj-1', 'user-1', {
        filters: { types: ['risk', 'action'] },
      });

      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      expect(renderCall.items).toHaveLength(2);
      expect(renderCall.items.map((i: any) => i.type)).toEqual(['risk', 'action']);
    });

    it('filters by severities when specified', async () => {
      const items = [
        makeRisk({ severity: 'critical', status: 'open', id: 'c1' }),
        makeRisk({ severity: 'high', status: 'open', id: 'h1' }),
        makeRisk({ severity: 'low', status: 'open', id: 'l1' }),
      ];
      mockFindByProject.mockResolvedValue(items);

      await service.generate('proj-1', 'user-1', {
        filters: { severities: ['critical'] },
      });

      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      expect(renderCall.items).toHaveLength(1);
      expect(renderCall.items[0].severity).toBe('critical');
    });

    it('filters by owners when specified', async () => {
      const items = [
        makeRisk({ ownerId: 'user-1', status: 'open', id: 'o1' }),
        makeRisk({ ownerId: 'user-2', status: 'open', id: 'o2' }),
        makeRisk({ ownerId: null, status: 'open', id: 'o3' }),
      ];
      mockFindByProject.mockResolvedValue(items);
      mockFindByProjectId.mockResolvedValue([
        makeMember({ userId: 'user-1', userName: 'Jane Smith' }),
        makeMember({ userId: 'user-2', userName: 'John Doe', id: 'mem-2' }),
      ]);

      await service.generate('proj-1', 'user-1', {
        filters: { owners: ['user-1'] },
      });

      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      expect(renderCall.items).toHaveLength(1);
      expect(renderCall.items[0].ownerName).toBe('Jane Smith');
    });

    it('filters by categories when specified', async () => {
      const items = [
        makeRisk({ category: 'Technical', status: 'open', id: 'c1' }),
        makeRisk({ category: 'Budget', status: 'open', id: 'c2' }),
      ];
      mockFindByProject.mockResolvedValue(items);

      await service.generate('proj-1', 'user-1', {
        filters: { categories: ['Budget'] },
      });

      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      expect(renderCall.items).toHaveLength(1);
      expect(renderCall.items[0].category).toBe('Budget');
    });

    it('applies multiple filters simultaneously', async () => {
      const items = [
        makeRisk({ type: 'risk', severity: 'critical', category: 'Technical', status: 'open', id: 'r1' }),
        makeRisk({ type: 'risk', severity: 'low', category: 'Technical', status: 'open', id: 'r2' }),
        makeRisk({ type: 'issue', severity: 'critical', category: 'Technical', status: 'open', id: 'i1' }),
      ];
      mockFindByProject.mockResolvedValue(items);

      await service.generate('proj-1', 'user-1', {
        filters: { types: ['risk'], severities: ['critical'] },
      });

      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      expect(renderCall.items).toHaveLength(1);
      expect(renderCall.items[0].recordId).toBe('R-001');
    });

    // ── Sorting ────────────────────────────────────────────────────

    it('sorts by severity (critical first) then by days open (older first)', async () => {
      const items = [
        makeRisk({ severity: 'low', status: 'open', id: 'l1', createdAt: '2026-01-01T00:00:00.000Z', recordId: 'L-001' }),
        makeRisk({ severity: 'critical', status: 'open', id: 'c1', createdAt: '2026-01-05T00:00:00.000Z', recordId: 'C-001' }),
        makeRisk({ severity: 'critical', status: 'open', id: 'c2', createdAt: '2026-01-01T00:00:00.000Z', recordId: 'C-002' }),
        makeRisk({ severity: 'high', status: 'open', id: 'h1', createdAt: '2026-01-01T00:00:00.000Z', recordId: 'H-001' }),
      ];
      mockFindByProject.mockResolvedValue(items);

      await service.generate('proj-1', 'user-1');

      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      const recordIds = renderCall.items.map((i: any) => i.recordId);
      // Critical first (older first within same severity), then high, then low
      expect(recordIds).toEqual(['C-002', 'C-001', 'H-001', 'L-001']);
    });

    it('puts unknown severity at the end', async () => {
      const items = [
        makeRisk({ severity: 'unknown', status: 'open', id: 'u1', recordId: 'U-001' }),
        makeRisk({ severity: 'low', status: 'open', id: 'l1', recordId: 'L-001' }),
      ];
      mockFindByProject.mockResolvedValue(items);

      await service.generate('proj-1', 'user-1');

      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      expect(renderCall.items[0].recordId).toBe('L-001');
      expect(renderCall.items[1].recordId).toBe('U-001');
    });

    // ── Member mapping ─────────────────────────────────────────────

    it('maps ownerId to member name', async () => {
      const items = [makeRisk({ ownerId: 'user-1', status: 'open' })];
      const members = [makeMember({ userId: 'user-1', userName: 'Jane Smith' })];
      mockFindByProject.mockResolvedValue(items);
      mockFindByProjectId.mockResolvedValue(members);

      await service.generate('proj-1', 'user-1');

      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      expect(renderCall.items[0].ownerName).toBe('Jane Smith');
    });

    it('maps ownerId to member email when userName is empty', async () => {
      const items = [makeRisk({ ownerId: 'user-2', status: 'open' })];
      const members = [makeMember({ userId: 'user-2', userName: '', email: 'user2@test.com' })];
      mockFindByProject.mockResolvedValue(items);
      mockFindByProjectId.mockResolvedValue(members);

      await service.generate('proj-1', 'user-1');

      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      expect(renderCall.items[0].ownerName).toBe('user2@test.com');
    });

    it('shows "Unassigned" when ownerId is null', async () => {
      const items = [makeRisk({ ownerId: null, status: 'open' })];
      mockFindByProject.mockResolvedValue(items);

      await service.generate('proj-1', 'user-1');

      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      expect(renderCall.items[0].ownerName).toBe('Unassigned');
    });

    it('shows "Unassigned" when ownerId does not match any member', async () => {
      const items = [makeRisk({ ownerId: 'unknown-user', status: 'open' })];
      mockFindByProject.mockResolvedValue(items);
      mockFindByProjectId.mockResolvedValue([makeMember({ userId: 'user-1' })]);

      await service.generate('proj-1', 'user-1');

      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      expect(renderCall.items[0].ownerName).toBe('Unassigned');
    });

    // ── Report item mapping ────────────────────────────────────────

    it('uses recordId from item, falls back to id slice', async () => {
      const items = [
        makeRisk({ id: 'abcdefgh-1234', recordId: 'R-042', status: 'open' }),
        makeRisk({ id: 'ijklmnop-5678', recordId: null, status: 'open' }),
      ];
      mockFindByProject.mockResolvedValue(items);

      await service.generate('proj-1', 'user-1');

      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      expect(renderCall.items[0].recordId).toBe('R-042');
      expect(renderCall.items[1].recordId).toBe('ijklmnop');
    });

    it('calculates daysOpen correctly and never goes negative', async () => {
      const futureDate = new Date(Date.now() + 86400000 * 5).toISOString(); // 5 days in the future
      const items = [makeRisk({ createdAt: futureDate, status: 'open' })];
      mockFindByProject.mockResolvedValue(items);

      await service.generate('proj-1', 'user-1');

      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      expect(renderCall.items[0].daysOpen).toBe(0);
    });

    // ── Summary breakdown ──────────────────────────────────────────

    it('builds correct severity breakdown per type', async () => {
      const items = [
        makeRisk({ type: 'risk', severity: 'critical', status: 'open', id: 'r1' }),
        makeRisk({ type: 'risk', severity: 'high', status: 'open', id: 'r2' }),
        makeRisk({ type: 'risk', severity: 'high', status: 'open', id: 'r3' }),
        makeRisk({ type: 'issue', severity: 'medium', status: 'open', id: 'i1' }),
        makeRisk({ type: 'action', severity: 'low', status: 'open', id: 'a1' }),
        makeRisk({ type: 'decision', severity: 'critical', status: 'pending_decision', id: 'd1' }),
      ];
      mockFindByProject.mockResolvedValue(items);

      await service.generate('proj-1', 'user-1');

      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      expect(renderCall.summary.openRisks).toEqual({ critical: 1, high: 2, medium: 0, low: 0 });
      expect(renderCall.summary.openIssues).toEqual({ critical: 0, high: 0, medium: 1, low: 0 });
      expect(renderCall.summary.openActions).toEqual({ critical: 0, high: 0, medium: 0, low: 1 });
      expect(renderCall.summary.pendingDecisions).toEqual({ critical: 1, high: 0, medium: 0, low: 0 });
    });

    it('returns zero breakdown when no items exist', async () => {
      mockFindByProject.mockResolvedValue([]);

      await service.generate('proj-1', 'user-1');

      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      const zeroes = { critical: 0, high: 0, medium: 0, low: 0 };
      expect(renderCall.summary.openRisks).toEqual(zeroes);
      expect(renderCall.summary.openIssues).toEqual(zeroes);
      expect(renderCall.summary.openActions).toEqual(zeroes);
      expect(renderCall.summary.pendingDecisions).toEqual(zeroes);
    });

    // ── Overdue actions ────────────────────────────────────────────

    it('identifies overdue actions in report data', async () => {
      const pastDate = '2025-01-01';
      const items = [
        makeRisk({ type: 'action', status: 'open', dueDate: pastDate, id: 'a1', recordId: 'A-001' }),
        makeRisk({ type: 'action', status: 'open', dueDate: '2099-12-31', id: 'a2', recordId: 'A-002' }),
        makeRisk({ type: 'action', status: 'open', dueDate: null, id: 'a3', recordId: 'A-003' }),
      ];
      mockFindByProject.mockResolvedValue(items);

      await service.generate('proj-1', 'user-1');

      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      expect(renderCall.overdueActions).toHaveLength(1);
      expect(renderCall.overdueActions[0].recordId).toBe('A-001');
    });

    // ── Critical mitigations ───────────────────────────────────────

    it('includes critical and high risks in criticalMitigations', async () => {
      const items = [
        makeRisk({ type: 'risk', severity: 'critical', status: 'open', id: 'r1', recordId: 'R-001' }),
        makeRisk({ type: 'risk', severity: 'high', status: 'open', id: 'r2', recordId: 'R-002' }),
        makeRisk({ type: 'risk', severity: 'medium', status: 'open', id: 'r3', recordId: 'R-003' }),
        makeRisk({ type: 'issue', severity: 'critical', status: 'open', id: 'i1', recordId: 'I-001' }),
      ];
      mockFindByProject.mockResolvedValue(items);

      await service.generate('proj-1', 'user-1');

      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      expect(renderCall.criticalMitigations).toHaveLength(2);
      const recordIds = renderCall.criticalMitigations.map((i: any) => i.recordId);
      expect(recordIds).toContain('R-001');
      expect(recordIds).toContain('R-002');
    });

    // ── Filters applied text ───────────────────────────────────────

    it('sets filtersApplied to null when no filters specified', async () => {
      await service.generate('proj-1', 'user-1');

      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      expect(renderCall.filtersApplied).toBeNull();
    });

    it('builds filtersApplied text from active filters', async () => {
      const members = [makeMember({ userId: 'user-1', userName: 'Jane Smith' })];
      mockFindByProjectId.mockResolvedValue(members);

      await service.generate('proj-1', 'user-1', {
        filters: {
          types: ['risk', 'issue'],
          severities: ['critical'],
          owners: ['user-1'],
          categories: ['Technical'],
        },
      });

      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      expect(renderCall.filtersApplied).toContain('Types: risk, issue');
      expect(renderCall.filtersApplied).toContain('Severities: critical');
      expect(renderCall.filtersApplied).toContain('Owners: Jane Smith');
      expect(renderCall.filtersApplied).toContain('Categories: Technical');
    });

    it('uses raw owner id in filters text when member not found', async () => {
      mockFindByProjectId.mockResolvedValue([]);

      await service.generate('proj-1', 'user-1', {
        filters: { owners: ['unknown-user-id'] },
      });

      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      expect(renderCall.filtersApplied).toContain('Owners: unknown-user-id');
    });

    // ── Email ──────────────────────────────────────────────────────

    it('sends email when sendEmail is true and recipients provided', async () => {
      mockQuery.mockResolvedValue([{ name: 'Test Project' }]);

      const result = await service.generate('proj-1', 'user-1', {
        sendEmail: true,
        recipients: ['test@example.com'],
      });

      expect(mockSendRAIDReportEmail).toHaveBeenCalledWith(
        ['test@example.com'],
        'Test Project',
        '<html>report</html>',
        // Who it is from, and a link the recipient can open without an account.
        expect.any(Object),
      );
      expect(result.emailSent).toBe(true);
    });

    it('does not send email when sendEmail is false', async () => {
      await service.generate('proj-1', 'user-1', {
        sendEmail: false,
        recipients: ['test@example.com'],
      });

      expect(mockSendRAIDReportEmail).not.toHaveBeenCalled();
    });

    it('does not send email when no recipients provided', async () => {
      await service.generate('proj-1', 'user-1', {
        sendEmail: true,
        recipients: [],
      });

      expect(mockSendRAIDReportEmail).not.toHaveBeenCalled();
    });

    it('does not send email when recipients is undefined', async () => {
      await service.generate('proj-1', 'user-1', {
        sendEmail: true,
      });

      expect(mockSendRAIDReportEmail).not.toHaveBeenCalled();
    });

    it('sets emailSent false and does not throw when email fails', async () => {
      mockSendRAIDReportEmail.mockRejectedValue(new Error('SMTP down'));

      const result = await service.generate('proj-1', 'user-1', {
        sendEmail: true,
        recipients: ['test@example.com'],
      });

      expect(result.emailSent).toBe(false);
    });

    // ── Report storage ─────────────────────────────────────────────

    it('stores report to control plane (fire-and-forget)', async () => {
      await service.generate('proj-1', 'user-1');

      // Allow the fire-and-forget promise to resolve
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockQueryControlPlane).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO ai_conversations'),
        expect.arrayContaining(['test-uuid-1234', 'user-1', 'proj-1']),
      );
    });

    it('does not throw when storeReport fails', async () => {
      mockQueryControlPlane.mockRejectedValue(new Error('DB write failed'));

      // Should not throw
      const result = await service.generate('proj-1', 'user-1');
      expect(result.id).toBe('test-uuid-1234');

      // Allow fire-and-forget to settle
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    // ── Edge: empty items ──────────────────────────────────────────

    it('returns itemCount 0 when no items match', async () => {
      mockFindByProject.mockResolvedValue([]);

      const result = await service.generate('proj-1', 'user-1');

      expect(result.itemCount).toBe(0);
      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      expect(renderCall.items).toHaveLength(0);
      expect(renderCall.overdueActions).toHaveLength(0);
      expect(renderCall.criticalMitigations).toHaveLength(0);
    });
  });

  // ── generateSample() ────────────────────────────────────────────

  describe('generateSample()', () => {
    it('returns a sample report with correct structure', () => {
      const result = service.generateSample('proj-1');

      expect(result).toMatchObject({
        id: 'sample',
        projectId: 'proj-1',
        emailSent: false,
        itemCount: 6,
      });
      expect(result.html).toBe('<html>report</html>');
      expect(result.generatedAt).toBeDefined();
    });

    it('does not call any repository or database', () => {
      service.generateSample('proj-1');

      expect(mockFindByProject).not.toHaveBeenCalled();
      expect(mockFindByProjectId).not.toHaveBeenCalled();
      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockQueryControlPlane).not.toHaveBeenCalled();
    });

    it('includes all 4 RAID types in sample items', () => {
      service.generateSample('proj-1');

      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      const types = renderCall.items.map((i: any) => i.type);
      expect(types).toContain('risk');
      expect(types).toContain('issue');
      expect(types).toContain('action');
      expect(types).toContain('decision');
    });

    it('passes "Sample Project" as projectName', () => {
      service.generateSample('proj-1');

      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      expect(renderCall.projectName).toBe('Sample Project');
    });

    it('has no filtersApplied', () => {
      service.generateSample('proj-1');

      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      expect(renderCall.filtersApplied).toBeNull();
    });

    it('includes overdue actions and critical mitigations', () => {
      service.generateSample('proj-1');

      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      expect(renderCall.overdueActions.length).toBeGreaterThan(0);
      expect(renderCall.criticalMitigations.length).toBeGreaterThan(0);
    });

    it('provides correct summary breakdown', () => {
      service.generateSample('proj-1');

      const renderCall = mockRenderRAIDReportHtml.mock.calls[0][0];
      expect(renderCall.summary.openRisks).toEqual({ critical: 1, high: 1, medium: 0, low: 0 });
      expect(renderCall.summary.openIssues).toEqual({ critical: 0, high: 1, medium: 0, low: 0 });
      expect(renderCall.summary.openActions).toEqual({ critical: 0, high: 1, medium: 1, low: 0 });
      expect(renderCall.summary.pendingDecisions).toEqual({ critical: 0, high: 1, medium: 0, low: 0 });
    });
  });
});
