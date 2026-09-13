import { databaseService } from '../database/connection';

const globalRoles = ['admin', 'executive', 'pmo'];

function isGlobalScope(userRole: string, scope?: string): boolean {
  return globalRoles.includes(userRole) || scope === 'portfolio';
}

export interface DailyBriefing {
  generatedAt: string;
  actionItems: {
    pendingProposals: number;
    pendingChangeRequests: Array<{ id: string; title: string; projectName: string; priority: string }>;
    unreadNotifications: { total: number; critical: number; high: number };
  };
  tasksDueToday: Array<{ id: string; name: string; projectName: string; priority: string }>;
  tasksDueThisWeek: Array<{ id: string; name: string; projectName: string; dueDate: string; daysUntil: number }>;
  overdueTasks: Array<{ id: string; name: string; projectName: string; priority: string; overdueDays: number }>;
  recentHighRisks: Array<{ id: string; title: string; projectName: string; severity: string; type: string }>;
  projectHealth: {
    green: number; amber: number; red: number;
    changes: Array<{ projectName: string; from: number; to: number; direction: 'up' | 'down' }>;
  };
  budgetAlerts: Array<{ projectName: string; allocated: number; spent: number; utilization: number }>;
  upcomingMilestones: Array<{ id: string; name: string; projectName: string; dueDate: string; daysUntil: number }>;
}

