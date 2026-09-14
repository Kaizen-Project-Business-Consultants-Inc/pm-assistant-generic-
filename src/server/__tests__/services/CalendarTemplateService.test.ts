import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────
const mockFindAll = vi.fn();
const mockFindById = vi.fn();
const mockFindDefault = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDeleteTemplate = vi.fn();

vi.mock('../../database/CalendarTemplateRepository', () => ({
  calendarTemplateRepository: {
    findAll: (...args: any[]) => mockFindAll(...args),
    findById: (...args: any[]) => mockFindById(...args),
    findDefault: (...args: any[]) => mockFindDefault(...args),
    create: (...args: any[]) => mockCreate(...args),
    update: (...args: any[]) => mockUpdate(...args),
    deleteTemplate: (...args: any[]) => mockDeleteTemplate(...args),
  },
}));

import { CalendarTemplateService } from '../../services/CalendarTemplateService';
import type { CalendarTemplate } from '../../database/CalendarTemplateRepository';

// ── Helpers ──────────────────────────────────────────────────────────
function makeTemplate(overrides: Partial<CalendarTemplate> = {}): CalendarTemplate {
  return {
    id: overrides.id ?? 'ct-1',
    name: overrides.name ?? 'Standard',
    workingDays: overrides.workingDays ?? ['mon', 'tue', 'wed', 'thu', 'fri'],
    hoursPerDay: overrides.hoursPerDay ?? 8,
    isDefault: overrides.isDefault ?? false,
  };
}

