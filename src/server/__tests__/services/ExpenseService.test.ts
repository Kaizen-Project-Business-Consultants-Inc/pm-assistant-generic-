import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────
const mockRepoCreate = vi.fn();
const mockRepoFindByProject = vi.fn();
const mockRepoUpdate = vi.fn();
const mockRepoDeleteById = vi.fn();
const mockRepoGetSummaryByCategory = vi.fn();
const mockRepoGetMonthlySpend = vi.fn();

vi.mock('../../database/ExpenseRepository', () => ({
  expenseRepository: {
    create: (...args: any[]) => mockRepoCreate(...args),
    findByProject: (...args: any[]) => mockRepoFindByProject(...args),
    update: (...args: any[]) => mockRepoUpdate(...args),
    deleteById: (...args: any[]) => mockRepoDeleteById(...args),
    getSummaryByCategory: (...args: any[]) => mockRepoGetSummaryByCategory(...args),
    getMonthlySpend: (...args: any[]) => mockRepoGetMonthlySpend(...args),
  },
}));

import { expenseService } from '../../services/ExpenseService';

// ── Helpers ──────────────────────────────────────────────────────────
function makeExpense(overrides: Partial<{
  id: string;
  projectId: string;
  date: string;
  amount: number;
  category: string;
  vendor: string | null;
  description: string | null;
  receiptAttachmentId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}> = {}) {
  return {
    id: overrides.id ?? 'exp-1',
    projectId: overrides.projectId ?? 'proj-1',
    date: overrides.date ?? '2026-01-15',
    amount: overrides.amount ?? 250.00,
    category: overrides.category ?? 'Software',
    vendor: overrides.vendor !== undefined ? overrides.vendor : 'Acme Corp',
    description: overrides.description !== undefined ? overrides.description : 'License renewal',
    receiptAttachmentId: overrides.receiptAttachmentId !== undefined ? overrides.receiptAttachmentId : null,
    createdBy: overrides.createdBy ?? 'user-1',
    createdAt: overrides.createdAt ?? '2026-01-15T10:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-15T10:00:00.000Z',
  };
}

