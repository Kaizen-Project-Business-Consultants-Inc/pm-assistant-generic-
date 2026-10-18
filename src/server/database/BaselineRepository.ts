import { databaseService } from './connection';
import type { Baseline, BaselineTask } from '../services/BaselineService';

function mapBaselineRow(row: any): Omit<Baseline, 'tasks'> {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    name: row.name,
    createdAt: new Date(row.created_at).toISOString(),
    createdBy: row.created_by,
  };
}

function mapTaskRow(row: any): BaselineTask {
  return {
    taskId: row.task_id,
    name: row.name,
    startDate: row.start_date ? new Date(row.start_date).toISOString() : '',
    endDate: row.end_date ? new Date(row.end_date).toISOString() : '',
    estimatedDays: row.estimated_days != null ? Number(row.estimated_days) : undefined,
    progressPercentage: Number(row.progress_percentage ?? 0),
    status: row.status,
  };
}

export class BaselineRepository {
  async create(baseline: Baseline): Promise<void> {
    await databaseService.query(
      `INSERT INTO schedule_baselines (id, schedule_id, name, created_at, created_by) VALUES (?, ?, ?, ?, ?)`,
      [baseline.id, baseline.scheduleId, baseline.name, new Date(baseline.createdAt), baseline.createdBy],
    );

    if (baseline.tasks.length > 0) {
      const placeholders = baseline.tasks.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const values: any[] = [];
      for (const t of baseline.tasks) {
        values.push(
          crypto.randomUUID(),
          baseline.id,
          t.taskId,
          t.name,
          t.startDate ? new Date(t.startDate) : null,
          t.endDate ? new Date(t.endDate) : null,
          t.estimatedDays ?? null,
          t.progressPercentage,
          t.status,
        );
      }
      await databaseService.query(
        `INSERT INTO baseline_tasks (id, baseline_id, task_id, name, start_date, end_date, estimated_days, progress_percentage, status) VALUES ${placeholders}`,
        values,
      );
    }
  }

  async findByScheduleId(scheduleId: string): Promise<Baseline[]> {
    const rows = await databaseService.query(
      'SELECT * FROM schedule_baselines WHERE schedule_id = ? ORDER BY created_at DESC',
      [scheduleId],
    );
    if (rows.length === 0) return [];

    const baselines = rows.map(mapBaselineRow);
    const baselineIds = baselines.map((b) => b.id);
    const placeholders = baselineIds.map(() => '?').join(',');
    const taskRows = await databaseService.query(
      `SELECT * FROM baseline_tasks WHERE baseline_id IN (${placeholders})`,
      baselineIds,
    );

    const tasksByBaseline = new Map<string, BaselineTask[]>();
    for (const row of taskRows) {
      const bid = (row as any).baseline_id;
      if (!tasksByBaseline.has(bid)) tasksByBaseline.set(bid, []);
      tasksByBaseline.get(bid)!.push(mapTaskRow(row));
    }

    return baselines.map((b) => ({ ...b, tasks: tasksByBaseline.get(b.id) ?? [] }));
  }

  async findById(id: string): Promise<Baseline | null> {
    const rows = await databaseService.query(
      'SELECT * FROM schedule_baselines WHERE id = ?',
      [id],
    );
    if (rows.length === 0) return null;

    const baseline = mapBaselineRow(rows[0]);
    const taskRows = await databaseService.query(
      'SELECT * FROM baseline_tasks WHERE baseline_id = ?',
      [id],
    );

    return { ...baseline, tasks: taskRows.map(mapTaskRow) };
  }

  /**
   * The newest baseline not named `excludeName`, with its tasks, and how many such baselines the
   * plan has — what the Schedule Review reads (R18/R19). Reads one baseline's tasks, not every
   * baseline's: each Apply of Propose fixes adds a safety copy, so the list only grows.
   */
  async findLatestExcept(scheduleId: string, excludeName: string): Promise<{ latest: Baseline | null; count: number }> {
    const [countRows, rows] = await Promise.all([
      databaseService.query<any>('SELECT COUNT(*) AS n FROM schedule_baselines WHERE schedule_id = ? AND name <> ?', [scheduleId, excludeName]),
      databaseService.query<any>('SELECT * FROM schedule_baselines WHERE schedule_id = ? AND name <> ? ORDER BY created_at DESC LIMIT 1', [scheduleId, excludeName]),
    ]);
    const count = Number(countRows[0]?.n ?? 0);
    if (rows.length === 0) return { latest: null, count };
    const taskRows = await databaseService.query('SELECT * FROM baseline_tasks WHERE baseline_id = ?', [rows[0].id]);
    return { latest: { ...mapBaselineRow(rows[0]), tasks: taskRows.map(mapTaskRow) }, count };
  }

  async deleteById(id: string): Promise<boolean> {
    const result: any = await databaseService.query(
      'DELETE FROM schedule_baselines WHERE id = ?',
      [id],
    );
    return (result.affectedRows ?? 0) > 0;
  }
}

export const baselineRepository = new BaselineRepository();
