import { databaseService } from '../database/connection';
import { computeScheduleRowNumbers } from '../utils/scheduleRowNumbers';
import { toDateString } from '../utils/calendarDate';

const globalRoles = ['admin', 'executive', 'pmo'];
const managerRoles = ['admin', 'pmo', 'executive', 'project_manager', 'scrum_master'];
// Roles that only see tasks assigned to them (not all project tasks)
const restrictedRoles = ['viewer', 'team_member'];

function isGlobalScope(userRole: string, scope?: string): boolean {
  return globalRoles.includes(userRole) || scope === 'portfolio';
}

export interface RaidWatchItem {
  id: string;
  type: 'action_item' | 'blocked_task' | 'open_issue';
  label: string;
  projectId: string;
  projectName: string;
  projectCode: string;
  detail: string;
  linkTab: 'raid' | 'schedule';
  resourceName?: string;
  /** Row on the schedule screen (blocked tasks only) */
  rowNumber?: number;
  /** Schedule the task lives in (blocked tasks only) — for a link straight to the row */
  scheduleId?: string;
}

/** One line per project the user can see, so the briefing can show every project — quiet ones included. */
export interface BriefingProject {
  id: string;
  name: string;
  code: string;
  projectType: string | null;
  methodology: string | null;
  /** True counts — the item lists are capped, these are not */
  counts: { overdue: number; dueSoon: number; blocked: number; openIssues: number; overdueActions: number };
  nextMilestone: { name: string; dueDate: string } | null;
}

export interface BriefingTask {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  projectCode: string;
  scheduleId: string;
  sortOrder: number;
  /** Row the task shows on the schedule screen — use this, not sortOrder, for display */
  rowNumber?: number;
  priority: string;
  resourceName?: string;
}

export interface BriefingOverdueTask extends BriefingTask {
  overdueDays: number;
}

export interface BriefingDueTask extends BriefingTask {
  dueDate: string;
  daysUntil: number;
}

export interface DailyBriefing {
  generatedAt: string;
  userRole: string;
  actionItems: {
    pendingProposals: number;
    pendingChangeRequests: Array<{ id: string; title: string; projectName: string; projectId: string; projectCode: string; priority: string }>;
    unreadNotifications: { total: number; critical: number; high: number };
  };
  tasksDueToday: BriefingTask[];
  tasksDueThisWeek: BriefingDueTask[];
  overdueTasks: BriefingOverdueTask[];
  recentHighRisks: Array<{ id: string; title: string; projectId: string; projectName: string; projectCode: string; severity: string; type: string; ownerName?: string }>;
  upcomingMilestones: Array<{ id: string; name: string; projectId: string; projectName: string; projectCode: string; scheduleId: string; dueDate: string; daysUntil: number }>;
  raidWatch: RaidWatchItem[];
  projects: BriefingProject[];
}

/** Items per section. The page shows a few per project; this cap only bounds the payload. */
const ITEM_CAP = 50;

// Subquery to exclude parent/summary tasks (tasks that have children)
const NOT_PARENT = `AND t.id NOT IN (SELECT DISTINCT parent_task_id FROM tasks WHERE parent_task_id IS NOT NULL)`;

