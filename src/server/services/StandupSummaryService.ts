import { randomUUID } from 'crypto';
import { databaseService } from '../database/connection';
import { claudeService, promptTemplates } from './claudeService';
import { logAIUsage } from './aiUsageLogger';
import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StandupChanges {
  completions: Array<{ taskId: string; taskName: string; completedBy: string; completedAt: string }>;
  statusChanges: Array<{ taskId: string; taskName: string; fromStatus: string; toStatus: string; changedBy: string; changedAt: string }>;
  newTasks: Array<{ taskId: string; taskName: string; createdBy: string; createdAt: string }>;
  newRisks: Array<{ riskId: string; title: string; severity: string; type: string; createdAt: string }>;
  blockers: Array<{ taskId: string; taskName: string; assignee: string | null }>;
}

export interface StandupSummaryResult {
  id: string;
  projectId: string;
  summaryDate: string;
  changes: StandupChanges;
  narrative: string | null;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class StandupSummaryService {
  async getStandupSummary(projectId: string, userId: string, forceRefresh = false): Promise<StandupSummaryResult> {
    // Check cache
    if (!forceRefresh) {
      const cached = await databaseService.query<any>(
        `SELECT id, project_id, summary_date, changes, narrative, generated_at
         FROM standup_summaries
         WHERE project_id = ? AND summary_date = CURDATE()
         LIMIT 1`,
        [projectId],
      );

      if (cached.length > 0) {
        const row = cached[0];
        return {
          id: row.id,
          projectId: row.project_id,
          summaryDate: row.summary_date,
          changes: typeof row.changes === 'string' ? JSON.parse(row.changes) : row.changes,
          narrative: row.narrative,
          generatedAt: row.generated_at,
        };
      }
    }

    // Gather changes
    const changes = await this.gatherChanges(projectId);

    // Get project name for narrative
    let projectName = 'Unknown Project';
    try {
      const projects = await databaseService.query<any>(
        `SELECT name FROM projects WHERE id = ?`,
        [projectId],
      );
      if (projects.length > 0) projectName = projects[0].name;
    } catch { /* use default */ }

    // Generate AI narrative
    const narrative = await this.generateNarrative(changes, projectName, userId);

    // Store result
    const id = randomUUID();
    const generatedAt = new Date().toISOString();

    await databaseService.query(
      `INSERT INTO standup_summaries (id, project_id, summary_date, changes, narrative, generated_at)
       VALUES (?, ?, CURDATE(), ?, ?, NOW())
       ON DUPLICATE KEY UPDATE changes = VALUES(changes), narrative = VALUES(narrative), generated_at = VALUES(generated_at)`,
      [id, projectId, JSON.stringify(changes), narrative],
    );

    // Get actual summary_date from DB
    const stored = await databaseService.query<any>(
      `SELECT summary_date FROM standup_summaries WHERE project_id = ? AND summary_date = CURDATE() LIMIT 1`,
      [projectId],
    );
    const summaryDate = stored.length > 0 ? stored[0].summary_date : new Date().toISOString().slice(0, 10);

    return { id, projectId, summaryDate, changes, narrative, generatedAt };
  }

  private async gatherChanges(projectId: string): Promise<StandupChanges> {
    const [completions, statusChanges, newTasks, newRisks, blockers] = await Promise.all([
      // Tasks completed yesterday
      databaseService.query<any>(
        `SELECT DISTINCT t.id AS taskId, t.name AS taskName,
                COALESCE(ta.user_name, 'System') AS completedBy,
                ta.created_at AS completedAt
         FROM task_activities ta
         JOIN tasks t ON ta.task_id = t.id
         JOIN schedules s ON t.schedule_id = s.id
         WHERE s.project_id = ?
           AND ta.action = 'status_changed'
           AND ta.new_value IN ('completed', 'done')
           AND ta.created_at >= CURDATE() - INTERVAL 1 DAY
           AND ta.created_at < CURDATE()
         ORDER BY ta.created_at DESC`,
        [projectId],
      ),

      // Status changes yesterday (excluding completions to avoid duplication)
      databaseService.query<any>(
        `SELECT t.id AS taskId, t.name AS taskName,
                ta.old_value AS fromStatus, ta.new_value AS toStatus,
                COALESCE(ta.user_name, 'System') AS changedBy,
                ta.created_at AS changedAt
         FROM task_activities ta
         JOIN tasks t ON ta.task_id = t.id
         JOIN schedules s ON t.schedule_id = s.id
         WHERE s.project_id = ?
           AND ta.action = 'status_changed'
           AND ta.new_value NOT IN ('completed', 'done')
           AND ta.created_at >= CURDATE() - INTERVAL 1 DAY
           AND ta.created_at < CURDATE()
         ORDER BY ta.created_at DESC`,
        [projectId],
      ),

      // New tasks created yesterday
      databaseService.query<any>(
        `SELECT t.id AS taskId, t.name AS taskName,
                COALESCE(ta.user_name, 'System') AS createdBy,
                ta.created_at AS createdAt
         FROM task_activities ta
         JOIN tasks t ON ta.task_id = t.id
         JOIN schedules s ON t.schedule_id = s.id
         WHERE s.project_id = ?
           AND ta.action = 'created'
           AND ta.created_at >= CURDATE() - INTERVAL 1 DAY
           AND ta.created_at < CURDATE()
         ORDER BY ta.created_at DESC`,
        [projectId],
      ),

      // New or escalated risks yesterday
      databaseService.query<any>(
        `SELECT pr.id AS riskId, pr.title, pr.severity, pr.type,
                COALESCE(ral.created_at, pr.created_at) AS createdAt
         FROM project_risks pr
         LEFT JOIN raid_activity_log ral ON ral.raid_item_id = pr.id
           AND ral.action_type IN ('created', 'status_change')
           AND ral.created_at >= CURDATE() - INTERVAL 1 DAY
           AND ral.created_at < CURDATE()
         WHERE pr.project_id = ?
           AND (
             (pr.created_at >= CURDATE() - INTERVAL 1 DAY AND pr.created_at < CURDATE())
             OR ral.id IS NOT NULL
           )
         ORDER BY pr.severity DESC`,
        [projectId],
      ),

      // Current blockers (not time-filtered)
      databaseService.query<any>(
        `SELECT t.id AS taskId, t.name AS taskName, t.assigned_to AS assignee
         FROM tasks t
         JOIN schedules s ON t.schedule_id = s.id
         WHERE s.project_id = ?
           AND t.status = 'blocked'
         ORDER BY t.priority DESC`,
        [projectId],
      ),
    ]);

    return { completions, statusChanges, newTasks, newRisks, blockers };
  }

  private async generateNarrative(changes: StandupChanges, projectName: string, userId: string): Promise<string | null> {
    if (!claudeService.isAvailable()) return null;

    const totalChanges = changes.completions.length + changes.statusChanges.length +
      changes.newTasks.length + changes.newRisks.length + changes.blockers.length;
    if (totalChanges === 0) return null;

    try {
      const systemPrompt = promptTemplates.standupSummary.render({
        projectName,
        changes: JSON.stringify(changes, null, 2),
      });

      const result = await claudeService.complete({
      feature: 'standup-summary',
      tier: 'light', // routine job: the cheaper model
        systemPrompt,
        userMessage: 'Generate a concise standup summary narrative for this project based on the changes data.',
        temperature: 0.3,
        maxTokens: 1024,
      });

      logAIUsage({
        userId,
        feature: 'standup-summary',
        model: 'claude',
        usage: result.usage,
        latencyMs: result.latencyMs,
        success: true,
      });

      return result.content.trim();
    } catch (error) {
      logger.error(`AI standup narrative generation failed: ${error instanceof Error ? error.message : String(error)}`);

      logAIUsage({
        userId,
        feature: 'standup-summary',
        model: 'claude',
        usage: { inputTokens: 0, outputTokens: 0 },
        latencyMs: 0,
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      return null;
    }
  }
}

export const standupSummaryService = new StandupSummaryService();
