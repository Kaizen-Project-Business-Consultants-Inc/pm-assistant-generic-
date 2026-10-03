import { databaseService } from '../database/connection';
import { getTenantContext } from '../middleware/requestContext';
import { computeScheduleRowNumbers } from '../utils/scheduleRowNumbers';
import { toDateString } from '../utils/calendarDate';
import { readableProjectJoin } from '../utils/readableProjects';

const globalRoles = ['admin', 'executive', 'pmo'];
const managerRoles = ['admin', 'pmo', 'executive', 'project_manager', 'scrum_master'];
// Roles that only see tasks assigned to them (not all project tasks)
const restrictedRoles = ['viewer', 'team_member'];

// '?scope=portfolio' used to make ANY role see every project. The whole portfolio is only for
// admin/PMO/executive; everyone else sees their own projects whatever they ask for.
function isGlobalScope(userRole: string, _scope?: string): boolean {
  return globalRoles.includes(userRole);
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
  /** The user is this project's Manager/Owner (or admin/PMO): sees the team follow-up list */
  canManage: boolean;
}

/** Work assigned to the signed-in user — "Yours to do" in each project */
export interface BriefingMine {
  tasks: Array<{ id: string; name: string; projectId: string; scheduleId: string; dueDate: string | null; status: string; overdueDays: number; rowNumber?: number }>;
  raidItems: Array<{ id: string; title: string; type: string; status: string; severity: string | null; dueDate: string | null; projectId: string }>;
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
  mine: BriefingMine;
  /** In progress for over a week with no progress recorded — the team follow-up list */
  stalledTasks: Array<BriefingTask & { daysSinceStart: number }>;
  /** Agent proposals waiting for a decision, by project */
  pendingProposals: Array<{ id: string; title: string; projectId: string; riskLevel: string | null; createdAt: string }>;
  /** RAID items escalated to High/Critical or closed in the last 24 h — the team's daily digest */
  raidChanges: Array<{ id: string; projectId: string; projectName: string; projectCode: string; title: string; type: string; change: 'escalated' | 'closed'; to: string; at: string }>;
}

/** Items per section. The page shows a few per project; this cap only bounds the payload. */
const ITEM_CAP = 50;

// Subquery to exclude parent/summary tasks (tasks that have children)
const NOT_PARENT = `AND t.id NOT IN (SELECT DISTINCT parent_task_id FROM tasks WHERE parent_task_id IS NOT NULL)`;

function emptyBriefing(userRole: string): DailyBriefing {
  return {
    generatedAt: new Date().toISOString(),
    userRole,
    actionItems: { pendingProposals: 0, pendingChangeRequests: [], unreadNotifications: { total: 0, critical: 0, high: 0 } },
    tasksDueToday: [], tasksDueThisWeek: [], overdueTasks: [], recentHighRisks: [], upcomingMilestones: [],
    raidWatch: [], projects: [], mine: { tasks: [], raidItems: [] }, stalledTasks: [], pendingProposals: [], raidChanges: [],
  };
}