// ── Tests ────────────────────────────────────────────────────────────
describe('CalendarTemplateService', () => {
  let service: CalendarTemplateService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CalendarTemplateService();
  });

  // ── list ─────────────────────────────────────────────────────────
  describe('list', () => {
    it('returns all templates from repository', async () => {
      const templates = [
        makeTemplate({ id: 'ct-1', name: 'Standard', isDefault: true }),
        makeTemplate({ id: 'ct-2', name: 'Part-Time' }),
      ];
      mockFindAll.mockResolvedValue(templates);

      const result = await service.list();

      expect(mockFindAll).toHaveBeenCalledTimes(1);
      expect(result).toBe(templates);
      expect(result).toHaveLength(2);
    });

    it('returns empty array when no templates exist', async () => {
      mockFindAll.mockResolvedValue([]);

      const result = await service.list();

      expect(result).toEqual([]);
    });

    it('propagates repository errors', async () => {
      mockFindAll.mockRejectedValue(new Error('DB connection failed'));

      await expect(service.list()).rejects.toThrow('DB connection failed');
    });
  });

  // ── get ──────────────────────────────────────────────────────────
  describe('get', () => {
    it('returns template when found', async () => {
      const template = makeTemplate({ id: 'ct-42', name: 'Night Shift' });
      mockFindById.mockResolvedValue(template);

      const result = await service.get('ct-42');

      expect(mockFindById).toHaveBeenCalledWith('ct-42');
      expect(result).toBe(template);
    });

    it('returns null when not found', async () => {
      mockFindById.mockResolvedValue(null);

      const result = await service.get('nonexistent');

      expect(mockFindById).toHaveBeenCalledWith('nonexistent');
      expect(result).toBeNull();
    });

    it('propagates repository errors', async () => {
      mockFindById.mockRejectedValue(new Error('Query failed'));

      await expect(service.get('ct-1')).rejects.toThrow('Query failed');
    });
  });

  // ── getDefault ───────────────────────────────────────────────────
  describe('getDefault', () => {
    it('returns the default template', async () => {
      const template = makeTemplate({ id: 'ct-default', isDefault: true });
      mockFindDefault.mockResolvedValue(template);

      const result = await service.getDefault();

      expect(mockFindDefault).toHaveBeenCalledTimes(1);
      expect(result).toBe(template);
      expect(result!.isDefault).toBe(true);
    });

    it('returns null when no default template exists', async () => {
      mockFindDefault.mockResolvedValue(null);

      const result = await service.getDefault();

      expect(result).toBeNull();
    });

    it('propagates repository errors', async () => {
      mockFindDefault.mockRejectedValue(new Error('DB error'));

      await expect(service.getDefault()).rejects.toThrow('DB error');
    });
  });

  // ── create ───────────────────────────────────────────────────────
  describe('create', () => {
    it('creates a template with all fields', async () => {
      const input: Omit<CalendarTemplate, 'id'> = {
        name: 'Weekend Crew',
        workingDays: ['sat', 'sun'],
        hoursPerDay: 6,
        isDefault: false,
      };
      const created = makeTemplate({ id: 'ct-new', ...input });
      mockCreate.mockResolvedValue(created);

      const result = await service.create(input);

      expect(mockCreate).toHaveBeenCalledWith(input);
      expect(result).toBe(created);
      expect(result.name).toBe('Weekend Crew');
      expect(result.workingDays).toEqual(['sat', 'sun']);
      expect(result.hoursPerDay).toBe(6);
    });

    it('creates a default template', async () => {
      const input: Omit<CalendarTemplate, 'id'> = {
        name: 'Default Calendar',
        workingDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
        hoursPerDay: 8,
        isDefault: true,
      };
      const created = makeTemplate({ id: 'ct-def', ...input });
      mockCreate.mockResolvedValue(created);

      const result = await service.create(input);

      expect(result.isDefault).toBe(true);
    });

    it('creates a template with empty working days', async () => {
      const input: Omit<CalendarTemplate, 'id'> = {
        name: 'No Working Days',
        workingDays: [],
        hoursPerDay: 0,
        isDefault: false,
      };
      const created = makeTemplate({ id: 'ct-empty', ...input });
      mockCreate.mockResolvedValue(created);

      const result = await service.create(input);

      expect(mockCreate).toHaveBeenCalledWith(input);
      expect(result.workingDays).toEqual([]);
      expect(result.hoursPerDay).toBe(0);
    });

    it('propagates repository errors', async () => {
      mockCreate.mockRejectedValue(new Error('Duplicate name'));

      const input: Omit<CalendarTemplate, 'id'> = {
        name: 'Dup',
        workingDays: ['mon'],
        hoursPerDay: 8,
        isDefault: false,
      };

      await expect(service.create(input)).rejects.toThrow('Duplicate name');
    });
  });

  // ── update ───────────────────────────────────────────────────────
  describe('update', () => {
    it('updates a template with partial data', async () => {
      const updated = makeTemplate({ id: 'ct-1', name: 'Updated Name', hoursPerDay: 6 });
      mockUpdate.mockResolvedValue(updated);

      const result = await service.update('ct-1', { name: 'Updated Name', hoursPerDay: 6 });

      expect(mockUpdate).toHaveBeenCalledWith('ct-1', { name: 'Updated Name', hoursPerDay: 6 });
      expect(result).toBe(updated);
      expect(result!.name).toBe('Updated Name');
      expect(result!.hoursPerDay).toBe(6);
    });

    it('updates only the name', async () => {
      const updated = makeTemplate({ id: 'ct-1', name: 'New Name' });
      mockUpdate.mockResolvedValue(updated);

      const result = await service.update('ct-1', { name: 'New Name' });

      expect(mockUpdate).toHaveBeenCalledWith('ct-1', { name: 'New Name' });
      expect(result!.name).toBe('New Name');
    });

    it('updates working days', async () => {
      const updated = makeTemplate({ id: 'ct-1', workingDays: ['mon', 'wed', 'fri'] });
      mockUpdate.mockResolvedValue(updated);

      const result = await service.update('ct-1', { workingDays: ['mon', 'wed', 'fri'] });

      expect(mockUpdate).toHaveBeenCalledWith('ct-1', { workingDays: ['mon', 'wed', 'fri'] });
      expect(result!.workingDays).toEqual(['mon', 'wed', 'fri']);
    });

    it('updates isDefault flag', async () => {
      const updated = makeTemplate({ id: 'ct-1', isDefault: true });
      mockUpdate.mockResolvedValue(updated);

      const result = await service.update('ct-1', { isDefault: true });

      expect(mockUpdate).toHaveBeenCalledWith('ct-1', { isDefault: true });
      expect(result!.isDefault).toBe(true);
    });

    it('returns null when template not found', async () => {
      mockUpdate.mockResolvedValue(null);

      const result = await service.update('nonexistent', { name: 'Nope' });

      expect(mockUpdate).toHaveBeenCalledWith('nonexistent', { name: 'Nope' });
      expect(result).toBeNull();
    });

    it('handles empty update data', async () => {
      const unchanged = makeTemplate({ id: 'ct-1' });
      mockUpdate.mockResolvedValue(unchanged);

      const result = await service.update('ct-1', {});

      expect(mockUpdate).toHaveBeenCalledWith('ct-1', {});
      expect(result).toBe(unchanged);
    });

    it('propagates repository errors', async () => {
      mockUpdate.mockRejectedValue(new Error('Update failed'));

      await expect(service.update('ct-1', { name: 'X' })).rejects.toThrow('Update failed');
    });
  });

  // ── delete ───────────────────────────────────────────────────────
  describe('delete', () => {
    it('returns true when template is deleted', async () => {
      mockDeleteTemplate.mockResolvedValue(true);

      const result = await service.delete('ct-1');

      expect(mockDeleteTemplate).toHaveBeenCalledWith('ct-1');
      expect(result).toBe(true);
    });

    it('returns false when template not found', async () => {
      mockDeleteTemplate.mockResolvedValue(false);

      const result = await service.delete('nonexistent');

      expect(mockDeleteTemplate).toHaveBeenCalledWith('nonexistent');
      expect(result).toBe(false);
    });

    it('propagates repository errors', async () => {
      mockDeleteTemplate.mockRejectedValue(new Error('FK constraint'));

      await expect(service.delete('ct-1')).rejects.toThrow('FK constraint');
    });
  });

  // ── singleton export ─────────────────────────────────────────────
  describe('module export', () => {
    it('exports a singleton instance', async () => {
      const mod = await import('../../services/CalendarTemplateService');
      expect(mod.calendarTemplateService).toBeInstanceOf(CalendarTemplateService);
    });
  });
});
