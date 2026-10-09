import { v4 as uuidv4 } from 'uuid';
import { databaseService } from '../../database/connection';
import { PredictiveIntelligenceService } from '../predictiveIntelligence';
import logger from '../../utils/logger';
import { chunksOf } from '../../utils/chunksOf';

// Minimal fastify-like object for PredictiveIntelligenceService constructor
const fakeFastify = { log: logger } as any;

export async function runHealthSnapshot(): Promise<number> {
  let projects: any[];
  try {
    projects = await databaseService.query(
      "SELECT id FROM projects WHERE status IN ('active', 'in_progress')"
    );
  } catch {
    logger.warn('[HealthSnapshot] Could not query projects — table may not exist');
    return 0;
  }

  if (projects.length === 0) return 0;

  const service = new PredictiveIntelligenceService(fakeFastify);
  const rows: any[][] = [];

  for (const project of projects) {
    try {
      // eslint-disable-next-line no-await-in-loop -- each project's score is its own calculation over that project's data, one at a time (a company can have hundreds); a failure skips only that project
      const result = await service.getProjectHealthScore(project.id);
      rows.push([
        uuidv4(),
        project.id,
        result.healthScore,
        result.riskLevel,
        result.breakdown.scheduleHealth,
        result.breakdown.budgetHealth,
        result.breakdown.riskHealth,
      ]);
    } catch (err) {
      logger.error(`[HealthSnapshot] Failed for project ${project.id}:`, err);
    }
  }

  // The scores saved in one INSERT per 200 projects, not one per project (2026-10-09)
  let recorded = 0;
  for (const chunk of chunksOf(rows, 200)) {
    // eslint-disable-next-line no-await-in-loop -- one statement per 200 projects
    recorded += await insertSnapshots(chunk);
  }
  if (recorded > 0) {
    logger.info(`[HealthSnapshot] Recorded health scores for ${recorded}/${projects.length} projects`);
  }
  return recorded;
}

const SNAPSHOT_INSERT = `INSERT INTO project_health_history (id, project_id, health_score, risk_level, schedule_health, budget_health, risk_health, recorded_at)
         VALUES `;
const SNAPSHOT_ROW = '(?, ?, ?, ?, ?, ?, ?, NOW())';

/**
 * Saves these snapshots in one statement; returns how many were saved. If that statement fails,
 * each is saved alone so one bad row loses only its own project, as before.
 */
async function insertSnapshots(rows: any[][]): Promise<number> {
  try {
    await databaseService.query(SNAPSHOT_INSERT + rows.map(() => SNAPSHOT_ROW).join(', '), rows.flat());
    return rows.length;
  } catch {
    let saved = 0;
    for (const row of rows) {
      try {
        // eslint-disable-next-line no-await-in-loop -- fallback only when the one INSERT failed: finds the bad row, the others are still saved
        await databaseService.query(SNAPSHOT_INSERT + SNAPSHOT_ROW, row);
        saved++;
      } catch (err) {
        logger.error(`[HealthSnapshot] Failed for project ${row[1]}:`, err);
      }
    }
    return saved;
  }
}
