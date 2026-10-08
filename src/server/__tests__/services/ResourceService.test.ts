import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks (must be before imports) ---

vi.mock('../../database/connection', () => ({
  databaseService: {
    query: vi.fn().mockResolvedValue([]),
    queryControlPlane: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../middleware/requestContext', async (importOriginal) => ({ ...(await importOriginal<any>()),
  getRequestContext: vi.fn().mockReturnValue({ organizationId: 'org1' }),
  getActorSource: vi.fn().mockReturnValue('web'),
}));

vi.mock('../../database/ResourceRepository', () => {
  const mockRepo = {
    findAllOrdered: vi.fn().mockResolvedValue([]),
    findAllPaginated: vi.fn().mockResolvedValue({ resources: [], total: 0 }),
    findById: vi.fn().mockResolvedValue(null),
    findByIds: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    updateResource: vi.fn().mockResolvedValue(false),
    deleteResource: vi.fn().mockResolvedValue(false),
    deleteResources: vi.fn().mockResolvedValue(0),
    findAssignmentsBySchedule: vi.fn().mockResolvedValue([]),
    findAssignmentsByResource: vi.fn().mockResolvedValue([]),
    findAssignmentsByScheduleIds: vi.fn().mockResolvedValue([]),
    findAllAssignments: vi.fn().mockResolvedValue([]),
    findOverlappingAssignments: vi.fn().mockResolvedValue([]),
    findEffectiveAssignments: vi.fn().mockResolvedValue([]),
    createAssignment: vi.fn(),
    deleteAssignment: vi.fn().mockResolvedValue(false),
  };
  return { resourceRepository: mockRepo };
});

vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findByProjectId: vi.fn().mockResolvedValue([]),
    findTaskById: vi.fn().mockResolvedValue(null),
    // Monday–Friday plans
    workingDayTest: vi.fn().mockResolvedValue((d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6),
  },
}));