// ── Tests ────────────────────────────────────────────────────────────
describe('ExpenseService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── create ─────────────────────────────────────────────────────────
  describe('create', () => {
    it('creates an expense with all fields and returns the result', async () => {
      const input = {
        projectId: 'proj-1',
        date: '2026-02-01',
        amount: 500,
        category: 'Hardware',
        vendor: 'Dell',
        description: 'New monitor',
        receiptAttachmentId: 'att-1',
        createdBy: 'user-1',
      };
      const created = makeExpense({ ...input, id: 'exp-new' });
      mockRepoCreate.mockResolvedValue(created);

      const result = await expenseService.create(input);

      expect(mockRepoCreate).toHaveBeenCalledWith(input);
      expect(result).toBe(created);
      expect(result.id).toBe('exp-new');
      expect(result.amount).toBe(500);
    });

    it('creates an expense with only required fields (no vendor, description, receipt)', async () => {
      const input = {
        projectId: 'proj-2',
        date: '2026-03-01',
        amount: 99.99,
        category: 'Travel',
        createdBy: 'user-2',
      };
      const created = makeExpense({ ...input, vendor: null, description: null, receiptAttachmentId: null });
      mockRepoCreate.mockResolvedValue(created);

      const result = await expenseService.create(input);

      expect(mockRepoCreate).toHaveBeenCalledWith(input);
      expect(result.vendor).toBeNull();
      expect(result.description).toBeNull();
    });

    it('propagates repository errors', async () => {
      mockRepoCreate.mockRejectedValue(new Error('DB connection failed'));

      await expect(expenseService.create({
        projectId: 'proj-1',
        date: '2026-01-01',
        amount: 100,
        category: 'Misc',
        createdBy: 'user-1',
      })).rejects.toThrow('DB connection failed');
    });
  });

  // ── getByProject ───────────────────────────────────────────────────
  describe('getByProject', () => {
    it('returns expenses for a project without date filters', async () => {
      const expenses = [makeExpense({ id: 'exp-1' }), makeExpense({ id: 'exp-2' })];
      mockRepoFindByProject.mockResolvedValue(expenses);

      const result = await expenseService.getByProject('proj-1');

      expect(mockRepoFindByProject).toHaveBeenCalledWith('proj-1', undefined, undefined);
      expect(result).toHaveLength(2);
      expect(result).toBe(expenses);
    });

    it('passes startDate filter to repository', async () => {
      mockRepoFindByProject.mockResolvedValue([]);

      await expenseService.getByProject('proj-1', '2026-01-01');

      expect(mockRepoFindByProject).toHaveBeenCalledWith('proj-1', '2026-01-01', undefined);
    });

    it('passes both startDate and endDate filters to repository', async () => {
      mockRepoFindByProject.mockResolvedValue([]);

      await expenseService.getByProject('proj-1', '2026-01-01', '2026-12-31');

      expect(mockRepoFindByProject).toHaveBeenCalledWith('proj-1', '2026-01-01', '2026-12-31');
    });

    it('returns empty array when no expenses exist', async () => {
      mockRepoFindByProject.mockResolvedValue([]);

      const result = await expenseService.getByProject('proj-empty');

      expect(result).toEqual([]);
    });

    it('propagates repository errors', async () => {
      mockRepoFindByProject.mockRejectedValue(new Error('Query failed'));

      await expect(expenseService.getByProject('proj-1')).rejects.toThrow('Query failed');
    });
  });

  // ── update ─────────────────────────────────────────────────────────
  describe('update', () => {
    it('updates expense fields and returns updated expense', async () => {
      const updated = makeExpense({ id: 'exp-1', amount: 300, category: 'Travel' });
      mockRepoUpdate.mockResolvedValue(updated);

      const result = await expenseService.update('exp-1', { amount: 300, category: 'Travel' });

      expect(mockRepoUpdate).toHaveBeenCalledWith('exp-1', { amount: 300, category: 'Travel' });
      expect(result).toBe(updated);
      expect(result!.amount).toBe(300);
    });

    it('updates a single field', async () => {
      const updated = makeExpense({ id: 'exp-1', vendor: 'New Vendor' });
      mockRepoUpdate.mockResolvedValue(updated);

      const result = await expenseService.update('exp-1', { vendor: 'New Vendor' });

      expect(mockRepoUpdate).toHaveBeenCalledWith('exp-1', { vendor: 'New Vendor' });
      expect(result!.vendor).toBe('New Vendor');
    });

    it('returns null when expense not found', async () => {
      mockRepoUpdate.mockResolvedValue(null);

      const result = await expenseService.update('nonexistent', { amount: 100 });

      expect(result).toBeNull();
    });

    it('handles empty update data', async () => {
      const existing = makeExpense({ id: 'exp-1' });
      mockRepoUpdate.mockResolvedValue(existing);

      const result = await expenseService.update('exp-1', {});

      expect(mockRepoUpdate).toHaveBeenCalledWith('exp-1', {});
      expect(result).toBe(existing);
    });

    it('propagates repository errors', async () => {
      mockRepoUpdate.mockRejectedValue(new Error('Update failed'));

      await expect(expenseService.update('exp-1', { amount: 50 })).rejects.toThrow('Update failed');
    });
  });

  // ── delete ─────────────────────────────────────────────────────────
  describe('delete', () => {
    it('returns true when expense is deleted', async () => {
      mockRepoDeleteById.mockResolvedValue(true);

      const result = await expenseService.delete('exp-1');

      expect(mockRepoDeleteById).toHaveBeenCalledWith('exp-1');
      expect(result).toBe(true);
    });

    it('returns false when expense not found', async () => {
      mockRepoDeleteById.mockResolvedValue(false);

      const result = await expenseService.delete('nonexistent');

      expect(mockRepoDeleteById).toHaveBeenCalledWith('nonexistent');
      expect(result).toBe(false);
    });

    it('propagates repository errors', async () => {
      mockRepoDeleteById.mockRejectedValue(new Error('Delete failed'));

      await expect(expenseService.delete('exp-1')).rejects.toThrow('Delete failed');
    });
  });

  // ── getSummaryByCategory ───────────────────────────────────────────
  describe('getSummaryByCategory', () => {
    it('returns category summary with totals and counts', async () => {
      const summary = [
        { category: 'Software', total: 1500, count: 3 },
        { category: 'Hardware', total: 800, count: 1 },
        { category: 'Travel', total: 250, count: 2 },
      ];
      mockRepoGetSummaryByCategory.mockResolvedValue(summary);

      const result = await expenseService.getSummaryByCategory('proj-1');

      expect(mockRepoGetSummaryByCategory).toHaveBeenCalledWith('proj-1');
      expect(result).toBe(summary);
      expect(result).toHaveLength(3);
      expect(result[0].category).toBe('Software');
      expect(result[0].total).toBe(1500);
      expect(result[0].count).toBe(3);
    });

    it('returns empty array when no expenses exist for project', async () => {
      mockRepoGetSummaryByCategory.mockResolvedValue([]);

      const result = await expenseService.getSummaryByCategory('proj-empty');

      expect(result).toEqual([]);
    });

    it('propagates repository errors', async () => {
      mockRepoGetSummaryByCategory.mockRejectedValue(new Error('Aggregation failed'));

      await expect(expenseService.getSummaryByCategory('proj-1')).rejects.toThrow('Aggregation failed');
    });
  });

  // ── getMonthlySpend ────────────────────────────────────────────────
  describe('getMonthlySpend', () => {
    it('returns monthly spend data', async () => {
      const monthly = [
        { month: '2026-01', total: 500 },
        { month: '2026-02', total: 750 },
        { month: '2026-03', total: 200 },
      ];
      mockRepoGetMonthlySpend.mockResolvedValue(monthly);

      const result = await expenseService.getMonthlySpend('proj-1');

      expect(mockRepoGetMonthlySpend).toHaveBeenCalledWith('proj-1');
      expect(result).toBe(monthly);
      expect(result).toHaveLength(3);
      expect(result[0].month).toBe('2026-01');
      expect(result[0].total).toBe(500);
    });

    it('returns empty array when no expenses exist', async () => {
      mockRepoGetMonthlySpend.mockResolvedValue([]);

      const result = await expenseService.getMonthlySpend('proj-empty');

      expect(result).toEqual([]);
    });

    it('handles single month of data', async () => {
      const monthly = [{ month: '2026-06', total: 1234.56 }];
      mockRepoGetMonthlySpend.mockResolvedValue(monthly);

      const result = await expenseService.getMonthlySpend('proj-1');

      expect(result).toHaveLength(1);
      expect(result[0].total).toBe(1234.56);
    });

    it('propagates repository errors', async () => {
      mockRepoGetMonthlySpend.mockRejectedValue(new Error('Monthly query failed'));

      await expect(expenseService.getMonthlySpend('proj-1')).rejects.toThrow('Monthly query failed');
    });
  });
});
