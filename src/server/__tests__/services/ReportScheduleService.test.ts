import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks (hoisted) ────────────────────────────────────────────────
const mockRepo = vi.hoisted(() => ({
  insert: vi.fn().mockResolvedValue(undefined),
  findById: vi.fn().mockResolvedValue(null),
  findByUser: vi.fn().mockResolvedValue([]),
  findByTemplate: vi.fn().mockResolvedValue([]),
  updateFields: vi.fn().mockResolvedValue(undefined),
  deleteById: vi.fn().mockResolvedValue(undefined),
  findAll: vi.fn().mockResolvedValue([]),
  findDue: vi.fn().mockResolvedValue([]),
  updateRunStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../database/ReportScheduleRepository', () => ({
  reportScheduleRepository: mockRepo,
}));

vi.mock('../../services/ReportBuilderService', () => ({
  reportBuilderService: {
    getTemplateById: vi.fn().mockResolvedValue(null),
    exportReport: vi.fn().mockResolvedValue({ data: '' }),
  },
}));

vi.mock('../../services/EmailService', () => ({
  emailService: {
    sendReportEmail: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/ProjectStatusReportService', () => ({
  projectStatusReportService: {
    generate: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/RAIDReportService', () => ({
  raidReportService: {
    generate: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-1234'),
}));

// ── Imports (after mocks) ──────────────────────────────────────────
import { ReportScheduleService } from '../../services/ReportScheduleService';
import { reportBuilderService } from '../../services/ReportBuilderService';
import { emailService } from '../../services/EmailService';
import { projectStatusReportService } from '../../services/ProjectStatusReportService';
import { raidReportService } from '../../services/RAIDReportService';
import logger from '../../utils/logger';

const mockGetTemplateById = reportBuilderService.getTemplateById as ReturnType<typeof vi.fn>;
const mockExportReport = reportBuilderService.exportReport as ReturnType<typeof vi.fn>;
const mockSendReportEmail = emailService.sendReportEmail as ReturnType<typeof vi.fn>;
const mockStatusReportGenerate = projectStatusReportService.generate as ReturnType<typeof vi.fn>;
const mockRaidReportGenerate = raidReportService.generate as ReturnType<typeof vi.fn>;

// ── Helpers ────────────────────────────────────────────────────────
function makeSchedule(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sched-1',
    templateId: 'tmpl-1',
    createdBy: 'user-1',
    frequency: 'daily' as const,
    dayOfWeek: null,
    dayOfMonth: null,
    timeOfDay: '08:00',
    recipients: ['alice@test.com', 'bob@test.com'],
    format: 'csv' as const,
    isActive: true,
    nextRunAt: '2026-09-10 08:00:00',
    lastRunAt: null,
    lastRunStatus: null,
    lastRunError: null,
    createdAt: '2026-09-01 00:00:00',
    updatedAt: '2026-09-01 00:00:00',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────
describe('ReportScheduleService', () => {
  let service: ReportScheduleService;

  beforeEach(() => {
    service = new ReportScheduleService();
    vi.clearAllMocks();
  });

  // ────────────── create ──────────────
  describe('create', () => {
    it('inserts a new schedule and returns it', async () => {
      const created = makeSchedule({ id: 'test-uuid-1234' });
      mockRepo.findById.mockResolvedValueOnce(created);

      const result = await service.create({
        templateId: 'tmpl-1',
        createdBy: 'user-1',
        frequency: 'daily',
        recipients: ['alice@test.com', 'bob@test.com'],
      });

      expect(mockRepo.insert).toHaveBeenCalledWith(
        'test-uuid-1234',
        'tmpl-1',
        'user-1',
        'daily',
        null,
        null,
        '08:00', // default timeOfDay
        ['alice@test.com', 'bob@test.com'],
        true, // default isActive
        expect.any(String), // computed nextRunAt
      );
      expect(result).toEqual(created);
    });

    it('uses provided timeOfDay instead of default', async () => {
      const created = makeSchedule({ timeOfDay: '14:30' });
      mockRepo.findById.mockResolvedValueOnce(created);

      await service.create({
        templateId: 'tmpl-1',
        createdBy: 'user-1',
        frequency: 'weekly',
        dayOfWeek: 3,
        timeOfDay: '14:30',
        recipients: ['alice@test.com'],
      });

      expect(mockRepo.insert).toHaveBeenCalledWith(
        'test-uuid-1234',
        'tmpl-1',
        'user-1',
        'weekly',
        3,
        null,
        '14:30',
        ['alice@test.com'],
        true,
        expect.any(String),
      );
    });

    it('respects isActive = false', async () => {
      mockRepo.findById.mockResolvedValueOnce(makeSchedule({ isActive: false }));

      await service.create({
        templateId: 'tmpl-1',
        createdBy: 'user-1',
        frequency: 'monthly',
        dayOfMonth: 15,
        recipients: ['alice@test.com'],
        isActive: false,
      });

      expect(mockRepo.insert).toHaveBeenCalledWith(
        expect.any(String),
        'tmpl-1',
        'user-1',
        'monthly',
        null,
        15,
        '08:00',
        ['alice@test.com'],
        false,
        expect.any(String),
      );
    });
  });

  // ────────────── getById ──────────────
  describe('getById', () => {
    it('returns the schedule when found', async () => {
      const schedule = makeSchedule();
      mockRepo.findById.mockResolvedValueOnce(schedule);

      const result = await service.getById('sched-1');

      expect(result).toEqual(schedule);
      expect(mockRepo.findById).toHaveBeenCalledWith('sched-1');
    });

    it('returns null when not found', async () => {
      mockRepo.findById.mockResolvedValueOnce(null);

      const result = await service.getById('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ────────────── listByUser ──────────────
  describe('listByUser', () => {
    it('delegates to repository findByUser', async () => {
      const schedules = [makeSchedule(), makeSchedule({ id: 'sched-2' })];
      mockRepo.findByUser.mockResolvedValueOnce(schedules);

      const result = await service.listByUser('user-1');

      expect(result).toEqual(schedules);
      expect(mockRepo.findByUser).toHaveBeenCalledWith('user-1');
    });
  });

  // ────────────── getByTemplateId ──────────────
  describe('getByTemplateId', () => {
    it('delegates to repository findByTemplate', async () => {
      const schedules = [makeSchedule()];
      mockRepo.findByTemplate.mockResolvedValueOnce(schedules);

      const result = await service.getByTemplateId('tmpl-1');

      expect(result).toEqual(schedules);
      expect(mockRepo.findByTemplate).toHaveBeenCalledWith('tmpl-1');
    });
  });

  // ────────────── update ──────────────
  describe('update', () => {
    it('updates frequency and recomputes nextRunAt', async () => {
      const existing = makeSchedule();
      mockRepo.findById
        .mockResolvedValueOnce(existing)   // getById inside update (for recompute)
        .mockResolvedValueOnce(existing);  // getById return value

      const result = await service.update('sched-1', { frequency: 'weekly' });

      expect(mockRepo.updateFields).toHaveBeenCalledWith(
        'sched-1',
        expect.arrayContaining(['frequency = ?', 'next_run_at = ?']),
        expect.arrayContaining(['weekly']),
      );
      expect(result).toEqual(existing);
    });

    it('updates recipients without recomputing nextRunAt', async () => {
      const existing = makeSchedule();
      mockRepo.findById.mockResolvedValueOnce(existing);

      await service.update('sched-1', { recipients: ['new@test.com'] });

      expect(mockRepo.updateFields).toHaveBeenCalledWith(
        'sched-1',
        ['recipients = ?'],
        [JSON.stringify(['new@test.com'])],
      );
    });

    it('updates isActive flag', async () => {
      const existing = makeSchedule();
      mockRepo.findById.mockResolvedValueOnce(existing);

      await service.update('sched-1', { isActive: false });

      expect(mockRepo.updateFields).toHaveBeenCalledWith(
        'sched-1',
        ['is_active = ?'],
        [false],
      );
    });

    it('returns current schedule when no fields provided', async () => {
      const existing = makeSchedule();
      mockRepo.findById.mockResolvedValueOnce(existing);

      const result = await service.update('sched-1', {});

      expect(mockRepo.updateFields).not.toHaveBeenCalled();
      expect(result).toEqual(existing);
    });

    it('recomputes nextRunAt when timeOfDay changes', async () => {
      const existing = makeSchedule();
      mockRepo.findById
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(existing);

      await service.update('sched-1', { timeOfDay: '15:00' });

      expect(mockRepo.updateFields).toHaveBeenCalledWith(
        'sched-1',
        expect.arrayContaining(['time_of_day = ?', 'next_run_at = ?']),
        expect.arrayContaining(['15:00']),
      );
    });

    it('recomputes nextRunAt when dayOfWeek changes', async () => {
      const existing = makeSchedule({ frequency: 'weekly' });
      mockRepo.findById
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(existing);

      await service.update('sched-1', { dayOfWeek: 5 });

      expect(mockRepo.updateFields).toHaveBeenCalledWith(
        'sched-1',
        expect.arrayContaining(['day_of_week = ?', 'next_run_at = ?']),
        expect.arrayContaining([5]),
      );
    });

    it('recomputes nextRunAt when dayOfMonth changes', async () => {
      const existing = makeSchedule({ frequency: 'monthly' });
      mockRepo.findById
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(existing);

      await service.update('sched-1', { dayOfMonth: 20 });

      expect(mockRepo.updateFields).toHaveBeenCalledWith(
        'sched-1',
        expect.arrayContaining(['day_of_month = ?', 'next_run_at = ?']),
        expect.arrayContaining([20]),
      );
    });
  });

  // ────────────── delete ──────────────
  describe('delete', () => {
    it('delegates to repository deleteById', async () => {
      await service.delete('sched-1');

      expect(mockRepo.deleteById).toHaveBeenCalledWith('sched-1');
    });
  });

  // ────────────── listAll ──────────────
  describe('listAll', () => {
    it('delegates to repository findAll', async () => {
      const schedules = [makeSchedule()];
      mockRepo.findAll.mockResolvedValueOnce(schedules);

      const result = await service.listAll();

      expect(result).toEqual(schedules);
      expect(mockRepo.findAll).toHaveBeenCalled();
    });
  });

  // ────────────── executeOne ──────────────
  describe('executeOne', () => {
    it('throws when schedule is not found', async () => {
      mockRepo.findById.mockResolvedValueOnce(null);

      await expect(service.executeOne('bad-id')).rejects.toThrow('Schedule not found');
    });

    it('executes a status report schedule', async () => {
      const schedule = makeSchedule({ templateId: 'status-report::proj-1' });
      mockRepo.findById.mockResolvedValueOnce(schedule);

      await service.executeOne('sched-1');

      expect(mockStatusReportGenerate).toHaveBeenCalledWith('proj-1', 'user-1', {
        recipients: ['alice@test.com', 'bob@test.com'],
        sendEmail: true,
      });
      expect(mockRepo.updateRunStatus).toHaveBeenCalledWith(
        'sched-1',
        expect.any(String),
        'success',
        null,
        undefined,
      );
    });

    it('executes a RAID report schedule', async () => {
      const schedule = makeSchedule({ templateId: 'raid-report::proj-2' });
      mockRepo.findById.mockResolvedValueOnce(schedule);

      await service.executeOne('sched-1');

      expect(mockRaidReportGenerate).toHaveBeenCalledWith('proj-2', 'user-1', {
        recipients: ['alice@test.com', 'bob@test.com'],
        sendEmail: true,
      });
      expect(mockRepo.updateRunStatus).toHaveBeenCalledWith(
        'sched-1',
        expect.any(String),
        'success',
        null,
        undefined,
      );
    });

    it('executes a custom template report and sends email', async () => {
      const schedule = makeSchedule({ templateId: 'tmpl-42' });
      mockRepo.findById.mockResolvedValueOnce(schedule);
      mockGetTemplateById.mockResolvedValueOnce({ id: 'tmpl-42', name: 'Weekly Summary' });
      mockExportReport.mockResolvedValueOnce({ data: 'col1,col2\nval1,val2' });

      await service.executeOne('sched-1');

      expect(mockGetTemplateById).toHaveBeenCalledWith('tmpl-42');
      expect(mockExportReport).toHaveBeenCalledWith('tmpl-42', 'csv');
      expect(mockSendReportEmail).toHaveBeenCalledWith(
        ['alice@test.com', 'bob@test.com'],
        'Weekly Summary',
        'col1,col2\nval1,val2',
      );
      expect(mockRepo.updateRunStatus).toHaveBeenCalledWith(
        'sched-1',
        expect.any(String),
        'success',
        null,
        undefined,
      );
    });

    it('throws when custom template is not found', async () => {
      const schedule = makeSchedule({ templateId: 'tmpl-missing' });
      mockRepo.findById.mockResolvedValueOnce(schedule);
      mockGetTemplateById.mockResolvedValueOnce(null);

      await expect(service.executeOne('sched-1')).rejects.toThrow('Template not found');

      expect(mockRepo.updateRunStatus).toHaveBeenCalledWith(
        'sched-1',
        expect.any(String),
        'error',
        'Template not found',
        undefined,
      );
    });

    it('records error status when email send fails', async () => {
      const schedule = makeSchedule({ templateId: 'tmpl-42' });
      mockRepo.findById.mockResolvedValueOnce(schedule);
      mockGetTemplateById.mockResolvedValueOnce({ id: 'tmpl-42', name: 'Report' });
      mockExportReport.mockResolvedValueOnce({ data: 'csv-data' });
      mockSendReportEmail.mockRejectedValueOnce(new Error('SMTP timeout'));

      await expect(service.executeOne('sched-1')).rejects.toThrow('SMTP timeout');

      expect(mockRepo.updateRunStatus).toHaveBeenCalledWith(
        'sched-1',
        expect.any(String),
        'error',
        'SMTP timeout',
        undefined,
      );
      expect(logger.error).toHaveBeenCalled();
    });

    it('records error status when status report generation fails', async () => {
      const schedule = makeSchedule({ templateId: 'status-report::proj-1' });
      mockRepo.findById.mockResolvedValueOnce(schedule);
      mockStatusReportGenerate.mockRejectedValueOnce(new Error('DB unavailable'));

      await expect(service.executeOne('sched-1')).rejects.toThrow('DB unavailable');

      expect(mockRepo.updateRunStatus).toHaveBeenCalledWith(
        'sched-1',
        expect.any(String),
        'error',
        'DB unavailable',
        undefined,
      );
    });
  });

  // ────────────── getDueSchedules ──────────────
  describe('getDueSchedules', () => {
    it('queries for schedules due before now', async () => {
      const due = [makeSchedule()];
      mockRepo.findDue.mockResolvedValueOnce(due);

      const result = await service.getDueSchedules();

      expect(result).toEqual(due);
      expect(mockRepo.findDue).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/));
    });
  });

  // ────────────── executeDueSchedules ──────────────
  describe('executeDueSchedules', () => {
    it('returns 0 when no schedules are due', async () => {
      mockRepo.findDue.mockResolvedValueOnce([]);

      const count = await service.executeDueSchedules();

      expect(count).toBe(0);
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('executes a due status report schedule and advances nextRunAt', async () => {
      const schedule = makeSchedule({ templateId: 'status-report::proj-1' });
      mockRepo.findDue.mockResolvedValueOnce([schedule]);

      const count = await service.executeDueSchedules();

      expect(count).toBe(1);
      expect(mockStatusReportGenerate).toHaveBeenCalledWith('proj-1', 'user-1', {
        recipients: ['alice@test.com', 'bob@test.com'],
        sendEmail: true,
      });
      expect(mockRepo.updateRunStatus).toHaveBeenCalledWith(
        'sched-1',
        expect.any(String),
        'success',
        null,
        expect.any(String), // nextRunAt is computed
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Executed 1 scheduled report(s)'),
      );
    });

    it('executes a due RAID report schedule and advances nextRunAt', async () => {
      const schedule = makeSchedule({ templateId: 'raid-report::proj-3' });
      mockRepo.findDue.mockResolvedValueOnce([schedule]);

      const count = await service.executeDueSchedules();

      expect(count).toBe(1);
      expect(mockRaidReportGenerate).toHaveBeenCalledWith('proj-3', 'user-1', {
        recipients: ['alice@test.com', 'bob@test.com'],
        sendEmail: true,
      });
    });

    it('executes a due custom template report', async () => {
      const schedule = makeSchedule({ templateId: 'tmpl-10' });
      mockRepo.findDue.mockResolvedValueOnce([schedule]);
      mockGetTemplateById.mockResolvedValueOnce({ id: 'tmpl-10', name: 'Monthly Report' });
      mockExportReport.mockResolvedValueOnce({ data: 'csv-content' });

      const count = await service.executeDueSchedules();

      expect(count).toBe(1);
      expect(mockSendReportEmail).toHaveBeenCalledWith(
        ['alice@test.com', 'bob@test.com'],
        'Monthly Report',
        'csv-content',
      );
      expect(mockRepo.updateRunStatus).toHaveBeenCalledWith(
        'sched-1',
        expect.any(String),
        'success',
        null,
        expect.any(String),
      );
    });

    it('records error and skips when template not found (does not throw)', async () => {
      const schedule = makeSchedule({ templateId: 'tmpl-missing' });
      mockRepo.findDue.mockResolvedValueOnce([schedule]);
      mockGetTemplateById.mockResolvedValueOnce(null);

      const count = await service.executeDueSchedules();

      expect(count).toBe(0);
      expect(mockRepo.updateRunStatus).toHaveBeenCalledWith(
        'sched-1',
        expect.any(String),
        'error',
        'Template not found',
        undefined, // no nextRunAt for template-not-found path
      );
    });

    it('continues processing remaining schedules when one fails', async () => {
      const schedules = [
        makeSchedule({ id: 'sched-fail', templateId: 'tmpl-bad' }),
        makeSchedule({ id: 'sched-ok', templateId: 'status-report::proj-1' }),
      ];
      mockRepo.findDue.mockResolvedValueOnce(schedules);

      // First schedule: template lookup throws
      mockGetTemplateById.mockRejectedValueOnce(new Error('Network error'));

      const count = await service.executeDueSchedules();

      expect(count).toBe(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to execute schedule sched-fail'),
        expect.any(Error),
      );
      // Second schedule still ran
      expect(mockStatusReportGenerate).toHaveBeenCalledWith('proj-1', 'user-1', expect.any(Object));
    });

    it('records error status with nextRunAt when execution throws', async () => {
      const schedule = makeSchedule({ id: 'sched-err', templateId: 'status-report::proj-1' });
      mockRepo.findDue.mockResolvedValueOnce([schedule]);
      mockStatusReportGenerate.mockRejectedValueOnce(new Error('Generation failed'));

      const count = await service.executeDueSchedules();

      expect(count).toBe(0);
      expect(mockRepo.updateRunStatus).toHaveBeenCalledWith(
        'sched-err',
        expect.any(String),
        'error',
        'Generation failed',
        expect.any(String), // nextRunAt still computed in catch block
      );
    });

    it('processes multiple due schedules of mixed types', async () => {
      const schedules = [
        makeSchedule({ id: 's1', templateId: 'status-report::p1' }),
        makeSchedule({ id: 's2', templateId: 'raid-report::p2' }),
        makeSchedule({ id: 's3', templateId: 'tmpl-5' }),
      ];
      mockRepo.findDue.mockResolvedValueOnce(schedules);
      mockGetTemplateById.mockResolvedValueOnce({ id: 'tmpl-5', name: 'Custom' });
      mockExportReport.mockResolvedValueOnce({ data: 'data' });

      const count = await service.executeDueSchedules();

      expect(count).toBe(3);
      expect(mockStatusReportGenerate).toHaveBeenCalledTimes(1);
      expect(mockRaidReportGenerate).toHaveBeenCalledTimes(1);
      expect(mockSendReportEmail).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Executed 3 scheduled report(s)'),
      );
    });
  });

  // ────────────── computeNextRun ──────────────
  describe('computeNextRun', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    // Helper: computeNextRun uses local-time setHours but toISOString (UTC),
    // so the hour in the output string is offset by the local timezone.
    // We build an expected reference Date the same way the service does,
    // to keep assertions timezone-agnostic.
    function expectedIso(localDate: Date): string {
      return localDate.toISOString().replace('T', ' ').substring(0, 19);
    }

    it('returns tomorrow for daily when timeOfDay has already passed', () => {
      vi.setSystemTime(new Date(2026, 8, 13, 10, 0, 0));

      const result = service.computeNextRun('daily', null, null, '08:00');

      const expected = new Date(2026, 8, 14, 8, 0, 0);
      expect(result).toBe(expectedIso(expected));
    });

    it('returns today for daily when timeOfDay has not yet passed', () => {
      vi.setSystemTime(new Date(2026, 8, 13, 6, 0, 0));

      const result = service.computeNextRun('daily', null, null, '08:00');

      const expected = new Date(2026, 8, 13, 8, 0, 0);
      expect(result).toBe(expectedIso(expected));
    });

    it('returns the correct future weekday for weekly frequency', () => {
      // 2026-09-14 is a Monday (day 1). Target day=3 (Wednesday)
      vi.setSystemTime(new Date(2026, 8, 14, 6, 0, 0));

      const result = service.computeNextRun('weekly', 3, null, '09:00');

      const expected = new Date(2026, 8, 16, 9, 0, 0); // Wednesday
      expect(result).toBe(expectedIso(expected));
    });

    it('advances to next week when weekly target day has already passed', () => {
      // 2026-09-17 is a Thursday (day 4). Target day=1 (Monday)
      vi.setSystemTime(new Date(2026, 8, 17, 10, 0, 0));

      const result = service.computeNextRun('weekly', 1, null, '08:00');

      const expected = new Date(2026, 8, 21, 8, 0, 0); // next Monday
      expect(result).toBe(expectedIso(expected));
    });

    it('advances to next week when weekly target day is today but time has passed', () => {
      // 2026-09-14 is a Monday (day 1). Target day=1, time already passed
      vi.setSystemTime(new Date(2026, 8, 14, 12, 0, 0));

      const result = service.computeNextRun('weekly', 1, null, '08:00');

      const expected = new Date(2026, 8, 21, 8, 0, 0); // next Monday
      expect(result).toBe(expectedIso(expected));
    });

    it('defaults to Monday (day 1) when dayOfWeek is null for weekly', () => {
      // 2026-09-17 is a Thursday
      vi.setSystemTime(new Date(2026, 8, 17, 6, 0, 0));

      const result = service.computeNextRun('weekly', null, null, '08:00');

      const expected = new Date(2026, 8, 21, 8, 0, 0); // next Monday
      expect(result).toBe(expectedIso(expected));
    });

    it('returns the correct day for monthly frequency', () => {
      // Current: 2026-09-05 06:00. Target day: 15
      vi.setSystemTime(new Date(2026, 8, 5, 6, 0, 0));

      const result = service.computeNextRun('monthly', null, 15, '09:00');

      const expected = new Date(2026, 8, 15, 9, 0, 0);
      expect(result).toBe(expectedIso(expected));
    });

    it('advances to next month when monthly target day has passed', () => {
      vi.setSystemTime(new Date(2026, 8, 20, 10, 0, 0));

      const result = service.computeNextRun('monthly', null, 10, '08:00');

      const expected = new Date(2026, 9, 10, 8, 0, 0); // October 10
      expect(result).toBe(expectedIso(expected));
    });

    it('defaults to day 1 when dayOfMonth is null for monthly', () => {
      vi.setSystemTime(new Date(2026, 8, 5, 6, 0, 0));

      const result = service.computeNextRun('monthly', null, null, '08:00');

      const expected = new Date(2026, 9, 1, 8, 0, 0); // Oct 1
      expect(result).toBe(expectedIso(expected));
    });

    it('defaults to 08:00 when timeOfDay is empty', () => {
      vi.setSystemTime(new Date(2026, 8, 13, 6, 0, 0));

      const result = service.computeNextRun('daily', null, null, '');

      const expected = new Date(2026, 8, 13, 8, 0, 0);
      expect(result).toBe(expectedIso(expected));
    });

    it('returns ISO-like format without T separator', () => {
      vi.setSystemTime(new Date(2026, 8, 13, 6, 0, 0));

      const result = service.computeNextRun('daily', null, null, '10:00');

      // Should be "YYYY-MM-DD HH:MM:SS" — no T, no Z, no milliseconds
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });
  });
});