vi.mock('../../services/AuditLedgerService', () => ({
  auditLedgerService: {
    append: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/ResourceAvailabilityService', () => ({
  resourceAvailabilityService: {
    getEffectiveCapacity: vi.fn().mockResolvedValue(40),
    getEffectiveCapacityBatch: vi.fn().mockResolvedValue(new Map()),
  },
}));

vi.mock('../../services/DeadLetterService', () => ({
  deadLetterService: {
    capture: vi.fn(),
  },
}));

vi.mock('../../database/TimeEntryRepository', () => ({
  timeEntryRepository: {
    sumHoursByUserAndWeekRange: vi.fn().mockResolvedValue([]),
    sumHoursByRateTypeAndWeekRange: vi.fn().mockResolvedValue([]),
    sumHoursByUsersAndWeekRange: vi.fn().mockResolvedValue(new Map()),
  },
}));

// --- Imports ---

import { ResourceService, normalizeSkills, ResourceValidationError, peopleNeeded } from '../../services/ResourceService';
import type { Resource, ResourceAssignment } from '../../services/ResourceService';
import { resourceRepository } from '../../database/ResourceRepository';
import { scheduleService } from '../../services/ScheduleService';
import { auditLedgerService } from '../../services/AuditLedgerService';
import { resourceAvailabilityService } from '../../services/ResourceAvailabilityService';
import { timeEntryRepository } from '../../database/TimeEntryRepository';
import { databaseService } from '../../database/connection';
import { getRequestContext } from '../../middleware/requestContext';

const mockRepo = resourceRepository as any;
const mockScheduleService = scheduleService as any;
const mockAvailabilityService = resourceAvailabilityService as any;
const mockTimeEntryRepo = timeEntryRepository as any;
const mockDb = databaseService as any;
const mockGetRequestContext = getRequestContext as any;

// --- Fixtures ---

const sampleResource: Resource = {
  id: 'r1',
  name: 'Alice Smith',
  role: 'Developer',
  email: 'alice@example.com',
  capacityHoursPerWeek: 40,
  skills: [{ name: 'TypeScript', level: 4 }],
  isActive: true,
  costRateHourly: 75,
  overtimeRateHourly: null,
  resourceGroup: 'Engineering',
  userId: null,
  calendarTemplateId: null,
};

const sampleResource2: Resource = {
  ...sampleResource,
  id: 'r2',
  name: 'Bob Jones',
  email: 'bob@example.com',
  role: 'Designer',
  costRateHourly: 60,
  userId: 'u2',
};

const sampleAssignment: ResourceAssignment = {
  id: 'a1',
  resourceId: 'r1',
  taskId: 't1',
  scheduleId: 's1',
  hoursPerWeek: 20,
  startDate: '2026-01-06',
  endDate: '2026-02-06',
};

// --- Tests ---

describe('normalizeSkills', () => {
  it('converts plain strings to SkillWithProficiency with level 3', () => {
    const result = normalizeSkills(['TypeScript', 'React']);
    expect(result).toEqual([
      { name: 'TypeScript', level: 3 },
      { name: 'React', level: 3 },
    ]);
  });

  it('passes through SkillWithProficiency objects unchanged', () => {
    const input = [{ name: 'Go', level: 5 }];
    const result = normalizeSkills(input);
    expect(result).toEqual([{ name: 'Go', level: 5 }]);
  });

  it('handles mixed string and object input', () => {
    const result = normalizeSkills(['CSS', { name: 'Rust', level: 2 }]);
    expect(result).toEqual([
      { name: 'CSS', level: 3 },
      { name: 'Rust', level: 2 },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(normalizeSkills([])).toEqual([]);
  });
});

describe('ResourceService', () => {
  let service: ResourceService;

  beforeEach(() => {
    service = new ResourceService();
    vi.clearAllMocks();
  });

  // ===== Resource CRUD =====

  describe('findAllResources', () => {
    it('delegates to repository', async () => {
      mockRepo.findAllOrdered.mockResolvedValueOnce([sampleResource]);
      const result = await service.findAllResources();
      expect(result).toEqual([sampleResource]);
      expect(mockRepo.findAllOrdered).toHaveBeenCalledOnce();
    });

    it('returns empty array when no resources', async () => {
      mockRepo.findAllOrdered.mockResolvedValueOnce([]);
      const result = await service.findAllResources();
      expect(result).toEqual([]);
    });
  });

  describe('findAllResourcesPaginated', () => {
    it('passes default limit and offset', async () => {
      mockRepo.findAllPaginated.mockResolvedValueOnce({ resources: [sampleResource], total: 1 });
      const result = await service.findAllResourcesPaginated();
      expect(mockRepo.findAllPaginated).toHaveBeenCalledWith(50, 0, undefined);
      expect(result.total).toBe(1);
    });

    it('passes custom limit, offset, and group', async () => {
      mockRepo.findAllPaginated.mockResolvedValueOnce({ resources: [], total: 0 });
      await service.findAllResourcesPaginated(10, 20, 'Engineering');
      expect(mockRepo.findAllPaginated).toHaveBeenCalledWith(10, 20, 'Engineering');
    });
  });

  describe('findResourceById', () => {
    it('returns resource when found', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleResource);
      const result = await service.findResourceById('r1');
      expect(result).toEqual(sampleResource);
    });

    it('returns null when not found', async () => {
      mockRepo.findById.mockResolvedValueOnce(null);
      const result = await service.findResourceById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('every person has an email; a generic role never does (2026-10-01)', () => {
    it('refuses a person without an email, with a message saying what to do', async () => {
      const { id, ...data } = sampleResource;
      await expect(service.createResource({ ...data, email: '' })).rejects.toThrow(ResourceValidationError);
      await expect(service.createResource({ ...data, email: '   ' })).rejects.toThrow(/generic role/);
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('creates a generic role with no email and no login, whatever the caller sent', async () => {
      mockRepo.create.mockResolvedValueOnce({ ...sampleResource, email: '', isGeneric: true });
      const { id, ...data } = sampleResource;
      await service.createResource({ ...data, email: 'someone@x.com', userId: 'u9', isGeneric: true });
      expect(mockRepo.create).toHaveBeenCalledWith(expect.objectContaining({ email: '', userId: null, isGeneric: true }));
    });

    it("keeps a generic role generic: email, login and the flag itself can't be changed", async () => {
      mockRepo.findById.mockResolvedValueOnce({ ...sampleResource, email: '', isGeneric: true }).mockResolvedValueOnce({ ...sampleResource, name: 'Generic Tester', email: '', isGeneric: true });
      mockRepo.updateResource.mockResolvedValueOnce(true);
      await service.updateResource('r1', { name: 'Generic Tester', email: 'a@b.com', userId: 'u1', isGeneric: false });
      expect(mockRepo.updateResource).toHaveBeenCalledWith('r1', { name: 'Generic Tester' });
    });

    it("lets a person's other fields change without sending the email", async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleResource).mockResolvedValueOnce({ ...sampleResource, role: 'Lead' });
      mockRepo.updateResource.mockResolvedValueOnce(true);
      await expect(service.updateResource('r1', { role: 'Lead' })).resolves.toBeTruthy();
    });
  });

  describe('every person has a line manager (2026-10-02)', () => {
    const { id: _id, ...person } = sampleResource;
    it('no line manager given → the company owner, marked "set by default"', async () => {
      mockDb.queryControlPlane.mockResolvedValueOnce([{ owner_user_id: 'owner-1' }]);
      mockRepo.create.mockResolvedValueOnce(sampleResource);
      await service.createResource(person);
      expect(mockRepo.create).toHaveBeenCalledWith(expect.objectContaining({ lineManagerUserId: 'owner-1', lineManagerIsDefault: true }));
    });

    it('a chosen line manager must be an active user of the company', async () => {
      mockDb.queryControlPlane.mockResolvedValueOnce([]); // not in this company
      await expect(service.createResource({ ...person, lineManagerUserId: 'stranger' })).rejects.toThrow(/isn't an active user/);
      mockDb.queryControlPlane.mockResolvedValueOnce([{ id: 'u-old', is_active: 0 }]);
      await expect(service.createResource({ ...person, lineManagerUserId: 'u-old' })).rejects.toThrow(/isn't an active user/);
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it("nobody is their own line manager — except the company owner", async () => {
      mockDb.queryControlPlane.mockResolvedValueOnce([{ id: 'u-peter', is_active: 1 }]).mockResolvedValueOnce([{ owner_user_id: 'owner-1' }]);
      await expect(service.createResource({ ...person, userId: 'u-peter', lineManagerUserId: 'u-peter' })).rejects.toThrow(/own line manager/);
      mockDb.queryControlPlane.mockResolvedValueOnce([{ id: 'owner-1', is_active: 1 }]).mockResolvedValueOnce([{ owner_user_id: 'owner-1' }]);
      mockRepo.create.mockResolvedValueOnce(sampleResource);
      await expect(service.createResource({ ...person, userId: 'owner-1', lineManagerUserId: 'owner-1' })).resolves.toBeTruthy();
    });

    it('saving the line manager confirms it; it can never be removed', async () => {
      mockRepo.findById.mockResolvedValueOnce({ ...sampleResource, lineManagerUserId: 'owner-1', lineManagerIsDefault: true }).mockResolvedValueOnce(sampleResource);
      mockDb.queryControlPlane.mockResolvedValueOnce([{ id: 'u-mary', is_active: 1 }]);
      mockRepo.updateResource.mockResolvedValueOnce(true);
      await service.updateResource('r1', { lineManagerUserId: 'u-mary' });
      expect(mockRepo.updateResource).toHaveBeenCalledWith('r1', { lineManagerUserId: 'u-mary', lineManagerIsDefault: false });

      mockRepo.findById.mockResolvedValueOnce(sampleResource);
      await expect(service.updateResource('r1', { lineManagerUserId: null })).rejects.toThrow(/Choose a line manager/);
    });

    it('generic roles never have one', async () => {
      mockRepo.create.mockResolvedValueOnce({ ...sampleResource, isGeneric: true });
      await service.createResource({ ...person, isGeneric: true, lineManagerUserId: 'owner-1' });
      expect(mockRepo.create).toHaveBeenCalledWith(expect.objectContaining({ lineManagerUserId: null, lineManagerIsDefault: false }));
    });
  });

  describe('peopleNeeded (unfilled demand)', () => {
    it("counts full-time people for a week's hours", () => {
      expect(peopleNeeded(0, 40)).toBe(0);
      expect(peopleNeeded(20, 40)).toBe(1);
      expect(peopleNeeded(40, 40)).toBe(1);
      expect(peopleNeeded(41, 40)).toBe(2);
      expect(peopleNeeded(120, 40)).toBe(3);
      expect(peopleNeeded(30, 0)).toBe(1); // no capacity set: a 40 h week
    });
  });

  describe('createResource', () => {
    it('creates resource and returns it', async () => {
      mockRepo.create.mockResolvedValueOnce(sampleResource);
      const { id, ...data } = sampleResource;
      mockDb.queryControlPlane.mockResolvedValueOnce([{ owner_user_id: 'owner-1' }]); // the default line manager
      const result = await service.createResource(data);
      expect(result).toEqual(sampleResource);
      expect(mockRepo.create).toHaveBeenCalledWith({ ...data, lineManagerUserId: 'owner-1', lineManagerIsDefault: true });
    });

    it('attempts autoLinkUser after creation (fire-and-forget)', async () => {
      mockRepo.create.mockResolvedValueOnce(sampleResource);
      mockDb.queryControlPlane.mockResolvedValueOnce([{ owner_user_id: 'owner-1' }]).mockResolvedValueOnce([{ id: 'u1' }]);

      const { id, ...data } = sampleResource;
      await service.createResource(data);

      // autoLinkUser is fire-and-forget, so we verify it was attempted
      // The query to look up user by email should eventually be called
      // Since it's async fire-and-forget, we await a tick
      await new Promise(r => setTimeout(r, 10));
      expect(mockDb.queryControlPlane).toHaveBeenCalled();
    });
  });

  describe('updateResource', () => {
    it('returns null when resource not found', async () => {
      mockRepo.findById.mockResolvedValueOnce(null);
      const result = await service.updateResource('nonexistent', { name: 'New Name' });
      expect(result).toBeNull();
    });

    it('returns existing resource when no fields changed', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleResource);
      mockRepo.updateResource.mockResolvedValueOnce(false);
      const result = await service.updateResource('r1', {});
      expect(result).toEqual(sampleResource);
    });

    it('updates resource and appends audit log', async () => {
      const updated = { ...sampleResource, name: 'Alice Updated' };
      mockRepo.findById
        .mockResolvedValueOnce(sampleResource)   // existing lookup
        .mockResolvedValueOnce(updated);           // post-update lookup
      mockRepo.updateResource.mockResolvedValueOnce(true);

      const result = await service.updateResource('r1', { name: 'Alice Updated' });
      expect(result).toEqual(updated);
      expect((auditLedgerService.append as any)).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'resource.update',
          entityType: 'resource',
          entityId: 'r1',
        }),
      );
    });

    it('re-links user when email changes', async () => {
      const updated = { ...sampleResource, email: 'newalice@example.com' };
      mockRepo.findById
        .mockResolvedValueOnce(sampleResource)
        .mockResolvedValueOnce(updated);
      mockRepo.updateResource.mockResolvedValueOnce(true);
      mockDb.queryControlPlane.mockResolvedValueOnce([{ id: 'u-new' }]);

      await service.updateResource('r1', { email: 'newalice@example.com' });

      // Allow fire-and-forget autoLinkUser to run
      await new Promise(r => setTimeout(r, 10));
      expect(mockDb.queryControlPlane).toHaveBeenCalled();
    });

    it('does not re-link user when email is unchanged', async () => {
      const updated = { ...sampleResource, name: 'Renamed' };
      mockRepo.findById
        .mockResolvedValueOnce(sampleResource)
        .mockResolvedValueOnce(updated);
      mockRepo.updateResource.mockResolvedValueOnce(true);

      await service.updateResource('r1', { name: 'Renamed' });
      await new Promise(r => setTimeout(r, 10));

      // queryControlPlane should NOT be called since email didn't change
      expect(mockDb.queryControlPlane).not.toHaveBeenCalled();
    });
  });

  describe('deleteResource', () => {
    it('delegates to repository and returns true on success', async () => {
      mockRepo.deleteResource.mockResolvedValueOnce(true);
      const result = await service.deleteResource('r1');
      expect(result).toBe(true);
      expect(mockRepo.deleteResource).toHaveBeenCalledWith('r1');
    });

    it('returns false when resource not found', async () => {
      mockRepo.deleteResource.mockResolvedValueOnce(false);
      const result = await service.deleteResource('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('deleteResources', () => {
    it('delegates to repository and returns count', async () => {
      mockRepo.deleteResources.mockResolvedValueOnce(3);
      const result = await service.deleteResources(['r1', 'r2', 'r3']);
      expect(result).toBe(3);
      expect(mockRepo.deleteResources).toHaveBeenCalledWith(['r1', 'r2', 'r3']);
    });

    it('returns 0 for empty array', async () => {
      mockRepo.deleteResources.mockResolvedValueOnce(0);
      const result = await service.deleteResources([]);
      expect(result).toBe(0);
    });
  });

  // ===== Assignment CRUD =====

  describe('findAssignmentsBySchedule', () => {
    it('delegates to repository', async () => {
      mockRepo.findAssignmentsBySchedule.mockResolvedValueOnce([sampleAssignment]);
      const result = await service.findAssignmentsBySchedule('s1');
      expect(result).toEqual([sampleAssignment]);
    });
  });

  describe('findAssignmentsByResource', () => {
    it('delegates to repository', async () => {
      mockRepo.findAssignmentsByResource.mockResolvedValueOnce([sampleAssignment]);
      const result = await service.findAssignmentsByResource('r1');
      expect(result).toEqual([sampleAssignment]);
    });
  });

  describe('findAllAssignments', () => {
    it('delegates to repository', async () => {
      mockRepo.findAllAssignments.mockResolvedValueOnce([sampleAssignment]);
      const result = await service.findAllAssignments();
      expect(result).toEqual([sampleAssignment]);
    });
  });

  describe('checkAssignmentConflicts', () => {
    it('returns empty warnings when resource not found', async () => {
      mockRepo.findById.mockResolvedValueOnce(null);
      const result = await service.checkAssignmentConflicts({
        resourceId: 'nonexistent',
        hoursPerWeek: 20,
        startDate: '2026-01-06',
        endDate: '2026-02-06',
      });
      expect(result.warnings).toEqual([]);
    });

    it('returns no warnings when under capacity', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleResource); // 40h capacity
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([
        { ...sampleAssignment, hoursPerWeek: 10 },
      ]);

      const result = await service.checkAssignmentConflicts({
        resourceId: 'r1',
        hoursPerWeek: 20, // 10 + 20 = 30 < 40
        startDate: '2026-01-06',
        endDate: '2026-02-06',
      });
      expect(result.warnings).toEqual([]);
    });

    it('returns warning when over capacity', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleResource); // 40h capacity
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([
        { ...sampleAssignment, hoursPerWeek: 25 },
      ]);

      const result = await service.checkAssignmentConflicts({
        resourceId: 'r1',
        hoursPerWeek: 20, // 25 + 20 = 45 > 40
        startDate: '2026-01-06',
        endDate: '2026-02-06',
      });
      expect(result.warnings).toHaveLength(1);
      // Week by week now (2026-10-01): the busiest week, and how many others are over
      expect(result.warnings[0]).toContain('45h against 40h capacity (113% utilization) in the week of 2026-01-12'); // 6 Jan is a Tuesday: that first week has 4 days, 36 h
      expect(result.warnings[0]).toMatch(/and \d+ other weeks/);
    });

    it('returns warning when exactly at capacity boundary exceeded', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleResource); // 40h capacity
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([
        { ...sampleAssignment, hoursPerWeek: 30 },
      ]);

      const result = await service.checkAssignmentConflicts({
        resourceId: 'r1',
        hoursPerWeek: 11, // 30 + 11 = 41 > 40
        startDate: '2026-01-06',
        endDate: '2026-02-06',
      });
      expect(result.warnings).toHaveLength(1);
    });

    it('returns no warnings when exactly at capacity', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleResource); // 40h
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([
        { ...sampleAssignment, hoursPerWeek: 20 },
      ]);

      const result = await service.checkAssignmentConflicts({
        resourceId: 'r1',
        hoursPerWeek: 20, // 20 + 20 = 40 = capacity
        startDate: '2026-01-06',
        endDate: '2026-02-06',
      });
      expect(result.warnings).toEqual([]);
    });

    it("doesn't count the person's existing booking on the same task (the new one replaces it)", async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleResource);
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([{ ...sampleAssignment, taskId: 't1', hoursPerWeek: 30 }]);
      const result = await service.checkAssignmentConflicts({ resourceId: 'r1', taskId: 't1', hoursPerWeek: 20, startDate: '2026-01-06', endDate: '2026-02-06' });
      expect(result.warnings).toEqual([]);
    });

    it('only counts bookings in the same week — a booking in March is no conflict for one in January', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleResource);
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([{ ...sampleAssignment, taskId: 't9', hoursPerWeek: 40, startDate: '2026-03-02', endDate: '2026-03-06' }]);
      const result = await service.checkAssignmentConflicts({ resourceId: 'r1', hoursPerWeek: 20, startDate: '2026-01-06', endDate: '2026-02-06' });
      expect(result.warnings).toEqual([]);
    });

    it('sums hours from multiple overlapping assignments', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleResource); // 40h
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([
        { ...sampleAssignment, id: 'a1', hoursPerWeek: 15 },
        { ...sampleAssignment, id: 'a2', hoursPerWeek: 10 },
      ]);

      const result = await service.checkAssignmentConflicts({
        resourceId: 'r1',
        hoursPerWeek: 20, // 15 + 10 + 20 = 45 > 40
        startDate: '2026-01-06',
        endDate: '2026-02-06',
      });
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('45h against 40h');
    });
  });

  describe('createAssignment', () => {
    it('creates assignment and returns it with warnings', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleResource);
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([]);
      mockRepo.createAssignment.mockResolvedValueOnce(sampleAssignment);

      const { id, ...data } = sampleAssignment;
      const result = await service.createAssignment(data);

      expect(result.assignment).toEqual(sampleAssignment);
      expect(result.warnings).toEqual([]);
      expect(mockRepo.createAssignment).toHaveBeenCalledWith(data);
    });

    it('creates assignment even with over-allocation warnings', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleResource);
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([
        { ...sampleAssignment, taskId: 't-other', hoursPerWeek: 30 },
      ]);
      mockRepo.createAssignment.mockResolvedValueOnce(sampleAssignment);

      const { id, ...data } = sampleAssignment;
      const result = await service.createAssignment(data);

      expect(result.assignment).toEqual(sampleAssignment);
      expect(result.warnings).toHaveLength(1);
    });

    it('appends audit log on creation', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleResource);
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([]);
      mockRepo.createAssignment.mockResolvedValueOnce(sampleAssignment);

      const { id, ...data } = sampleAssignment;
      await service.createAssignment(data);

      expect((auditLedgerService.append as any)).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'resource.assign',
          entityType: 'resource_assignment',
          entityId: 'a1',
        }),
      );
    });
  });

  describe('deleteAssignment', () => {
    it('delegates to repository', async () => {
      mockRepo.deleteAssignment.mockResolvedValueOnce(true);
      const result = await service.deleteAssignment('a1');
      expect(result).toBe(true);
    });

    it('returns false when not found', async () => {
      mockRepo.deleteAssignment.mockResolvedValueOnce(false);
      const result = await service.deleteAssignment('nonexistent');
      expect(result).toBe(false);
    });
  });

  // ===== Workload computation =====

  describe('computeWorkload', () => {
    it("counts the person's other projects too, keeps the split, costs only this project, and is 'over' only in weeks they work here", async () => {
      mockScheduleService.findByProjectId.mockResolvedValueOnce([{ id: 's1' }]);
      // This project: the week of 12 Jan only, full time
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([{ ...sampleAssignment, scheduleId: 's1', hoursPerWeek: 40, startDate: '2026-01-12', endDate: '2026-01-16' }]);
      mockRepo.findByIds.mockResolvedValueOnce([sampleResource]); // $75/h
      mockAvailabilityService.getEffectiveCapacityBatch.mockResolvedValueOnce(new Map([['r1', new Map()]]));
      // Another project: 24 h/week for weeks of 12 and 19 Jan (19 Jan has no work here)
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([
        { ...sampleAssignment, id: 'x', taskId: 'other', scheduleId: 's-other', hoursPerWeek: 24, startDate: '2026-01-12', endDate: '2026-01-23' },
        { ...sampleAssignment, id: 'y', taskId: 'mine', scheduleId: 's1', hoursPerWeek: 40, startDate: '2026-01-12', endDate: '2026-01-16' }, // this project's own: not counted twice
      ]);

      const [w] = await service.computeWorkload('p1');
      const jan12 = w.weeks.find(x => x.weekStart === '2026-01-12')!;
      expect(jan12).toMatchObject({ thisProject: 40, otherProjects: 24, allocated: 64, utilization: 160, cost: 3000 });
      const jan19 = w.weeks.find(x => x.weekStart === '2026-01-19');
      if (jan19) expect(jan19).toMatchObject({ thisProject: 0, otherProjects: 24 });
      expect(w.isOverAllocated).toBe(true);
    });

    it("isn't 'over' here when the only overloaded week has no work on this project", async () => {
      mockScheduleService.findByProjectId.mockResolvedValueOnce([{ id: 's1' }]);
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([{ ...sampleAssignment, scheduleId: 's1', hoursPerWeek: 20, startDate: '2026-01-12', endDate: '2026-01-16' }]);
      mockRepo.findByIds.mockResolvedValueOnce([sampleResource]);
      mockAvailabilityService.getEffectiveCapacityBatch.mockResolvedValueOnce(new Map([['r1', new Map()]]));
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([
        { ...sampleAssignment, id: 'x', taskId: 'other', scheduleId: 's-other', hoursPerWeek: 60, startDate: '2026-01-19', endDate: '2026-01-23' },
      ]);
      const [w] = await service.computeWorkload('p1');
      expect(w.weeks.some(x => x.utilization > 100)).toBe(true); // 150% in the week of 19 Jan…
      expect(w.isOverAllocated).toBe(false);                      // …but nothing of this project's is in it
    });

    it('returns empty array when project has no schedules', async () => {
      mockScheduleService.findByProjectId.mockResolvedValueOnce([]);
      const result = await service.computeWorkload('p1');
      expect(result).toEqual([]);
    });

    it('returns empty workloads when schedules have no assignments', async () => {
      mockScheduleService.findByProjectId.mockResolvedValueOnce([{ id: 's1' }]);
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([]);

      const result = await service.computeWorkload('p1');
      expect(result).toEqual([]);
    });

    it('computes workload for a single resource with assignments', async () => {
      mockScheduleService.findByProjectId.mockResolvedValueOnce([{ id: 's1' }]);
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([
        {
          ...sampleAssignment,
          startDate: '2026-01-06',
          endDate: '2026-01-20',
        },
      ]);
      mockRepo.findByIds.mockResolvedValueOnce([sampleResource]);

      // Return a capacity map with entries for each week
      const capacityMap = new Map();
      capacityMap.set('r1', new Map()); // empty inner map = will fall back to baseCapacity
      mockAvailabilityService.getEffectiveCapacityBatch.mockResolvedValueOnce(capacityMap);

      const result = await service.computeWorkload('p1');
      expect(result).toHaveLength(1);
      expect(result[0].resourceId).toBe('r1');
      expect(result[0].resourceName).toBe('Alice Smith');
      expect(result[0].role).toBe('Developer');
      expect(result[0].costRateHourly).toBe(75);
      expect(result[0].weeks.length).toBeGreaterThanOrEqual(8); // minimum 8 weeks
    });

    it('marks resource as over-allocated when utilization exceeds 100%', async () => {
      mockScheduleService.findByProjectId.mockResolvedValueOnce([{ id: 's1' }]);

      // Resource with 40h capacity, assigned 50h
      const overAssignment = { ...sampleAssignment, hoursPerWeek: 50, startDate: '2026-01-06', endDate: '2026-01-20' };
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([overAssignment]);
      mockRepo.findByIds.mockResolvedValueOnce([sampleResource]);

      const capacityMap = new Map();
      capacityMap.set('r1', new Map());
      mockAvailabilityService.getEffectiveCapacityBatch.mockResolvedValueOnce(capacityMap);

      const result = await service.computeWorkload('p1');
      expect(result[0].isOverAllocated).toBe(true);
    });

    it('fetches actual hours when resource has userId', async () => {
      const linkedResource = { ...sampleResource, userId: 'u1' };
      mockScheduleService.findByProjectId.mockResolvedValueOnce([{ id: 's1' }]);
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([
        { ...sampleAssignment, startDate: '2026-01-06', endDate: '2026-01-20' },
      ]);
      mockRepo.findByIds.mockResolvedValueOnce([linkedResource]);

      const capacityMap = new Map();
      capacityMap.set('r1', new Map());
      mockAvailabilityService.getEffectiveCapacityBatch.mockResolvedValueOnce(capacityMap);

      mockTimeEntryRepo.sumHoursByUsersAndWeekRange.mockResolvedValueOnce(new Map([
        ['u1', [{ weekStart: '2026-01-06', totalHours: 35, standardHours: 30, overtimeHours: 5 }]],
      ]));

      const result = await service.computeWorkload('p1');
      // This project's approved hours only — not the person's time on other projects — for
      // everyone at once (one query, 2026-10-05)
      expect(mockTimeEntryRepo.sumHoursByUsersAndWeekRange).toHaveBeenCalledWith(
        ['u1'], expect.any(String), expect.any(String), 'p1',
      );
      expect(mockTimeEntryRepo.sumHoursByUserAndWeekRange).not.toHaveBeenCalled();

      // Check that actual hours are populated for the relevant week
      const weekWithActual = result[0].weeks.find(w => w.weekStart === '2026-01-06');
      if (weekWithActual) {
        expect(weekWithActual.actual).toBe(35);
      }
    });

    it('computes cost using rate-type breakdown when available', async () => {
      const linkedResource = { ...sampleResource, userId: 'u1', costRateHourly: 100, overtimeRateHourly: 150 };
      mockScheduleService.findByProjectId.mockResolvedValueOnce([{ id: 's1' }]);
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([
        { ...sampleAssignment, startDate: '2026-01-06', endDate: '2026-01-13', hoursPerWeek: 40 },
      ]);
      mockRepo.findByIds.mockResolvedValueOnce([linkedResource]);

      const capacityMap = new Map();
      capacityMap.set('r1', new Map());
      mockAvailabilityService.getEffectiveCapacityBatch.mockResolvedValueOnce(capacityMap);

      mockTimeEntryRepo.sumHoursByUsersAndWeekRange.mockResolvedValueOnce(new Map([
        ['u1', [{ weekStart: '2026-01-06', totalHours: 45, standardHours: 40, overtimeHours: 5 }]],
      ]));

      const result = await service.computeWorkload('p1');
      // cost for that week = 40 * 100 + 5 * 150 = 4750
      const weekData = result[0].weeks.find(w => w.weekStart === '2026-01-06');
      if (weekData) {
        expect(weekData.cost).toBe(4750);
      }
    });

    it('falls back to allocated * rate when no rate-type breakdown', async () => {
      mockScheduleService.findByProjectId.mockResolvedValueOnce([{ id: 's1' }]);
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([
        { ...sampleAssignment, startDate: '2026-01-06', endDate: '2026-01-13', hoursPerWeek: 20 },
      ]);
      mockRepo.findByIds.mockResolvedValueOnce([sampleResource]); // costRate = 75, no userId

      const capacityMap = new Map();
      capacityMap.set('r1', new Map());
      mockAvailabilityService.getEffectiveCapacityBatch.mockResolvedValueOnce(capacityMap);

      const result = await service.computeWorkload('p1');
      const weekData = result[0].weeks.find(w => w.weekStart === '2026-01-06');
      if (weekData) {
        // cost = 20 * 75 = 1500
        expect(weekData.cost).toBe(1500);
      }
    });

    it('handles zero capacity without division by zero', async () => {
      const zeroCap = { ...sampleResource, capacityHoursPerWeek: 0 };
      mockScheduleService.findByProjectId.mockResolvedValueOnce([{ id: 's1' }]);
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([
        { ...sampleAssignment, startDate: '2026-01-06', endDate: '2026-01-13' },
      ]);
      mockRepo.findByIds.mockResolvedValueOnce([zeroCap]);

      const capacityMap = new Map();
      capacityMap.set('r1', new Map());
      mockAvailabilityService.getEffectiveCapacityBatch.mockResolvedValueOnce(capacityMap);

      const result = await service.computeWorkload('p1');
      // utilization should be 0 when capacity is 0, not Infinity
      expect(result[0].weeks[0].utilization).toBe(0);
      expect(result[0].isOverAllocated).toBe(false);
    });

    it('skips resources not found in batch lookup', async () => {
      mockScheduleService.findByProjectId.mockResolvedValueOnce([{ id: 's1' }]);
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([
        { ...sampleAssignment, resourceId: 'r-deleted' },
      ]);
      mockRepo.findByIds.mockResolvedValueOnce([]); // resource not found

      mockAvailabilityService.getEffectiveCapacityBatch.mockResolvedValueOnce(new Map());

      const result = await service.computeWorkload('p1');
      expect(result).toEqual([]);
    });
  });

  // ===== Global workload =====

  describe('checkLoad (warning while allocating)', () => {
    const booking = (taskId: string, hoursPerWeek: number, startDate: string, endDate: string) =>
      ({ id: `task:${taskId}`, resourceId: 'r1', taskId, scheduleId: 's', hoursPerWeek, startDate, endDate, source: 'task' });

    it('adds this booking to what the person already has and returns only the weeks over 100%', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleResource);
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([
        booking('kickoff', 40, '2026-10-12', '2026-10-23'),   // weeks of 12 + 19 Oct
        booking('report', 40, '2026-10-12', '2027-02-26'),    // every week
      ]);
      const res = await service.checkLoad({ resourceId: 'r1', startDate: '2026-10-14', endDate: '2026-10-27', allocationPct: 50 });
      expect(res!.resourceName).toBe('Alice Smith');
      // This booking (20 h/week) counts only its own days: Wed–Fri of the first week (12 h),
      // the whole second week (20 h), Mon–Tue of the third (8 h)
      expect(res!.overWeeks.map(w => [w.weekStart, w.utilization, w.otherTaskIds])).toEqual([
        ['2026-10-12', 230, ['kickoff', 'report']],
        ['2026-10-19', 250, ['kickoff', 'report']],
        ['2026-10-26', 120, ['report']],
      ]);
    });

    it("doesn't count the task being edited twice, and says nothing at exactly 100%", async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleResource);
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([booking('this', 40, '2026-10-12', '2026-10-16'), booking('other', 20, '2026-10-12', '2026-10-16')]);
      const res = await service.checkLoad({ resourceId: 'r1', startDate: '2026-10-12', endDate: '2026-10-16', allocationPct: 50, excludeTaskId: 'this' });
      expect(res!.overWeeks).toEqual([]);
    });

    it('uses the week capacity (holidays lower it) and returns null for an unknown person', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleResource);
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([]);
      mockAvailabilityService.getEffectiveCapacityBatch.mockResolvedValueOnce(new Map([['r1', new Map([['2026-12-21', 16]])]]));
      // Mon–Thu full time = 32 h, against a 16 h holiday week
      const res = await service.checkLoad({ resourceId: 'r1', startDate: '2026-12-21', endDate: '2026-12-24', allocationPct: 100 });
      expect(res!.overWeeks).toEqual([{ weekStart: '2026-12-21', utilization: 200, hours: 32, capacity: 16, otherTaskIds: [] }]);
      mockRepo.findById.mockResolvedValueOnce(null);
      expect(await service.checkLoad({ resourceId: 'x', startDate: '2026-12-21', endDate: '2026-12-24', allocationPct: 50 })).toBeNull();
    });
  });

  describe('computeGlobalWorkload', () => {
    it('returns empty array when no assignments exist', async () => {
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([]);
      const result = await service.computeGlobalWorkload();
      expect(result).toEqual([]);
    });

    it('computes workload across all assignments', async () => {
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([
        { ...sampleAssignment, resourceId: 'r1', startDate: '2026-01-06', endDate: '2026-01-20' },
        { ...sampleAssignment, id: 'a2', resourceId: 'r2', startDate: '2026-01-06', endDate: '2026-01-20' },
      ]);
      mockRepo.findByIds.mockResolvedValueOnce([sampleResource, sampleResource2]);

      const capacityMap = new Map();
      capacityMap.set('r1', new Map());
      capacityMap.set('r2', new Map());
      mockAvailabilityService.getEffectiveCapacityBatch.mockResolvedValueOnce(capacityMap);

      // r2 has userId so time entries will be fetched (everyone in one query)
      mockTimeEntryRepo.sumHoursByUsersAndWeekRange.mockResolvedValueOnce(new Map());

      const result = await service.computeGlobalWorkload();
      expect(result).toHaveLength(2);
      expect(result.map(r => r.resourceId).sort()).toEqual(['r1', 'r2']);
    });

    it('calculates cost using allocated * rate (no rate-type breakdown in global)', async () => {
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([
        { ...sampleAssignment, hoursPerWeek: 30, startDate: '2026-01-06', endDate: '2026-01-13' },
      ]);
      mockRepo.findByIds.mockResolvedValueOnce([sampleResource]); // rate=75

      const capacityMap = new Map();
      capacityMap.set('r1', new Map());
      mockAvailabilityService.getEffectiveCapacityBatch.mockResolvedValueOnce(capacityMap);

      const result = await service.computeGlobalWorkload();
      const weekData = result[0].weeks.find(w => w.weekStart === '2026-01-06');
      if (weekData) {
        // cost = 30 * 75 = 2250
        expect(weekData.cost).toBe(2250);
      }
    });

    it('ensures at least 8 weeks of data', async () => {
      // Very short date range assignment
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([
        { ...sampleAssignment, startDate: '2026-01-06', endDate: '2026-01-07' },
      ]);
      mockRepo.findByIds.mockResolvedValueOnce([sampleResource]);

      const capacityMap = new Map();
      capacityMap.set('r1', new Map());
      mockAvailabilityService.getEffectiveCapacityBatch.mockResolvedValueOnce(capacityMap);

      const result = await service.computeGlobalWorkload();
      expect(result[0].weeks.length).toBeGreaterThanOrEqual(8);
    });
  });

  // ===== Utilization history =====

  describe('computeUtilizationHistory', () => {
    it('returns empty weeks when resource not found', async () => {
      mockRepo.findById.mockResolvedValueOnce(null);
      const result = await service.computeUtilizationHistory('nonexistent');
      expect(result.weeks).toEqual([]);
    });

    it('returns 12 weeks by default', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleResource);
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([]);
      mockAvailabilityService.getEffectiveCapacity.mockResolvedValue(40);

      const result = await service.computeUtilizationHistory('r1');
      expect(result.weeks).toHaveLength(12);
    });

    it('respects custom numWeeks', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleResource);
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([]);
      mockAvailabilityService.getEffectiveCapacity.mockResolvedValue(40);

      const result = await service.computeUtilizationHistory('r1', 4);
      expect(result.weeks).toHaveLength(4);
    });

    it('computes planned hours from overlapping assignments', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleResource);

      // Create an assignment that spans a very wide range to ensure overlap
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([
        {
          ...sampleAssignment,
          hoursPerWeek: 30,
          startDate: '2020-01-01',
          endDate: '2030-12-31',
        },
      ]);
      mockAvailabilityService.getEffectiveCapacity.mockResolvedValue(40);

      const result = await service.computeUtilizationHistory('r1', 4);
      // All weeks should have planned=30 since the assignment spans everything
      for (const week of result.weeks) {
        expect(week.planned).toBe(30);
        expect(week.utilization).toBe(75); // 30/40 * 100
      }
    });

    it('fetches actual hours when resource has userId', async () => {
      const linkedResource = { ...sampleResource, userId: 'u1' };
      mockRepo.findById.mockResolvedValueOnce(linkedResource);
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([]);
      mockAvailabilityService.getEffectiveCapacity.mockResolvedValue(40);

      mockTimeEntryRepo.sumHoursByUserAndWeekRange.mockResolvedValueOnce([]);

      await service.computeUtilizationHistory('r1', 4);
      expect(mockTimeEntryRepo.sumHoursByUserAndWeekRange).toHaveBeenCalledWith(
        'u1', expect.any(String), expect.any(String),
      );
    });

    it('does not fetch actual hours when resource has no userId', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleResource); // userId = null
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([]);
      mockAvailabilityService.getEffectiveCapacity.mockResolvedValue(40);

      await service.computeUtilizationHistory('r1', 4);
      expect(mockTimeEntryRepo.sumHoursByUserAndWeekRange).not.toHaveBeenCalled();
    });

    it('handles zero capacity in utilization history', async () => {
      const zeroCap = { ...sampleResource, capacityHoursPerWeek: 0 };
      mockRepo.findById.mockResolvedValueOnce(zeroCap);
      mockRepo.findEffectiveAssignments.mockResolvedValueOnce([]);
      mockAvailabilityService.getEffectiveCapacity.mockResolvedValue(0);

      const result = await service.computeUtilizationHistory('r1', 2);
      for (const week of result.weeks) {
        expect(week.utilization).toBe(0);
      }
    });
  });

  // ===== autoLinkUser (tested indirectly) =====

  describe('autoLinkUser behavior', () => {
    it('clears user_id when email has no match and clearIfNoMatch is true (via update)', async () => {
      const updated = { ...sampleResource, email: 'unknown@example.com' };
      mockRepo.findById
        .mockResolvedValueOnce(sampleResource)
        .mockResolvedValueOnce(updated);
      mockRepo.updateResource.mockResolvedValueOnce(true);

      // No user found for new email
      mockDb.queryControlPlane.mockResolvedValueOnce([]);

      await service.updateResource('r1', { email: 'unknown@example.com' });
      await new Promise(r => setTimeout(r, 10));

      // Should set user_id = NULL since clearIfNoMatch=true in update path
      expect(mockDb.query).toHaveBeenCalledWith(
        'UPDATE resources SET user_id = NULL WHERE id = ?',
        ['r1'],
      );
    });

    it('does nothing when no organizationId in request context', async () => {
      mockGetRequestContext.mockReturnValue(null);
      mockRepo.create.mockResolvedValueOnce(sampleResource);

      const { id, ...data } = sampleResource;
      try {
        await service.createResource(data);
        await new Promise(r => setTimeout(r, 10));
      } finally {
        mockGetRequestContext.mockReturnValue({ organizationId: 'org1' });
      }

      // Should not attempt queryControlPlane (no company: no owner lookup, no linking)
      expect(mockDb.queryControlPlane).not.toHaveBeenCalled();
    });

    it('links user when email matches a user in the organization', async () => {
      mockRepo.create.mockResolvedValueOnce(sampleResource);
      mockDb.queryControlPlane.mockResolvedValueOnce([{ owner_user_id: 'owner-1' }]).mockResolvedValueOnce([{ id: 'u-matched' }]);

      const { id, ...data } = sampleResource;
      await service.createResource(data);
      await new Promise(r => setTimeout(r, 10));

      expect(mockDb.query).toHaveBeenCalledWith(
        'UPDATE resources SET user_id = ? WHERE id = ?',
        ['u-matched', 'r1'],
      );
    });

    it('does not crash when autoLinkUser throws (fire-and-forget)', async () => {
      mockRepo.create.mockResolvedValueOnce(sampleResource);
      mockDb.queryControlPlane.mockResolvedValueOnce([{ owner_user_id: 'owner-1' }]).mockRejectedValueOnce(new Error('DB down'));

      const { id, ...data } = sampleResource;
      // Should not throw
      const result = await service.createResource(data);
      expect(result).toEqual(sampleResource);
    });

    it("refuses to blank a person's email (2026-10-01: every person has one) and changes nothing", async () => {
      mockRepo.findById.mockResolvedValueOnce({ ...sampleResource, email: 'old@example.com' });

      await expect(service.updateResource('r1', { email: '' })).rejects.toThrow(ResourceValidationError);
      expect(mockRepo.updateResource).not.toHaveBeenCalled();
      expect(mockDb.queryControlPlane).not.toHaveBeenCalled();
    });
  });
});
