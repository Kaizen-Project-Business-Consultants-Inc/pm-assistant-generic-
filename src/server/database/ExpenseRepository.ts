import { BaseRepository } from './BaseRepository';
import { databaseService } from './connection';
import { v4 as uuid } from 'uuid';

export interface Expense {
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
}

function mapRow(row: any): Expense {
  return {
    id: row.id,
    projectId: row.project_id,
    date: row.date,
    amount: parseFloat(row.amount),
    category: row.category,
    vendor: row.vendor,
    description: row.description,
    receiptAttachmentId: row.receipt_attachment_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class ExpenseRepository extends BaseRepository<Expense> {
  constructor() {
    super('project_expenses', mapRow);
  }

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
    const id = uuid();
    await databaseService.query(
      `INSERT INTO project_expenses (id, project_id, date, amount, category, vendor, description, receipt_attachment_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.projectId, data.date, data.amount, data.category, data.vendor || null, data.description || null, data.receiptAttachmentId || null, data.createdBy],
    );
    return (await this.findById(id))!;
  }

  async findByProject(projectId: string, startDate?: string, endDate?: string): Promise<Expense[]> {
    let sql = 'SELECT * FROM project_expenses WHERE project_id = ?';
    const params: any[] = [projectId];
    if (startDate) { sql += ' AND date >= ?'; params.push(startDate); }
    if (endDate) { sql += ' AND date <= ?'; params.push(endDate); }
    sql += ' ORDER BY date DESC';
    const rows = await databaseService.query(sql, params);
    return rows.map(mapRow);
  }

  async update(id: string, data: Partial<Pick<Expense, 'date' | 'amount' | 'category' | 'vendor' | 'description'>>): Promise<Expense | null> {
    const sets: string[] = [];
    const params: any[] = [];
    if (data.date !== undefined) { sets.push('date = ?'); params.push(data.date); }
    if (data.amount !== undefined) { sets.push('amount = ?'); params.push(data.amount); }
    if (data.category !== undefined) { sets.push('category = ?'); params.push(data.category); }
    if (data.vendor !== undefined) { sets.push('vendor = ?'); params.push(data.vendor); }
    if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description); }
    if (sets.length === 0) return this.findById(id);
    params.push(id);
    await databaseService.query(`UPDATE project_expenses SET ${sets.join(', ')} WHERE id = ?`, params);
    return this.findById(id);
  }

  /** All of a project's expenses added up (part of the project's money spent) */
  async totalForProject(projectId: string): Promise<number> {
    const [row] = await this.queryRaw(`SELECT COALESCE(SUM(amount), 0) AS total FROM project_expenses WHERE project_id = ?`, [projectId]);
    return Math.round(Number(row?.total ?? 0) * 100) / 100;
  }

  async getSummaryByCategory(projectId: string): Promise<{ category: string; total: number; count: number }[]> {
    const rows = await databaseService.query(
      `SELECT category, SUM(amount) AS total, COUNT(*) AS count
       FROM project_expenses WHERE project_id = ? GROUP BY category ORDER BY total DESC`,
      [projectId],
    );
    return rows.map((r: any) => ({ category: r.category, total: parseFloat(r.total), count: Number(r.count) }));
  }

  async getMonthlySpend(projectId: string): Promise<{ month: string; total: number }[]> {
    const rows = await databaseService.query(
      `SELECT DATE_FORMAT(date, '%Y-%m') AS month, SUM(amount) AS total
       FROM project_expenses WHERE project_id = ? GROUP BY month ORDER BY month`,
      [projectId],
    );
    return rows.map((r: any) => ({ month: r.month, total: parseFloat(r.total) }));
  }
}

export const expenseRepository = new ExpenseRepository();
