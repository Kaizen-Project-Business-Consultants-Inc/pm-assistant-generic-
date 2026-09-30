import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('../../database/connection', () => ({
  databaseService: { query: vi.fn().mockResolvedValue([{ cnt: 3 }]) },
}));

import { databaseService } from '../../database/connection';
import { sprintRepository } from '../../database/SprintRepository';

const mockQuery = databaseService.query as ReturnType<typeof vi.fn>;
const DB_DIR = path.join(__dirname, '..', '..', 'database');
const baseline = fs.readFileSync(path.join(DB_DIR, 'tenant-migrations', 'T001_baseline.sql'), 'utf-8');

/** Columns of a CREATE TABLE in the tenant baseline. */
function baselineColumns(table: string): string[] {
  const m = baseline.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\)`, 'i'));
  if (!m) throw new Error(`${table} not in T001`);
  return m[1].split('\n').map(l => l.trim().split(/\s+/)[0]).filter(w => /^[a-z_]+$/.test(w));
}

/**
 * Four screens crashed (500) for every company on 2026-09-29, for three different reasons.
 */
describe('pages that crashed on normal viewing', () => {
  beforeEach(() => { mockQuery.mockClear(); });

  it('AI Learning: ai_feedback and ai_accuracy_tracking exist in every company database (T062)', () => {
    // They were only ever created in the control-plane database, but the service reads and
    // writes them through the tenant-routed query() → "Table ... doesn't exist".
    const sql = fs.readFileSync(path.join(DB_DIR, 'tenant-migrations', 'T062_ai_learning_tables.sql'), 'utf-8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS ai_feedback \(/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS ai_accuracy_tracking \(/);
    // Every column the service writes
    for (const col of ['id', 'user_id', 'project_id', 'feature', 'suggestion_data', 'user_action', 'modified_data', 'feedback_text', 'created_at']) {
      expect(sql).toMatch(new RegExp(`\\n  ${col} `));
    }
    for (const col of ['task_id', 'metric_type', 'predicted_value', 'actual_value', 'variance_pct', 'project_type', 'recorded_at']) {
      expect(sql).toMatch(new RegExp(`\\n  ${col} `));
    }
  });

  it('AI Learning tables are no longer flagged as control-plane-only', () => {
    const src = fs.readFileSync(path.join(DB_DIR, 'connection.ts'), 'utf-8');
    const set = src.slice(src.indexOf('CONTROL_PLANE_ONLY_TABLES = new Set'), src.indexOf(']);'));
    expect(set).not.toContain("'ai_feedback'");
    expect(set).not.toContain("'ai_accuracy_tracking'");
  });

  it('Portfolio analytics reads project_health_history columns that exist (health_score, not overall_health)', () => {
    const cols = baselineColumns('project_health_history');
    expect(cols).toContain('health_score');
    expect(cols).not.toContain('overall_health');
    const route = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'reporting', 'portfolio.ts'), 'utf-8');
    expect(route).toMatch(/SELECT project_id, health_score AS overall_health, recorded_at\s+FROM project_health_history/);
  });

  it('Sprint capacity counts the team from resource assignments — resources has no project_id', async () => {
    expect(baselineColumns('resources')).not.toContain('project_id');
    const n = await sprintRepository.getProjectResourceCount('p1');
    expect(n).toBe(3);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).not.toMatch(/FROM resources WHERE project_id/);
    expect(sql).toMatch(/COUNT\(DISTINCT ra\.resource_id\)/);
    expect(sql).toMatch(/JOIN schedules s ON s\.id = ra\.schedule_id/);
    expect(params).toEqual(['p1']);
  });
});
