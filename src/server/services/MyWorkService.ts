import { resourceRepository } from '../database/ResourceRepository';
import { meetingActionItemRepository, MeetingActionItem } from '../database/MeetingActionItemRepository';
import { databaseService } from '../database/connection';
import { projectMemberService } from './ProjectMemberService';
import { timeEntryService } from './TimeEntryService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MyWorkTask {
  id: number;
  name: string;
  status: string;
  priority: string;
  startDate: string | null;
  endDate: string | null;
  percentComplete: number;
  projectId: number;
  projectName: string;
  scheduleId: number;
}

export interface CommitmentItem {
  id: string | number;
  type: 'task' | 'action_item' | 'raid_action';
  name: string;
  projectId: string | number;
  projectName: string;
  scheduleId?: number;
  meetingTitle?: string;
  dueDate: string | null;
  priority: string;
  status: string;
  percentComplete?: number;
}

export interface MyWorkResponse {
  attention: {
    overdueCount: number;
    oldestOverdueDays: number;
    blockedCount: number;
    criticalRisks: Array<{ id: string; title: string; projectId: string; projectName: string; severity: string; type: string }>;
  };
  decisions: {
    timesheetApprovals: Array<{ id: string; userName: string; projectName: string; weekStart: string; totalHours: number; submittedAt: string }>;
    resourceRequests: Array<{ id: string; projectName: string; resourceRole: string; priority: string; requestedByName: string; createdAt: string }>;
    changeRequests: Array<{ id: string; title: string; projectName: string; priority: string; category: string; createdAt: string }>;
    proposals: Array<{ id: string; title: string; projectName: string; agentName: string; createdAt: string }>;
  };
  commitments: CommitmentItem[];
  weekAhead: Array<{
    date: string;
    dayLabel: string;
    milestones: Array<{ id: number; name: string; projectName: string }>;
    tasksDue: number;
    actionItemsDue: number;
  }>;
  recentlyCompleted: Array<{
    id: string | number;
    type: 'task' | 'action_item' | 'raid_action';
    name: string;
    projectName: string;
    completedDate: string;
  }>;
  counts: { tasks: number; actionItems: number; raidActions: number; decisions: number };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getNextBusinessDays(count: number): Array<{ date: string; dayLabel: string }> {
  const days: Array<{ date: string; dayLabel: string }> = [];
  const d = new Date();
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  while (days.length < count) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) {
      days.push({ date: toDateStr(d), dayLabel: dayNames[dow] });
    }
  }
  return days;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class MyWorkService {
  async getMyWork(userId: string): Promise<MyWorkResponse> {
    // Look up user info from control plane
    const [user] = await databaseService.queryControlPlane<{ email: string; full_name: string }>(
      'SELECT email, full_name FROM users WHERE id = ? LIMIT 1',
      [userId],
    );
    if (!user) return this.emptyResponse();

    // Resolve resources for this user (for task matching)
    const { resourceIds, nameMatches } = await this.resolveUserResources(userId, user);

    // Get user's project memberships (reused for decisions queries)
    const memberships = await projectMemberService.findByUserId(userId);
    const managerProjectIds = memberships
      .filter(m => m.role === 'owner' || m.role === 'manager')
      .map(m => m.projectId);
    const allProjectIds = memberships.map(m => m.projectId);

    const today = toDateStr(new Date());
    const nextBizDays = getNextBusinessDays(5);
    const weekAheadEnd = nextBizDays.length > 0 ? nextBizDays[nextBizDays.length - 1].date : today;

    // Run 9 queries in parallel
    const [
      tasks,
      actionItems,
      raidActions,
      timesheetApprovals,
      resourceRequests,
      changeRequests,
      proposals,
      milestones,
      recentTasks,
    ] = await Promise.all([
      // 1. Tasks assigned to user (active)
      this.queryUserTasks(resourceIds, nameMatches),
      // 2. Meeting action items
      meetingActionItemRepository.findByAssignee(userId),
      // 3. RAID actions owned by user
      this.queryRaidActions(userId),
      // 4. Timesheet approvals
      managerProjectIds.length > 0 ? timeEntryService.getPendingApprovals(userId) : Promise.resolve([]),
      // 5. Resource requests on manager projects
      managerProjectIds.length > 0 ? this.queryResourceRequests(managerProjectIds) : Promise.resolve([]),
      // 6. Change requests on manager projects
      managerProjectIds.length > 0 ? this.queryChangeRequests(managerProjectIds) : Promise.resolve([]),
      // 7. Agent proposals on user's projects
      allProjectIds.length > 0 ? this.queryProposals(allProjectIds) : Promise.resolve([]),
      // 8. Milestones this week
      allProjectIds.length > 0 ? this.queryMilestones(allProjectIds, today, weekAheadEnd) : Promise.resolve([]),
      // 9. Recently completed tasks
      this.queryRecentlyCompleted(resourceIds, nameMatches, userId),
    ]);

    // Build attention bar
    const activeTasks = tasks.filter(t => t.status !== 'completed' && t.status !== 'done');
    const overdueTasks = activeTasks.filter(t => t.endDate && t.endDate < today);
    const blockedTasks = activeTasks.filter(t => t.status === 'blocked');
    const criticalRisks = raidActions.filter(r =>
      (r.severity === 'critical' || r.severity === 'high') &&
      (r.type === 'risk' || r.type === 'issue'),
    );

    let oldestOverdueDays = 0;
    if (overdueTasks.length > 0) {
      const todayMs = new Date(today).getTime();
      oldestOverdueDays = Math.max(
        ...overdueTasks.map(t => Math.floor((todayMs - new Date(t.endDate!).getTime()) / 86400000)),
      );
    }

    // Build commitments (merge tasks + action items + raid actions)
    const commitments: CommitmentItem[] = [
      ...activeTasks.map(t => ({
        id: t.id,
        type: 'task' as const,
        name: t.name,
        projectId: t.projectId,
        projectName: t.projectName,
        scheduleId: t.scheduleId,
        dueDate: t.endDate,
        priority: t.priority,
        status: t.status,
        percentComplete: t.percentComplete,
      })),
      ...actionItems
        .filter(ai => ai.status !== 'completed' && ai.status !== 'cancelled')
        .map(ai => ({
          id: ai.id,
          type: 'action_item' as const,
          name: ai.description,
          projectId: ai.projectId,
          projectName: ai.projectName || '',
          meetingTitle: ai.meetingTitle,
          dueDate: ai.dueDate,
          priority: ai.priority,
          status: ai.status,
        })),
      ...raidActions
        .filter(r => r.type === 'action')
        .map(r => ({
          id: r.id,
          type: 'raid_action' as const,
          name: r.title,
          projectId: r.projectId,
          projectName: r.projectName,
          dueDate: r.dueDate,
          priority: r.severity,
          status: r.status,
        })),
    ];

    // Build week ahead
    const weekAhead = nextBizDays.map(day => {
      const dayMilestones = milestones.filter(m => m.endDate === day.date);
      const dayTasks = activeTasks.filter(t => t.endDate === day.date).length;
      const dayActionItems = actionItems.filter(ai =>
        ai.status !== 'completed' && ai.status !== 'cancelled' && ai.dueDate === day.date,
      ).length;
      return {
        date: day.date,
        dayLabel: day.dayLabel,
        milestones: dayMilestones.map(m => ({ id: m.id, name: m.name, projectName: m.projectName })),
        tasksDue: dayTasks,
        actionItemsDue: dayActionItems,
      };
    });

    // Build recently completed
    const recentlyCompleted = [
      ...recentTasks.map(t => ({
        id: t.id,
        type: 'task' as const,
        name: t.name,
        projectName: t.projectName,
        completedDate: t.endDate || '',
      })),
      ...actionItems
        .filter(ai => ai.status === 'completed' && ai.completedAt)
        .map(ai => ({
          id: ai.id,
          type: 'action_item' as const,
          name: ai.description,
          projectName: ai.projectName || '',
          completedDate: ai.completedAt ? String(ai.completedAt).slice(0, 10) : '',
        })),
    ];

    const activeActionItems = actionItems.filter(ai => ai.status !== 'completed' && ai.status !== 'cancelled');
    const activeRaidActions = raidActions.filter(r => r.type === 'action');
    const totalDecisions = timesheetApprovals.length + resourceRequests.length + changeRequests.length + proposals.length;

    return {
      attention: {
        overdueCount: overdueTasks.length,
        oldestOverdueDays,
        blockedCount: blockedTasks.length,
        criticalRisks: criticalRisks.map(r => ({
          id: r.id,
          title: r.title,
          projectId: r.projectId,
          projectName: r.projectName,
          severity: r.severity,
          type: r.type,
        })),
      },
      decisions: {
        timesheetApprovals: timesheetApprovals.map((s: any) => ({
          id: s.id,
          userName: s.userName || 'Unknown',
          projectName: s.projectName || '',
          weekStart: s.weekStart,
          totalHours: s.totalHours || 0,
          submittedAt: s.submittedAt || s.createdAt || '',
        })),
        resourceRequests: resourceRequests.map((r: any) => ({
          id: r.id,
          projectName: r.projectName || '',
          resourceRole: r.resourceRole || '',
          priority: r.priority || 'medium',
          requestedByName: r.requestedByName || '',
          createdAt: r.createdAt || '',
        })),
        changeRequests: changeRequests.map((cr: any) => ({
          id: cr.id,
          title: cr.title || '',
          projectName: cr.projectName || '',
          priority: cr.priority || 'medium',
          category: cr.category || '',
          createdAt: cr.createdAt || '',
        })),
        proposals: proposals.map((p: any) => ({
          id: p.id,
          title: p.title || '',
          projectName: p.projectName || '',
          agentName: p.agentId || '',
          createdAt: p.createdAt || '',
        })),
      },
      commitments,
      weekAhead,
      recentlyCompleted,
      counts: {
        tasks: activeTasks.length,
        actionItems: activeActionItems.length,
        raidActions: activeRaidActions.length,
        decisions: totalDecisions,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Private query helpers
  // -------------------------------------------------------------------------

  private async resolveUserResources(userId: string, user: { email: string; full_name: string }) {
    let resources = await resourceRepository.findByUserId(userId);

    if (resources.length === 0 && user.email) {
      const [matched] = await databaseService.query<any>(
        'SELECT * FROM resources WHERE LOWER(email) = LOWER(?) LIMIT 1',
        [user.email],
      );
      if (matched) {
        databaseService.query('UPDATE resources SET user_id = ? WHERE id = ? AND user_id IS NULL', [userId, matched.id]).catch(() => {});
        resources = [{ ...matched, id: matched.id, userId }];
      }
    }

    const resourceIds = resources.map(r => r.id);
    const resourceNames = resources.map(r => r.name).filter(Boolean);
    const nameMatches = [...new Set([...resourceNames, ...(user.full_name ? [user.full_name.trim()] : [])])];

    return { resourceIds, nameMatches };
  }

  private async queryUserTasks(resourceIds: any[], nameMatches: string[]): Promise<MyWorkTask[]> {
    if (resourceIds.length === 0 && nameMatches.length === 0) return [];

    const conditions: string[] = [];
    const params: any[] = [];

    if (resourceIds.length > 0) {
      const ph = resourceIds.map(() => '?').join(',');
      conditions.push(`ta.resource_id IN (${ph})`);
      params.push(...resourceIds);
      conditions.push(`t.assigned_to IN (${ph})`);
      params.push(...resourceIds);
    }
    if (nameMatches.length > 0) {
      const nameClauses = nameMatches.map(() => 't.assigned_to LIKE ?');
      conditions.push(`(${nameClauses.join(' OR ')})`);
      params.push(...nameMatches.map(n => `%${n}%`));
    }

    const rows = await databaseService.query<any>(
      `SELECT DISTINCT t.id, t.name, t.status, t.priority,
              t.start_date AS startDate, t.end_date AS endDate,
              t.progress_percentage AS percentComplete,
              p.id AS projectId, p.name AS projectName,
              t.schedule_id AS scheduleId
       FROM tasks t
       JOIN schedules s ON t.schedule_id = s.id
       JOIN projects p ON s.project_id = p.id
       LEFT JOIN task_assignments ta ON ta.task_id = t.id
       WHERE (${conditions.join(' OR ')})
       ORDER BY t.end_date ASC, t.priority DESC`,
      params,
    );

    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      status: r.status || 'not-started',
      priority: r.priority || 'medium',
      startDate: r.startDate ? String(r.startDate).slice(0, 10) : null,
      endDate: r.endDate ? String(r.endDate).slice(0, 10) : null,
      percentComplete: Number(r.percentComplete) || 0,
      projectId: r.projectId,
      projectName: r.projectName,
      scheduleId: r.scheduleId,
    }));
  }

  private async queryRaidActions(userId: string): Promise<Array<{
    id: string; title: string; projectId: string; projectName: string;
    type: string; severity: string; status: string; dueDate: string | null;
  }>> {
    const rows = await databaseService.query<any>(
      `SELECT pr.id, pr.title, pr.project_id AS projectId, p.name AS projectName,
              pr.type, pr.severity, pr.status, pr.due_date AS dueDate
       FROM project_risks pr
       JOIN projects p ON pr.project_id = p.id
       WHERE pr.owner_id = ?
         AND pr.status NOT IN ('closed','resolved','cancelled')
       ORDER BY pr.due_date ASC`,
      [userId],
    );
    return rows.map((r: any) => ({
      id: r.id,
      title: r.title,
      projectId: r.projectId,
      projectName: r.projectName,
      type: r.type,
      severity: r.severity,
      status: r.status,
      dueDate: r.dueDate ? String(r.dueDate).slice(0, 10) : null,
    }));
  }

  private async queryResourceRequests(managerProjectIds: string[]): Promise<any[]> {
    if (managerProjectIds.length === 0) return [];
    const ph = managerProjectIds.map(() => '?').join(',');
    const rows = await databaseService.query<any>(
      `SELECT rr.id, rr.resource_role AS resourceRole, rr.priority,
              rr.requested_by AS requestedBy, rr.created_at AS createdAt,
              p.name AS projectName
       FROM resource_requests rr
       JOIN projects p ON rr.project_id = p.id
       WHERE rr.status = 'pending' AND rr.project_id IN (${ph})
       ORDER BY rr.created_at ASC`,
      managerProjectIds,
    );

    // Look up requester names from control plane
    const requesterIds = [...new Set(rows.map((r: any) => r.requestedBy).filter(Boolean))];
    const nameMap = new Map<string, string>();
    if (requesterIds.length > 0) {
      const uph = requesterIds.map(() => '?').join(',');
      const users = await databaseService.queryControlPlane<any>(
        `SELECT id, full_name FROM users WHERE id IN (${uph})`,
        requesterIds,
      );
      for (const u of users) nameMap.set(u.id, u.full_name || 'Unknown');
    }

    return rows.map((r: any) => ({ ...r, requestedByName: nameMap.get(r.requestedBy) || 'Unknown' }));
  }

  private async queryChangeRequests(managerProjectIds: string[]): Promise<any[]> {
    if (managerProjectIds.length === 0) return [];
    const ph = managerProjectIds.map(() => '?').join(',');
    const rows = await databaseService.query<any>(
      `SELECT cr.id, cr.title, cr.priority, cr.category, cr.created_at AS createdAt,
              p.name AS projectName
       FROM change_requests cr
       JOIN projects p ON cr.project_id = p.id
       WHERE cr.status IN ('pending','in_review') AND cr.project_id IN (${ph})
       ORDER BY cr.created_at ASC`,
      managerProjectIds,
    );
    return rows;
  }

  private async queryProposals(projectIds: string[]): Promise<any[]> {
    if (projectIds.length === 0) return [];
    const ph = projectIds.map(() => '?').join(',');
    const rows = await databaseService.query<any>(
      `SELECT ap.id, ap.title, ap.agent_id AS agentId, ap.created_at AS createdAt,
              ap.project_id AS projectId, p.name AS projectName
       FROM action_proposals ap
       JOIN projects p ON ap.project_id = p.id
       WHERE ap.status = 'pending' AND ap.project_id IN (${ph})
       ORDER BY ap.created_at ASC`,
      projectIds,
    );
    return rows;
  }

  private async queryMilestones(projectIds: string[], startDate: string, endDate: string): Promise<Array<{
    id: number; name: string; projectName: string; endDate: string;
  }>> {
    if (projectIds.length === 0) return [];
    const ph = projectIds.map(() => '?').join(',');
    const rows = await databaseService.query<any>(
      `SELECT t.id, t.name, t.end_date AS endDate, p.name AS projectName
       FROM tasks t
       JOIN schedules s ON t.schedule_id = s.id
       JOIN projects p ON s.project_id = p.id
       WHERE t.is_milestone = 1
         AND t.end_date BETWEEN ? AND ?
         AND s.project_id IN (${ph})
       ORDER BY t.end_date ASC`,
      [startDate, endDate, ...projectIds],
    );
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      projectName: r.projectName,
      endDate: r.endDate ? String(r.endDate).slice(0, 10) : '',
    }));
  }

  private async queryRecentlyCompleted(resourceIds: any[], nameMatches: string[], userId: string): Promise<MyWorkTask[]> {
    if (resourceIds.length === 0 && nameMatches.length === 0) return [];

    const conditions: string[] = [];
    const params: any[] = [];

    if (resourceIds.length > 0) {
      const ph = resourceIds.map(() => '?').join(',');
      conditions.push(`ta.resource_id IN (${ph})`);
      params.push(...resourceIds);
      conditions.push(`t.assigned_to IN (${ph})`);
      params.push(...resourceIds);
    }
    if (nameMatches.length > 0) {
      const nameClauses = nameMatches.map(() => 't.assigned_to LIKE ?');
      conditions.push(`(${nameClauses.join(' OR ')})`);
      params.push(...nameMatches.map(n => `%${n}%`));
    }

    const rows = await databaseService.query<any>(
      `SELECT DISTINCT t.id, t.name, t.status, t.priority,
              t.start_date AS startDate, t.end_date AS endDate,
              t.progress_percentage AS percentComplete,
              p.id AS projectId, p.name AS projectName,
              t.schedule_id AS scheduleId
       FROM tasks t
       JOIN schedules s ON t.schedule_id = s.id
       JOIN projects p ON s.project_id = p.id
       LEFT JOIN task_assignments ta ON ta.task_id = t.id
       WHERE (${conditions.join(' OR ')})
         AND t.status IN ('completed','done')
         AND (t.end_date IS NULL OR t.end_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY))
       ORDER BY t.end_date DESC
       LIMIT 20`,
      params,
    );

    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      status: r.status || 'completed',
      priority: r.priority || 'medium',
      startDate: r.startDate ? String(r.startDate).slice(0, 10) : null,
      endDate: r.endDate ? String(r.endDate).slice(0, 10) : null,
      percentComplete: Number(r.percentComplete) || 0,
      projectId: r.projectId,
      projectName: r.projectName,
      scheduleId: r.scheduleId,
    }));
  }

  private emptyResponse(): MyWorkResponse {
    return {
      attention: { overdueCount: 0, oldestOverdueDays: 0, blockedCount: 0, criticalRisks: [] },
      decisions: { timesheetApprovals: [], resourceRequests: [], changeRequests: [], proposals: [] },
      commitments: [],
      weekAhead: [],
      recentlyCompleted: [],
      counts: { tasks: 0, actionItems: 0, raidActions: 0, decisions: 0 },
    };
  }
}

export const myWorkService = new MyWorkService();
