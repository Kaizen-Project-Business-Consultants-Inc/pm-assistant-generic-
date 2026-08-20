import { BaseRepository } from './BaseRepository';
import { v4 as uuidv4 } from 'uuid';

export interface TaskChecklistItem {
  id: string;
  label: string;
  checked: boolean;
}

export interface TaskChecklist {
  id: string;
  taskId: string;
  projectId: string;
  type: 'dor' | 'dod';
  items: TaskChecklistItem[];
  createdAt: string;
  updatedAt: string;
}

const rowMapper = (row: any): TaskChecklist => ({
  id: row.id,
  taskId: row.task_id,
  projectId: row.project_id,
  type: row.type,
  items: row.items ? (typeof row.items === 'string' ? JSON.parse(row.items) : row.items) : [],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

class TaskChecklistRepository extends BaseRepository<TaskChecklist> {
  constructor() {
    super('task_checklists', rowMapper);
  }

  async upsert(taskId: string, projectId: string, type: 'dor' | 'dod', items: TaskChecklistItem[]): Promise<TaskChecklist> {
    const id = uuidv4();
    const itemsJson = JSON.stringify(items);

    await this.queryRaw(
      `INSERT INTO task_checklists (id, task_id, project_id, type, items)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE items = VALUES(items)`,
      [id, taskId, projectId, type, itemsJson],
    );

    const rows = await this.queryRaw(
      `SELECT * FROM task_checklists WHERE task_id = ? AND type = ?`,
      [taskId, type],
    );
    return rowMapper(rows[0]);
  }

  async findByTask(taskId: string): Promise<TaskChecklist[]> {
    const rows = await this.queryRaw(
      `SELECT * FROM task_checklists WHERE task_id = ? ORDER BY type`,
      [taskId],
    );
    return rows.map(rowMapper);
  }

  async findByTaskAndType(taskId: string, type: 'dor' | 'dod'): Promise<TaskChecklist | null> {
    const rows = await this.queryRaw(
      `SELECT * FROM task_checklists WHERE task_id = ? AND type = ?`,
      [taskId, type],
    );
    return rows.length > 0 ? rowMapper(rows[0]) : null;
  }

  async updateItems(id: string, items: TaskChecklistItem[]): Promise<TaskChecklist | null> {
    await this.queryRaw(
      `UPDATE task_checklists SET items = ? WHERE id = ?`,
      [JSON.stringify(items), id],
    );
    return this.findById(id);
  }

  async getReadinessBulk(taskIds: string[], type: 'dor' | 'dod'): Promise<Record<string, { ready: boolean; checked: number; total: number }>> {
    if (taskIds.length === 0) return {};

    const placeholders = taskIds.map(() => '?').join(',');
    const rows = await this.queryRaw(
      `SELECT task_id, items FROM task_checklists WHERE task_id IN (${placeholders}) AND type = ?`,
      [...taskIds, type],
    );

    const result: Record<string, { ready: boolean; checked: number; total: number }> = {};
    for (const row of rows) {
      const items: TaskChecklistItem[] = typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []);
      const total = items.length;
      const checked = items.filter((i) => i.checked).length;
      result[row.task_id] = { ready: total > 0 && checked === total, checked, total };
    }
    return result;
  }
}

export const taskChecklistRepository = new TaskChecklistRepository();
