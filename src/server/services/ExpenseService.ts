import { expenseRepository, type Expense } from '../database/ExpenseRepository';
import { approvedTimeService } from './ApprovedTimeService';

/** A project's money spent includes its expenses (2026-10-03): recompute it after any expense change */
const respend = (projectId: string | null | undefined) =>
  (projectId ? approvedTimeService.applyToProject(projectId) : Promise.resolve());

class ExpenseService {
  async create(data: {
    projectId: string;
    date: string;
    amount: number;
    category: string;
    vendor?: string;
    description?: string;
    receiptAttachmentId?: string;
    createdBy: string;
  }): Promise<Expense> {
    const expense = await expenseRepository.create(data);
    await respend(data.projectId);
    return expense;
  }

  async getByProject(projectId: string, startDate?: string, endDate?: string): Promise<Expense[]> {
    return expenseRepository.findByProject(projectId, startDate, endDate);
  }

  async update(id: string, data: Partial<Pick<Expense, 'date' | 'amount' | 'category' | 'vendor' | 'description'>>): Promise<Expense | null> {
    const expense = await expenseRepository.update(id, data);
    await respend(expense?.projectId);
    return expense;
  }

  async delete(id: string): Promise<boolean> {
    const before = await expenseRepository.findById(id);
    const deleted = await expenseRepository.deleteById(id);
    if (deleted) await respend(before?.projectId);
    return deleted;
  }

  async getSummaryByCategory(projectId: string) {
    return expenseRepository.getSummaryByCategory(projectId);
  }

  async getMonthlySpend(projectId: string) {
    return expenseRepository.getMonthlySpend(projectId);
  }
}

export const expenseService = new ExpenseService();