class DailyBriefingService {
  async getDailyBriefing(userId: string, userRole: string, scope?: string): Promise<DailyBriefing> {
    // An account with no organisation (e.g. a platform admin) has no project database: the
    // queries would run against the shared one, which has no project tables, and fail. Nothing
    // to brief — say so instead of a server error.
    if (!getTenantContext()) return emptyBriefing(userRole);
    const global = isGlobalScope(userRole, scope);
    // The projects this person can read (created, member of, or the sample project) — the same rule
    // as the dashboard's project list; pm = their membership, if any
    const { join: memberJoin, params: memberParams } = await readableProjectJoin({ userId, role: userRole }, global);
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
    // one without knowing it was archived (it was hidden from the Projects list). The read-only
    // sample project is left out the same way (`COALESCE(p.is_demo, 0) = 0`): it never counts.
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
      raidChangeRows,
      mineTasks,
      mineRaid,
      stalledTasks,
      proposalRows,
    ] = await Promise.all([
      // Pending proposals
      databaseService.query<any>(
        `SELECT COUNT(*) AS cnt FROM agent_proposals ap
         JOIN projects p ON ap.project_id = p.id AND p.archived_at IS NULL AND COALESCE(p.is_demo, 0) = 0
         ${memberJoin}
         WHERE ap.status = 'pending'`,
        [...memberParams]
      ),
      // Pending change requests
      databaseService.query<any>(
        `SELECT cr.id, cr.title, p.name AS projectName, p.id AS projectId,
                COALESCE(p.project_code, '') AS projectCode, cr.priority
         FROM change_requests cr
         JOIN projects p ON cr.project_id = p.id AND p.archived_at IS NULL AND COALESCE(p.is_demo, 0) = 0
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
         JOIN projects p ON s.project_id = p.id AND p.archived_at IS NULL AND COALESCE(p.is_demo, 0) = 0
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
         JOIN projects p ON s.project_id = p.id AND p.archived_at IS NULL AND COALESCE(p.is_demo, 0) = 0
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
         JOIN projects p ON s.project_id = p.id AND p.archived_at IS NULL AND COALESCE(p.is_demo, 0) = 0
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
         JOIN projects p ON pr.project_id = p.id AND p.archived_at IS NULL AND COALESCE(p.is_demo, 0) = 0
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
         JOIN projects p ON s.project_id = p.id AND p.archived_at IS NULL AND COALESCE(p.is_demo, 0) = 0
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
         JOIN projects p ON mai.project_id = p.id AND p.archived_at IS NULL AND COALESCE(p.is_demo, 0) = 0
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
         JOIN projects p ON s.project_id = p.id AND p.archived_at IS NULL AND COALESCE(p.is_demo, 0) = 0
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
         JOIN projects p ON pr.project_id = p.id AND p.archived_at IS NULL AND COALESCE(p.is_demo, 0) = 0
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
        `SELECT p.id, p.name, COALESCE(p.project_code, '') AS code, p.project_type AS projectType, p.methodology,
                p.created_by AS createdBy, ${global ? 'NULL' : 'pm.role'} AS myRole
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
         JOIN projects p ON s.project_id = p.id AND p.archived_at IS NULL AND COALESCE(p.is_demo, 0) = 0
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
         JOIN projects p ON s.project_id = p.id AND p.archived_at IS NULL AND COALESCE(p.is_demo, 0) = 0
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
         JOIN projects p ON s.project_id = p.id AND p.archived_at IS NULL AND COALESCE(p.is_demo, 0) = 0
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
         JOIN projects p ON pr.project_id = p.id AND p.archived_at IS NULL AND COALESCE(p.is_demo, 0) = 0
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
         JOIN projects p ON mai.project_id = p.id AND p.archived_at IS NULL AND COALESCE(p.is_demo, 0) = 0
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
           JOIN projects p ON s.project_id = p.id AND p.archived_at IS NULL AND COALESCE(p.is_demo, 0) = 0
           ${memberJoin}
           WHERE t.is_milestone = 1
             AND t.end_date >= CURDATE()
             AND t.status NOT IN ('completed', 'done', 'cancelled')
         ) m WHERE rn = 1`,
        [...memberParams]
      ),
      // Team digest: escalations to High/Critical and closures in the last 24 h (latest per item)
      databaseService.query<any>(
        `SELECT pr.id, pr.title, pr.type, p.id AS projectId, p.name AS projectName,
                COALESCE(p.project_code, '') AS projectCode,
                al.field_name AS fieldName, al.action_type AS actionType, al.new_value AS newValue, al.created_at AS at
         FROM raid_activity_log al
         JOIN project_risks pr ON pr.id = al.raid_item_id
         JOIN projects p ON al.project_id = p.id AND p.archived_at IS NULL AND COALESCE(p.is_demo, 0) = 0
         ${memberJoin}
         WHERE al.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
           AND (
             (al.field_name = 'severity' AND al.new_value IN ('high', 'critical'))
             OR (al.action_type IN ('status_change', 'cancelled', 'reversed')
                 AND al.new_value IN ('closed', 'resolved', 'mitigated', 'cancelled', 'reversed', 'completed'))
             OR al.action_type IN ('cancelled', 'reversed')
           )
         ORDER BY al.created_at DESC
         LIMIT ${ITEM_CAP}`,
        [...memberParams]
      ),
      // Yours to do: open leaf tasks assigned to you (through your resource), any date
      databaseService.query<any>(
        `SELECT t.id, t.name, p.id AS projectId, s.id AS scheduleId, t.end_date AS dueDate, t.status,
                GREATEST(DATEDIFF(CURDATE(), t.end_date), 0) AS overdueDays
         FROM tasks t
         JOIN resources mr ON t.assigned_to = mr.id AND mr.user_id = ?
         JOIN schedules s ON t.schedule_id = s.id
         JOIN projects p ON s.project_id = p.id AND p.archived_at IS NULL AND COALESCE(p.is_demo, 0) = 0
         ${memberJoin}
         WHERE t.status NOT IN ('completed', 'done', 'cancelled')
           ${NOT_PARENT}
         ORDER BY t.end_date ASC LIMIT 200`,
        [userId, ...memberParams]
      ),
      // Yours to do: open RAID items you own
      databaseService.query<any>(
        `SELECT pr.id, pr.title, pr.type, pr.status, pr.severity, pr.due_date AS dueDate, p.id AS projectId
         FROM project_risks pr
         JOIN projects p ON pr.project_id = p.id AND p.archived_at IS NULL AND COALESCE(p.is_demo, 0) = 0
         ${memberJoin}
         WHERE pr.owner_id = ?
           AND pr.status NOT IN ('closed', 'resolved', 'mitigated', 'cancelled', 'reversed', 'completed')
         ORDER BY pr.due_date IS NULL, pr.due_date ASC, FIELD(pr.severity, 'critical', 'high', 'medium', 'low')
         LIMIT 200`,
        [...memberParams, userId]
      ),
      // Stalled: in progress, started over a week ago, still no progress recorded (leaf tasks)
      databaseService.query<any>(
        `SELECT t.id, t.name, p.name AS projectName, p.id AS projectId,
                COALESCE(p.project_code, '') AS projectCode,
                s.id AS scheduleId, t.sort_order AS sortOrder, t.priority,
                DATEDIFF(CURDATE(), t.start_date) AS daysSinceStart
                ${resourceSelect}
         FROM tasks t
         JOIN schedules s ON t.schedule_id = s.id
         JOIN projects p ON s.project_id = p.id AND p.archived_at IS NULL AND COALESCE(p.is_demo, 0) = 0
         ${resourceJoin}
         ${assignedJoin}
         ${memberJoin}
         WHERE t.status = 'in_progress' AND COALESCE(t.progress_percentage, 0) = 0
           AND t.start_date < DATE_SUB(CURDATE(), INTERVAL 7 DAY)
           ${NOT_PARENT}
         ORDER BY t.start_date ASC LIMIT ${ITEM_CAP}`,
        [...assignedParams, ...memberParams]
      ),
      // Agent proposals waiting for a decision (listed under their project)
      databaseService.query<any>(
        `SELECT ap.id, ap.title, ap.project_id AS projectId, ap.risk_level AS riskLevel, ap.created_at AS createdAt
         FROM agent_proposals ap
         JOIN projects p ON ap.project_id = p.id AND p.archived_at IS NULL AND COALESCE(p.is_demo, 0) = 0
         ${memberJoin}
         WHERE ap.status = 'pending'
         ORDER BY ap.created_at DESC LIMIT ${ITEM_CAP}`,
        [...memberParams]
      ),
    ]);

    // Row numbers as shown on the schedule screen, for every schedule that has a task in the briefing
    const scheduleIds = [...new Set([...dueToday, ...dueThisWeek, ...overdue, ...blockedTasks, ...mineTasks, ...stalledTasks].map((t: any) => t.scheduleId))];
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
      canManage: ['admin', 'pmo'].includes(userRole) || p.createdBy === userId || p.myRole === 'owner' || p.myRole === 'manager',
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
      stalledTasks: withRowNumber(stalledTasks).map((t: any) => ({ ...t, daysSinceStart: Number(t.daysSinceStart) || 0 })),
      pendingProposals: proposalRows.map((r: any) => ({
        id: r.id, title: r.title, projectId: r.projectId, riskLevel: r.riskLevel ?? null,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      })),
      mine: {
        tasks: withRowNumber(mineTasks).map((t: any) => ({
          id: t.id, name: t.name, projectId: t.projectId, scheduleId: t.scheduleId,
          dueDate: toDateString(t.dueDate) ?? null, status: t.status, overdueDays: Number(t.overdueDays) || 0, rowNumber: t.rowNumber,
        })),
        raidItems: mineRaid.map((r: any) => ({
          id: r.id, title: r.title, type: r.type, status: r.status, severity: r.severity ?? null,
          dueDate: toDateString(r.dueDate) ?? null, projectId: r.projectId,
        })),
      },
      raidChanges: (() => {
        const seen = new Set<string>();
        const out: DailyBriefing['raidChanges'] = [];
        for (const r of raidChangeRows) {
          const change: 'escalated' | 'closed' = r.fieldName === 'severity' ? 'escalated' : 'closed';
          const key = `${r.id}|${change}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const to = r.actionType === 'cancelled' || r.actionType === 'reversed' ? r.actionType : String(r.newValue ?? '');
          out.push({ id: r.id, projectId: r.projectId, projectName: r.projectName, projectCode: r.projectCode, title: r.title, type: r.type, change, to, at: new Date(r.at).toISOString() });
        }
        return out;
      })(),
    };
  }
}

export const dailyBriefingService = new DailyBriefingService();