class DailyBriefingService {
  async getDailyBriefing(userId: string, userRole: string, scope?: string): Promise<DailyBriefing> {
    const global = isGlobalScope(userRole, scope);
    const memberJoin = global ? '' : 'JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?';
    const memberParams = global ? [] : [userId];
    const showResource = managerRoles.includes(userRole);
    const isRestricted = restrictedRoles.includes(userRole);

    // Same fallback as the schedule screen: a resource (by id, or by linked user), else the
    // free text typed into "Assigned to" — but never a bare id that matched nothing.
    const resourceSelect = showResource
      ? `, COALESCE(
           r.name,
           (SELECT ru.name FROM resources ru WHERE ru.user_id = t.assigned_to LIMIT 1),
           CASE WHEN t.assigned_to REGEXP '^[0-9a-fA-F-]{36}$' THEN NULL ELSE NULLIF(TRIM(t.assigned_to), '') END
         ) AS resourceName`
      : '';
    const resourceJoin = showResource ? 'LEFT JOIN resources r ON t.assigned_to = r.id' : '';

    // Restricted roles only see tasks assigned to them (via resource linked to their user)
    const assignedJoin = isRestricted ? 'JOIN resources assigned_r ON t.assigned_to = assigned_r.id AND assigned_r.user_id = ?' : '';
    const assignedParams = isRestricted ? [userId] : [];
    // For action items, restrict by assignee_user_id
    const actionAssignedFilter = isRestricted ? 'AND mai.assignee_user_id = ?' : '';
    const actionAssignedParams = isRestricted ? [userId] : [];

    // Every section joins projects with `p.archived_at IS NULL`: an archived project must not
    // appear — the briefing used to link straight into archived projects, so a PM could work in
    // one without knowing it was archived (it was hidden from the Projects list).
    const [
      proposals,
      changeRequests,
      notifications,
      dueToday,
      dueThisWeek,
      overdue,
      risks,
      milestones,
      overdueActions,
      blockedTasks,
      openIssues,
      projectRows,
      overdueCounts,
      dueSoonCounts,
      blockedCounts,
      issueCounts,
      actionCounts,
      nextMilestones,
    ] = await Promise.all([
      // Pending proposals
      databaseService.query<any>(
        `SELECT COUNT(*) AS cnt FROM agent_proposals ap
         JOIN projects p ON ap.project_id = p.id AND p.archived_at IS NULL
         ${memberJoin}
         WHERE ap.status = 'pending'`,
        [...memberParams]
      ),
      // Pending change requests
      databaseService.query<any>(
        `SELECT cr.id, cr.title, p.name AS projectName, p.id AS projectId,
                COALESCE(p.project_code, '') AS projectCode, cr.priority
         FROM change_requests cr
         JOIN projects p ON cr.project_id = p.id AND p.archived_at IS NULL
         ${memberJoin}
         WHERE cr.status IN ('pending', 'in_review')
         ORDER BY cr.created_at DESC LIMIT ${ITEM_CAP}`,
        [...memberParams]
      ),
      // Unread notifications (control plane table)
      databaseService.queryControlPlane<any>(
        `SELECT severity, COUNT(*) AS cnt FROM notifications
         WHERE user_id = ? AND is_read = 0
         GROUP BY severity`,
        [userId]
      ),
      // Tasks due today (leaf tasks only)
      databaseService.query<any>(
        `SELECT t.id, t.name, p.name AS projectName, p.id AS projectId,
                COALESCE(p.project_code, '') AS projectCode,
                s.id AS scheduleId, t.sort_order AS sortOrder, t.priority
                ${resourceSelect}
         FROM tasks t
         JOIN schedules s ON t.schedule_id = s.id
         JOIN projects p ON s.project_id = p.id AND p.archived_at IS NULL
         ${resourceJoin}
         ${assignedJoin}
         ${memberJoin}
         WHERE t.end_date = CURDATE()
           AND t.status NOT IN ('completed', 'done', 'cancelled')
           ${NOT_PARENT}
         ORDER BY t.priority DESC LIMIT ${ITEM_CAP}`,
        [...assignedParams, ...memberParams]
      ),
      // Tasks due this week (next 7 days, excluding today, leaf tasks only)
      databaseService.query<any>(
        `SELECT t.id, t.name, p.name AS projectName, p.id AS projectId,
                COALESCE(p.project_code, '') AS projectCode,
                s.id AS scheduleId, t.sort_order AS sortOrder, t.priority,
                t.end_date AS dueDate,
                DATEDIFF(t.end_date, CURDATE()) AS daysUntil
                ${resourceSelect}
         FROM tasks t
         JOIN schedules s ON t.schedule_id = s.id
         JOIN projects p ON s.project_id = p.id AND p.archived_at IS NULL
         ${resourceJoin}
         ${assignedJoin}
         ${memberJoin}
         WHERE t.end_date BETWEEN DATE_ADD(CURDATE(), INTERVAL 1 DAY) AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
           AND t.status NOT IN ('completed', 'done', 'cancelled')
           ${NOT_PARENT}
         ORDER BY t.end_date ASC LIMIT ${ITEM_CAP}`,
        [...assignedParams, ...memberParams]
      ),
      // Overdue tasks (leaf tasks only)
      databaseService.query<any>(
        `SELECT t.id, t.name, p.name AS projectName, p.id AS projectId,
                COALESCE(p.project_code, '') AS projectCode,
                s.id AS scheduleId, t.sort_order AS sortOrder, t.priority,
                DATEDIFF(CURDATE(), t.end_date) AS overdueDays
                ${resourceSelect}
         FROM tasks t
         JOIN schedules s ON t.schedule_id = s.id
         JOIN projects p ON s.project_id = p.id AND p.archived_at IS NULL
         ${resourceJoin}
         ${assignedJoin}
         ${memberJoin}
         WHERE t.end_date < CURDATE()
           AND t.status NOT IN ('completed', 'done', 'cancelled')
           ${NOT_PARENT}
         ORDER BY overdueDays DESC LIMIT ${ITEM_CAP}`,
        [...assignedParams, ...memberParams]
      ),
      // Recent high risks (last 24h)
      databaseService.query<any>(
        `SELECT pr.id, pr.title, p.name AS projectName, p.id AS projectId,
                COALESCE(p.project_code, '') AS projectCode, pr.severity, pr.type,
                pr.owner_id AS ownerId, ores.name AS ownerResourceName, pr.owner_name AS ownerText
         FROM project_risks pr
         JOIN projects p ON pr.project_id = p.id AND p.archived_at IS NULL
         LEFT JOIN resources ores ON ores.id = pr.owner_resource_id
         ${memberJoin}
         WHERE pr.severity IN ('critical', 'high')
           AND pr.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
         ORDER BY pr.created_at DESC LIMIT 10`,
        [...memberParams]
      ),
      // Upcoming milestones (next 7 days)
      databaseService.query<any>(
        `SELECT t.id, t.name, p.name AS projectName, p.id AS projectId,
                COALESCE(p.project_code, '') AS projectCode,
                s.id AS scheduleId,
                t.end_date AS dueDate,
                DATEDIFF(t.end_date, CURDATE()) AS daysUntil
         FROM tasks t
         JOIN schedules s ON t.schedule_id = s.id
         JOIN projects p ON s.project_id = p.id AND p.archived_at IS NULL
         ${assignedJoin}
         ${memberJoin}
         WHERE t.is_milestone = 1
           AND t.end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
           AND t.status NOT IN ('completed', 'done', 'cancelled')
         ORDER BY t.end_date ASC LIMIT 10`,
        [...assignedParams, ...memberParams]
      ),
      // RAID Watch: Overdue meeting action items
      databaseService.query<any>(
        `SELECT mai.id, mai.description, mai.due_date, p.id AS projectId, p.name AS projectName,
                COALESCE(p.project_code, '') AS projectCode,
                DATEDIFF(CURDATE(), mai.due_date) AS overdueDays,
                mai.assignee_name AS resourceName
         FROM meeting_action_items mai
         JOIN projects p ON mai.project_id = p.id AND p.archived_at IS NULL
         ${memberJoin}
         WHERE mai.due_date < CURDATE()
           AND mai.status NOT IN ('completed', 'cancelled')
           ${actionAssignedFilter}
         ORDER BY mai.due_date ASC LIMIT ${ITEM_CAP}`,
        [...memberParams, ...actionAssignedParams]
      ),
      // RAID Watch: Blocked tasks (FS predecessor not completed, leaf tasks only)
      databaseService.query<any>(
        `SELECT t.id, t.name, p.id AS projectId, p.name AS projectName,
                COALESCE(p.project_code, '') AS projectCode,
                s.id AS scheduleId, t.sort_order AS sortOrder,
                pred.name AS blockedByName
                ${resourceSelect}
         FROM task_dependencies td
         JOIN tasks t ON td.task_id = t.id
         JOIN tasks pred ON td.dependency_id = pred.id
         JOIN schedules s ON t.schedule_id = s.id
         JOIN projects p ON s.project_id = p.id AND p.archived_at IS NULL
         ${resourceJoin}
         ${assignedJoin}
         ${memberJoin}
         WHERE td.dependency_type = 'FS'
           AND pred.status NOT IN ('completed', 'done', 'cancelled')
           AND t.status NOT IN ('completed', 'done', 'cancelled')
           AND pred.end_date < CURDATE()
           ${NOT_PARENT}
         ORDER BY pred.end_date ASC LIMIT ${ITEM_CAP}`,
        [...assignedParams, ...memberParams]
      ),
      // RAID Watch: Open issues (unresolved risks of type 'issue')
      databaseService.query<any>(
        `SELECT pr.id, pr.title, pr.severity, p.id AS projectId, p.name AS projectName,
                COALESCE(p.project_code, '') AS projectCode
         FROM project_risks pr
         JOIN projects p ON pr.project_id = p.id AND p.archived_at IS NULL
         ${memberJoin}
         WHERE pr.type = 'issue'
           AND pr.status NOT IN ('resolved', 'closed', 'cancelled', 'mitigated')
           ${isRestricted ? 'AND pr.owner_id = ?' : ''}
         ORDER BY FIELD(pr.severity, 'critical', 'high', 'medium', 'low'), pr.created_at DESC
         LIMIT ${ITEM_CAP}`,
        [...memberParams, ...(isRestricted ? [userId] : [])]
      ),
      // Every project the user can see (quiet ones too), for the per-project view
      databaseService.query<any>(
        `SELECT p.id, p.name, COALESCE(p.project_code, '') AS code, p.project_type AS projectType, p.methodology
         FROM projects p
         ${memberJoin}
         WHERE p.archived_at IS NULL AND COALESCE(p.is_demo, 0) = 0
         ORDER BY p.name`,
        [...memberParams]
      ),
      // True per-project counts — same filters as the lists above, without their caps
      databaseService.query<any>(
        `SELECT p.id AS projectId, COUNT(*) AS cnt
         FROM tasks t
         JOIN schedules s ON t.schedule_id = s.id
         JOIN projects p ON s.project_id = p.id AND p.archived_at IS NULL
         ${assignedJoin}
         ${memberJoin}
         WHERE t.end_date < CURDATE()
           AND t.status NOT IN ('completed', 'done', 'cancelled')
           ${NOT_PARENT}
         GROUP BY p.id`,
        [...assignedParams, ...memberParams]
      ),
      databaseService.query<any>(
        `SELECT p.id AS projectId, COUNT(*) AS cnt
         FROM tasks t
         JOIN schedules s ON t.schedule_id = s.id
         JOIN projects p ON s.project_id = p.id AND p.archived_at IS NULL
         ${assignedJoin}
         ${memberJoin}
         WHERE t.end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
           AND t.status NOT IN ('completed', 'done', 'cancelled')
           ${NOT_PARENT}
         GROUP BY p.id`,
        [...assignedParams, ...memberParams]
      ),
      databaseService.query<any>(
        `SELECT p.id AS projectId, COUNT(DISTINCT t.id) AS cnt
         FROM task_dependencies td
         JOIN tasks t ON td.task_id = t.id
         JOIN tasks pred ON td.dependency_id = pred.id
         JOIN schedules s ON t.schedule_id = s.id
         JOIN projects p ON s.project_id = p.id AND p.archived_at IS NULL
         ${assignedJoin}
         ${memberJoin}
         WHERE td.dependency_type = 'FS'
           AND pred.status NOT IN ('completed', 'done', 'cancelled')
           AND t.status NOT IN ('completed', 'done', 'cancelled')
           AND pred.end_date < CURDATE()
           ${NOT_PARENT}
         GROUP BY p.id`,
        [...assignedParams, ...memberParams]
      ),
      databaseService.query<any>(
        `SELECT p.id AS projectId, COUNT(*) AS cnt
         FROM project_risks pr
         JOIN projects p ON pr.project_id = p.id AND p.archived_at IS NULL
         ${memberJoin}
         WHERE pr.type = 'issue'
           AND pr.status NOT IN ('resolved', 'closed', 'cancelled', 'mitigated')
           ${isRestricted ? 'AND pr.owner_id = ?' : ''}
         GROUP BY p.id`,
        [...memberParams, ...(isRestricted ? [userId] : [])]
      ),
      databaseService.query<any>(
        `SELECT p.id AS projectId, COUNT(*) AS cnt
         FROM meeting_action_items mai
         JOIN projects p ON mai.project_id = p.id AND p.archived_at IS NULL
         ${memberJoin}
         WHERE mai.due_date < CURDATE()
           AND mai.status NOT IN ('completed', 'cancelled')
           ${actionAssignedFilter}
         GROUP BY p.id`,
        [...memberParams, ...actionAssignedParams]
      ),
      // Next open milestone per project (any distance ahead) — the "Next:" line on quiet projects
      databaseService.query<any>(
        `SELECT projectId, name, dueDate FROM (
           SELECT p.id AS projectId, t.name, t.end_date AS dueDate,
                  ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY t.end_date, t.id) AS rn
           FROM tasks t
           JOIN schedules s ON t.schedule_id = s.id
           JOIN projects p ON s.project_id = p.id AND p.archived_at IS NULL
           ${memberJoin}
           WHERE t.is_milestone = 1
             AND t.end_date >= CURDATE()
             AND t.status NOT IN ('completed', 'done', 'cancelled')
         ) m WHERE rn = 1`,
        [...memberParams]
      ),
    ]);

    // Row numbers as shown on the schedule screen, for every schedule that has a task in the briefing
    const scheduleIds = [...new Set([...dueToday, ...dueThisWeek, ...overdue, ...blockedTasks].map((t: any) => t.scheduleId))];
    const rowNumbers = new Map<string, number>();
    if (scheduleIds.length > 0) {
      const scheduleTasks = await databaseService.query<any>(
        `SELECT id, schedule_id AS scheduleId, parent_task_id AS parentTaskId, sort_order AS sortOrder, start_date AS startDate,
                created_at AS createdAt
         FROM tasks WHERE schedule_id IN (${scheduleIds.map(() => '?').join(',')})`,
        scheduleIds
      );
      const bySchedule = new Map<string, any[]>();
      for (const t of scheduleTasks) {
        if (!bySchedule.has(t.scheduleId)) bySchedule.set(t.scheduleId, []);
        bySchedule.get(t.scheduleId)!.push(t);
      }
      for (const list of bySchedule.values()) {
        for (const [id, n] of computeScheduleRowNumbers(list)) rowNumbers.set(id, n);
      }
    }
    const withRowNumber = <T extends { id: string }>(list: T[]) => list.map(t => ({ ...t, rowNumber: rowNumbers.get(t.id) }));

    // Risk owners, in the RAID panel's order: a member (login account, name lives in the
    // control plane), then a resource with no login, then the free-text name. Managers only,
    // like task owners.
    const riskOwnerIds = showResource ? [...new Set(risks.map((r: any) => r.ownerId).filter(Boolean))] : [];
    const ownerUserNames = new Map<string, string>();
    if (riskOwnerIds.length > 0) {
      const users = await databaseService.queryControlPlane<any>(
        `SELECT id, full_name FROM users WHERE id IN (${riskOwnerIds.map(() => '?').join(',')})`,
        riskOwnerIds
      );
      for (const u of users) if (u.full_name) ownerUserNames.set(u.id, u.full_name);
    }
    const recentHighRisks = risks.map(({ ownerId, ownerResourceName, ownerText, ...risk }: any) => ({
      ...risk,
      ownerName: showResource
        ? (ownerUserNames.get(ownerId) || ownerResourceName || ownerText || undefined)
        : undefined,
    }));

    // Process notifications
    const notifMap = new Map<string, number>();
    for (const row of notifications) {
      notifMap.set(row.severity, Number(row.cnt));
    }
    const totalNotif = Array.from(notifMap.values()).reduce((a, b) => a + b, 0);

    // Build RAID Watch items
    const raidWatch: RaidWatchItem[] = [];

    for (const item of overdueActions) {
      raidWatch.push({
        id: item.id,
        type: 'action_item',
        label: item.description?.substring(0, 80) || 'Action item',
        projectId: item.projectId,
        projectName: item.projectName,
        projectCode: item.projectCode,
        detail: `${item.overdueDays}d overdue`,
        linkTab: 'raid',
        resourceName: showResource ? (item.resourceName || undefined) : undefined,
      });
    }

    for (const item of blockedTasks) {
      raidWatch.push({
        id: item.id,
        type: 'blocked_task',
        label: item.name,
        projectId: item.projectId,
        projectName: item.projectName,
        projectCode: item.projectCode,
        detail: `blocked by: ${item.blockedByName}`,
        linkTab: 'schedule',
        resourceName: showResource ? (item.resourceName || undefined) : undefined,
        rowNumber: rowNumbers.get(item.id),
        scheduleId: item.scheduleId,
      });
    }

    for (const item of openIssues) {
      raidWatch.push({
        id: item.id,
        type: 'open_issue',
        label: item.title,
        projectId: item.projectId,
        projectName: item.projectName,
        projectCode: item.projectCode,
        detail: `${item.severity} issue`,
        linkTab: 'raid',
      });
    }

    const countMap = (rows: any[]) => new Map<string, number>(rows.map((r: any) => [r.projectId, Number(r.cnt)]));
    const [oc, dc, bc, ic, ac] = [overdueCounts, dueSoonCounts, blockedCounts, issueCounts, actionCounts].map(countMap);
    const nextByProject = new Map<string, { name: string; dueDate: string }>(
      nextMilestones.map((m: any) => [m.projectId, { name: m.name, dueDate: toDateString(m.dueDate) ?? String(m.dueDate) }]),
    );
    const projects: BriefingProject[] = projectRows.map((p: any) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      projectType: p.projectType ?? null,
      methodology: p.methodology ?? null,
      counts: {
        overdue: oc.get(p.id) ?? 0,
        dueSoon: dc.get(p.id) ?? 0,
        blocked: bc.get(p.id) ?? 0,
        openIssues: ic.get(p.id) ?? 0,
        overdueActions: ac.get(p.id) ?? 0,
      },
      nextMilestone: nextByProject.get(p.id) ?? null,
    }));

    return {
      generatedAt: new Date().toISOString(),
      userRole,
      actionItems: {
        pendingProposals: Number(proposals[0]?.cnt ?? 0),
        pendingChangeRequests: changeRequests,
        unreadNotifications: {
          total: totalNotif,
          critical: notifMap.get('critical') ?? 0,
          high: notifMap.get('high') ?? 0,
        },
      },
      tasksDueToday: withRowNumber(dueToday),
      tasksDueThisWeek: withRowNumber(dueThisWeek),
      overdueTasks: withRowNumber(overdue),
      recentHighRisks,
      upcomingMilestones: milestones,
      raidWatch,
      projects,
    };
  }
}

export const dailyBriefingService = new DailyBriefingService();