class DailyBriefingService {
  async getDailyBriefing(userId: string, userRole: string, scope?: string): Promise<DailyBriefing> {
    const global = isGlobalScope(userRole, scope);
    const memberJoin = global ? '' : 'JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?';
    const memberParams = global ? [] : [userId];

    const [
      proposals,
      changeRequests,
      notifications,
      dueToday,
      dueThisWeek,
      overdue,
      risks,
      healthHistory,
      budgetAlerts,
      milestones,
    ] = await Promise.all([
      // Pending proposals
      databaseService.query<any>(
        `SELECT COUNT(*) AS cnt FROM agent_proposals ap
         JOIN projects p ON ap.project_id = p.id
         ${memberJoin}
         WHERE ap.status = 'pending'`,
        [...memberParams]
      ),
      // Pending change requests
      databaseService.query<any>(
        `SELECT cr.id, cr.title, p.name AS projectName, cr.priority
         FROM change_requests cr
         JOIN projects p ON cr.project_id = p.id
         ${memberJoin}
         WHERE cr.status IN ('pending', 'in_review')
         ORDER BY cr.created_at DESC LIMIT 10`,
        [...memberParams]
      ),
      // Unread notifications (control plane table)
      databaseService.queryControlPlane<any>(
        `SELECT severity, COUNT(*) AS cnt FROM notifications
         WHERE user_id = ? AND is_read = 0
         GROUP BY severity`,
        [userId]
      ),
      // Tasks due today
      databaseService.query<any>(
        `SELECT t.id, t.name, p.name AS projectName, t.priority
         FROM tasks t
         JOIN schedules s ON t.schedule_id = s.id
         JOIN projects p ON s.project_id = p.id
         ${memberJoin}
         WHERE t.end_date = CURDATE()
           AND t.status NOT IN ('completed', 'done', 'cancelled')
         ORDER BY t.priority DESC LIMIT 20`,
        [...memberParams]
      ),
      // Tasks due this week (next 7 days, excluding today)
      databaseService.query<any>(
        `SELECT t.id, t.name, p.name AS projectName, t.end_date AS dueDate,
                DATEDIFF(t.end_date, CURDATE()) AS daysUntil
         FROM tasks t
         JOIN schedules s ON t.schedule_id = s.id
         JOIN projects p ON s.project_id = p.id
         ${memberJoin}
         WHERE t.end_date BETWEEN DATE_ADD(CURDATE(), INTERVAL 1 DAY) AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
           AND t.status NOT IN ('completed', 'done', 'cancelled')
         ORDER BY t.end_date ASC LIMIT 20`,
        [...memberParams]
      ),
      // Overdue tasks
      databaseService.query<any>(
        `SELECT t.id, t.name, p.name AS projectName, t.priority,
                DATEDIFF(CURDATE(), t.end_date) AS overdueDays
         FROM tasks t
         JOIN schedules s ON t.schedule_id = s.id
         JOIN projects p ON s.project_id = p.id
         ${memberJoin}
         WHERE t.end_date < CURDATE()
           AND t.status NOT IN ('completed', 'done', 'cancelled')
         ORDER BY overdueDays DESC LIMIT 10`,
        [...memberParams]
      ),
      // Recent high risks (last 24h)
      databaseService.query<any>(
        `SELECT pr.id, pr.title, p.name AS projectName, pr.severity, pr.type
         FROM project_risks pr
         JOIN projects p ON pr.project_id = p.id
         ${memberJoin}
         WHERE pr.severity IN ('critical', 'high')
           AND pr.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
         ORDER BY pr.created_at DESC LIMIT 10`,
        [...memberParams]
      ),
      // Project health history (latest 2 snapshots per project)
      databaseService.query<any>(
        `SELECT ph.project_id, p.name AS projectName, ph.health_score, ph.recorded_at
         FROM project_health_history ph
         JOIN projects p ON ph.project_id = p.id
         ${memberJoin}
         WHERE ph.recorded_at >= DATE_SUB(CURDATE(), INTERVAL 2 DAY)
         ORDER BY ph.project_id, ph.recorded_at DESC`,
        [...memberParams]
      ),
      // Budget alerts (>85% utilization)
      databaseService.query<any>(
        `SELECT p.name AS projectName, p.budget_allocated AS allocated,
                p.budget_spent AS spent,
                ROUND((p.budget_spent / p.budget_allocated) * 100, 1) AS utilization
         FROM projects p
         ${memberJoin}
         WHERE p.budget_allocated > 0
           AND (p.budget_spent / p.budget_allocated) > 0.85
         ORDER BY utilization DESC LIMIT 10`,
        [...memberParams]
      ),
      // Upcoming milestones (next 7 days)
      databaseService.query<any>(
        `SELECT t.id, t.name, p.name AS projectName, t.end_date AS dueDate,
                DATEDIFF(t.end_date, CURDATE()) AS daysUntil
         FROM tasks t
         JOIN schedules s ON t.schedule_id = s.id
         JOIN projects p ON s.project_id = p.id
         ${memberJoin}
         WHERE t.is_milestone = 1
           AND t.end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
           AND t.status NOT IN ('completed', 'done', 'cancelled')
         ORDER BY t.end_date ASC LIMIT 10`,
        [...memberParams]
      ),
    ]);

    // Process notifications
    const notifMap = new Map<string, number>();
    for (const row of notifications) {
      notifMap.set(row.severity, Number(row.cnt));
    }
    const totalNotif = Array.from(notifMap.values()).reduce((a, b) => a + b, 0);

    // Process health history into green/amber/red + changes
    const healthByProject = new Map<string, { name: string; scores: number[] }>();
    for (const row of healthHistory) {
      const key = row.project_id;
      if (!healthByProject.has(key)) {
        healthByProject.set(key, { name: row.projectName, scores: [] });
      }
      const entry = healthByProject.get(key)!;
      if (entry.scores.length < 2) {
        entry.scores.push(Number(row.health_score));
      }
    }

    let green = 0, amber = 0, red = 0;
    const changes: DailyBriefing['projectHealth']['changes'] = [];

    for (const [, { name, scores }] of healthByProject) {
      const latest = scores[0] ?? 0;
      if (latest >= 75) green++;
      else if (latest >= 50) amber++;
      else red++;

      if (scores.length === 2 && scores[0] !== scores[1]) {
        changes.push({
          projectName: name,
          from: scores[1],
          to: scores[0],
          direction: scores[0] > scores[1] ? 'up' : 'down',
        });
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      actionItems: {
        pendingProposals: Number(proposals[0]?.cnt ?? 0),
        pendingChangeRequests: changeRequests,
        unreadNotifications: {
          total: totalNotif,
          critical: notifMap.get('critical') ?? 0,
          high: notifMap.get('high') ?? 0,
        },
      },
      tasksDueToday: dueToday,
      tasksDueThisWeek: dueThisWeek,
      overdueTasks: overdue,
      recentHighRisks: risks,
      projectHealth: { green, amber, red, changes },
      budgetAlerts,
      upcomingMilestones: milestones,
    };
  }
}

export const dailyBriefingService = new DailyBriefingService();
