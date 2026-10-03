import fs from 'fs';
import path from 'path';
import type mysql from 'mysql2/promise';
import { databaseService } from '../database/connection';
import logger from '../utils/logger';

/**
 * The read-only "Sample Web App Development" project (Oct 2026: optional, not forced).
 *
 * It is seeded by tenant migration T033 with example people, timesheets, costs, sprints, meetings
 * and RAID items — every row's id starts with "demo-". New companies have it removed right after
 * provisioning (they start clean); a company owner/admin can load it to explore, and remove it
 * again, from Settings → Sample project. Removing takes the sample's own rows and anything that
 * points at the sample project, its schedules, tasks or example people; nothing else. Append-only
 * history (the audit ledger) is never touched.
 */
export const SAMPLE_PROJECT_ID = 'demo-sample-webapp';
const SEED_FILE = path.join(__dirname, '..', 'database', 'tenant-migrations', 'T033_sample_project_seed.sql');
const SAMPLE_PREFIX = 'demo-';

/** The seed file split into statements, the same way the tenant migration runner splits it */
export function seedStatements(sql: string = fs.readFileSync(SEED_FILE, 'utf-8')): string[] {
  return sql
    .split(/;\s*$/m)
    .map(s => s.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n').trim())
    .filter(s => s.length > 0);
}

/** Tables the seed writes to (each sample row there has a "demo-" id) */
export function seededTables(statements: string[] = seedStatements()): string[] {
  const out = new Set<string>();
  for (const s of statements) {
    const m = s.match(/^INSERT\s+(?:IGNORE\s+)?INTO\s+`?(\w+)`?/i);
    if (m) out.add(m[1]);
  }
  return [...out];
}

type Conn = mysql.PoolConnection;

class SampleProjectService {
  /** A connection on the given tenant database (provisioning), else the request's tenant */
  private async connect(dbName?: string): Promise<Conn> {
    if (!dbName) return databaseService.getConnection();
    const pool = databaseService.getPool();
    if (!pool) throw new Error('Database pool not initialized');
    const conn = await pool.getConnection();
    await conn.query(`USE \`${dbName.replace(/`/g, '')}\``);
    return conn;
  }

  async isLoaded(dbName?: string): Promise<boolean> {
    const conn = await this.connect(dbName);
    try {
      const rows = await databaseService.queryOn<{ n: number }>(conn, 'SELECT COUNT(*) AS n FROM projects WHERE id = ?', [SAMPLE_PROJECT_ID]);
      return Number(rows[0]?.n ?? 0) > 0;
    } finally { conn.release(); }
  }

  /** Remove the sample and everything that points at it. Returns how many rows went. */
  async remove(dbName?: string): Promise<number> {
    const conn = await this.connect(dbName);
    let removed = 0;
    const del = async (sql: string, params: unknown[]) => {
      const r: any = await databaseService.queryOn(conn, sql, params as any[]);
      removed += Number(r?.affectedRows ?? (Array.isArray(r) ? 0 : 0));
    };
    try {
      await conn.beginTransaction();
      const ids = async (sql: string, params: unknown[]) =>
        (await databaseService.queryOn<{ id: string }>(conn, sql, params as any[])).map(r => r.id);
      const scheduleIds = await ids('SELECT id FROM schedules WHERE project_id = ?', [SAMPLE_PROJECT_ID]);
      const taskIds = scheduleIds.length ? await ids(`SELECT id FROM tasks WHERE schedule_id IN (${scheduleIds.map(() => '?').join(',')})`, scheduleIds) : [];
      const resourceIds = await ids('SELECT id FROM resources WHERE id LIKE ?', [`${SAMPLE_PREFIX}%`]);

      // Every table with a column pointing at the sample's project, schedules, tasks or people
      const cols = await databaseService.queryOn<{ t: string; c: string }>(conn,
        `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME IN ('project_id','schedule_id','task_id','resource_id')
            AND TABLE_NAME NOT IN ('projects','schedules','tasks','resources')`, []);
      // Append-only records (the audit ledger refuses deletes with a trigger) are history: kept
      const appendOnly = new Set((await databaseService.queryOn<{ t: string }>(conn,
        `SELECT DISTINCT EVENT_OBJECT_TABLE AS t FROM information_schema.TRIGGERS
          WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_MANIPULATION = 'DELETE'`, [])).map(r => r.t));
      const targets: Record<string, string[]> = {
        project_id: [SAMPLE_PROJECT_ID], schedule_id: scheduleIds, task_id: taskIds, resource_id: resourceIds,
      };
      for (const { t, c } of cols) {
        const list = targets[c];
        if (!list?.length || !/^\w+$/.test(t) || appendOnly.has(t)) continue;
        await del(`DELETE FROM \`${t}\` WHERE \`${c}\` IN (${list.map(() => '?').join(',')})`, list);
      }
      // The seed's own rows that don't point at the project (e.g. custom field definitions)
      for (const t of seededTables()) {
        if (['projects', 'schedules', 'tasks', 'resources'].includes(t) || !/^\w+$/.test(t) || appendOnly.has(t)) continue;
        await del(`DELETE FROM \`${t}\` WHERE id LIKE ?`, [`${SAMPLE_PREFIX}%`]);
      }
      if (taskIds.length) await del(`DELETE FROM tasks WHERE id IN (${taskIds.map(() => '?').join(',')})`, taskIds);
      if (scheduleIds.length) await del(`DELETE FROM schedules WHERE id IN (${scheduleIds.map(() => '?').join(',')})`, scheduleIds);
      if (resourceIds.length) await del(`DELETE FROM resources WHERE id IN (${resourceIds.map(() => '?').join(',')})`, resourceIds);
      await del('DELETE FROM projects WHERE id = ?', [SAMPLE_PROJECT_ID]);
      await conn.commit();
      logger.info('[sample-project] removed', { dbName, removed });
      return removed;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally { conn.release(); }
  }

  /** Load the sample (the T033 seed again — INSERT IGNORE, so loading twice is harmless) */
  async load(dbName?: string): Promise<void> {
    const conn = await this.connect(dbName);
    try {
      await conn.beginTransaction();
      for (const stmt of seedStatements()) await databaseService.queryOn(conn, stmt, []);
      await conn.commit();
      logger.info('[sample-project] loaded', { dbName });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally { conn.release(); }
  }
}

export const sampleProjectService = new SampleProjectService();
