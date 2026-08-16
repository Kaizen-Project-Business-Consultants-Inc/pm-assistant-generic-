import { v4 as uuidv4 } from 'uuid';
import { timeEntryRepository, TimeEntry } from '../database/TimeEntryRepository';
import { timesheetSubmissionRepository, TimesheetSubmission } from '../database/TimesheetSubmissionRepository';
import { scheduleService } from './ScheduleService';
import { projectMemberService } from './ProjectMemberService';
import { notificationService } from './NotificationService';
import logger from '../utils/logger';

export type { TimeEntry } from '../database/TimeEntryRepository';
export type { TimesheetSubmission } from '../database/TimesheetSubmissionRepository';

export class TimeEntryService {

  async create(data: {
    taskId: string;
    scheduleId: string;
    projectId: string;
    userId: string;
    date: string;
    hours: number;
    description?: string;
    billable?: boolean;
  }): Promise<TimeEntry> {
    const id = uuidv4();
    return timeEntryRepository.insert(
      id, data.taskId, data.scheduleId, data.projectId, data.userId,
      data.date, data.hours, data.description || null, data.billable !== false,
    );
  }

  async update(id: string, data: { date?: string; hours?: number; description?: string; billable?: boolean }): Promise<TimeEntry> {
    const entry = await timeEntryRepository.findById(id);
    if (entry && (entry.status === 'submitted' || entry.status === 'approved')) {
      throw Object.assign(new Error('Cannot edit a time entry that has been submitted or approved'), { statusCode: 409 });
    }
    const sets: string[] = [];
    const params: any[] = [];
    if (data.date !== undefined) { sets.push('date = ?'); params.push(data.date); }
    if (data.hours !== undefined) { sets.push('hours = ?'); params.push(data.hours); }
    if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description); }
    if (data.billable !== undefined) { sets.push('billable = ?'); params.push(data.billable); }
    await timeEntryRepository.updateFields(id, sets, params);
    return (await timeEntryRepository.findById(id))!;
  }

  async delete(id: string): Promise<void> {
    const entry = await timeEntryRepository.findById(id);
    if (entry && (entry.status === 'submitted' || entry.status === 'approved')) {
      throw Object.assign(new Error('Cannot delete a time entry that has been submitted or approved'), { statusCode: 409 });
    }
    await timeEntryRepository.deleteById(id);
  }

  async getByTask(taskId: string): Promise<TimeEntry[]> {
    return timeEntryRepository.findByTask(taskId);
  }

  async getByProject(projectId: string, startDate?: string, endDate?: string): Promise<TimeEntry[]> {
    return timeEntryRepository.findByProject(projectId, startDate, endDate);
  }

  async getWeeklyTimesheet(userId: string, weekStart: string): Promise<{
    entries: TimeEntry[];
    days: string[];
    totalHours: number;
  }> {
    const start = new Date(weekStart);
    const days: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      days.push(d.toISOString().slice(0, 10));
    }
    const endDate = days[6];

    const entries = await timeEntryRepository.findByUserAndDateRange(userId, weekStart, endDate);
    const totalHours = entries.reduce((sum, e) => sum + e.hours, 0);
    return { entries, days, totalHours };
  }

  async getActualVsEstimated(scheduleId: string): Promise<{
    tasks: Array<{
      taskId: string;
      taskName: string;
      estimatedHours: number;
      actualHours: number;
    }>;
  }> {
    const tasks = await scheduleService.findTasksByScheduleId(scheduleId);
    const rows = await timeEntryRepository.sumHoursBySchedule(scheduleId);
    const actualMap = new Map(rows.map(r => [r.task_id, Number(r.total)]));

    return {
      tasks: tasks.map(t => ({
        taskId: t.id,
        taskName: t.name,
        estimatedHours: (t.estimatedDays || 0) * 8,
        actualHours: actualMap.get(t.id) || 0,
      })),
    };
  }
  // ---------------------------------------------------------------------------
  // Timesheet approval workflow
  // ---------------------------------------------------------------------------

  private getWeekEnd(weekStart: string): string {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 6);
    return d.toISOString().slice(0, 10);
  }

  async submitTimesheet(userId: string, projectId: string, weekStart: string): Promise<TimesheetSubmission> {
    const weekEnd = this.getWeekEnd(weekStart);
    const entries = await timeEntryRepository.findByUserProjectWeek(userId, projectId, weekStart, weekEnd);
    const submittableEntries = entries.filter(e => e.status === 'draft' || e.status === 'rejected');
    if (submittableEntries.length === 0) {
      throw Object.assign(new Error('No draft or rejected entries to submit for this week'), { statusCode: 400 });
    }

    const totalHours = submittableEntries.reduce((sum, e) => sum + e.hours, 0);
    const ids = submittableEntries.map(e => e.id);
    await timeEntryRepository.updateStatusBatch(ids, 'submitted');

    const submission = await timesheetSubmissionRepository.insert(uuidv4(), userId, projectId, weekStart, totalHours);

    // Notify project managers
    this.notifyProjectManagers(projectId, userId, weekStart, totalHours).catch(err =>
      logger.error('[TimeEntryService] Failed to notify managers on submit', { err }),
    );

    return submission;
  }

  async recallTimesheet(submissionId: string, userId: string): Promise<void> {
    const sub = await timesheetSubmissionRepository.findById(submissionId);
    if (!sub) throw Object.assign(new Error('Submission not found'), { statusCode: 404 });
    if (sub.userId !== userId) throw Object.assign(new Error('Not your submission'), { statusCode: 403 });
    if (sub.status !== 'submitted') throw Object.assign(new Error('Can only recall submitted timesheets'), { statusCode: 409 });

    const weekEnd = this.getWeekEnd(sub.weekStart);
    const entries = await timeEntryRepository.findByUserProjectWeek(userId, sub.projectId, sub.weekStart, weekEnd);
    const submittedIds = entries.filter(e => e.status === 'submitted').map(e => e.id);
    if (submittedIds.length > 0) {
      await timeEntryRepository.updateStatusBatch(submittedIds, 'draft');
    }
    await timesheetSubmissionRepository.deleteById(submissionId);
  }

  async approveTimesheet(submissionId: string, reviewerId: string): Promise<void> {
    const sub = await timesheetSubmissionRepository.findById(submissionId);
    if (!sub) throw Object.assign(new Error('Submission not found'), { statusCode: 404 });
    if (sub.status !== 'submitted') throw Object.assign(new Error('Submission is not pending approval'), { statusCode: 409 });

    const canApprove = await projectMemberService.hasRole(sub.projectId, reviewerId, 'manager');
    if (!canApprove) throw Object.assign(new Error('Only project managers can approve timesheets'), { statusCode: 403 });

    const weekEnd = this.getWeekEnd(sub.weekStart);
    const entries = await timeEntryRepository.findByUserProjectWeek(sub.userId, sub.projectId, sub.weekStart, weekEnd);
    const submittedIds = entries.filter(e => e.status === 'submitted').map(e => e.id);
    if (submittedIds.length > 0) {
      await timeEntryRepository.updateStatusBatch(submittedIds, 'approved', reviewerId);
    }
    await timesheetSubmissionRepository.updateStatus(submissionId, 'approved', reviewerId);

    // Notify user
    notificationService.create({
      userId: sub.userId,
      type: 'timesheet_approved',
      severity: 'low',
      title: 'Timesheet Approved',
      message: `Your timesheet for week of ${sub.weekStart} has been approved.`,
      projectId: sub.projectId,
    }).catch(err => logger.error('[TimeEntryService] Failed to send approval notification', { err }));
  }

  async rejectTimesheet(submissionId: string, reviewerId: string, reason: string): Promise<void> {
    const sub = await timesheetSubmissionRepository.findById(submissionId);
    if (!sub) throw Object.assign(new Error('Submission not found'), { statusCode: 404 });
    if (sub.status !== 'submitted') throw Object.assign(new Error('Submission is not pending approval'), { statusCode: 409 });

    const canReject = await projectMemberService.hasRole(sub.projectId, reviewerId, 'manager');
    if (!canReject) throw Object.assign(new Error('Only project managers can reject timesheets'), { statusCode: 403 });

    const weekEnd = this.getWeekEnd(sub.weekStart);
    const entries = await timeEntryRepository.findByUserProjectWeek(sub.userId, sub.projectId, sub.weekStart, weekEnd);
    const submittedIds = entries.filter(e => e.status === 'submitted').map(e => e.id);
    if (submittedIds.length > 0) {
      await timeEntryRepository.updateStatusBatch(submittedIds, 'rejected');
    }
    await timesheetSubmissionRepository.updateStatus(submissionId, 'rejected', reviewerId, reason);

    // Notify user
    notificationService.create({
      userId: sub.userId,
      type: 'timesheet_rejected',
      severity: 'high',
      title: 'Timesheet Rejected',
      message: `Your timesheet for week of ${sub.weekStart} was rejected: ${reason}`,
      projectId: sub.projectId,
    }).catch(err => logger.error('[TimeEntryService] Failed to send rejection notification', { err }));
  }

  async getPendingApprovals(userId: string): Promise<(TimesheetSubmission & { userName?: string; projectName?: string })[]> {
    // Find projects where this user is manager or owner
    const memberships = await projectMemberService.findByUserId(userId);
    const managerProjectIds = memberships
      .filter(m => m.role === 'owner' || m.role === 'manager')
      .map(m => m.projectId);

    if (managerProjectIds.length === 0) return [];
    return timesheetSubmissionRepository.findPendingByProjects(managerProjectIds);
  }

  async getSubmissions(userId: string, startDate?: string, endDate?: string): Promise<TimesheetSubmission[]> {
    return timesheetSubmissionRepository.findByUser(userId, startDate, endDate);
  }

  async getWeeklyTimesheetStatus(userId: string, weekStart: string): Promise<{
    entries: TimeEntry[];
    days: string[];
    totalHours: number;
    submissions: TimesheetSubmission[];
  }> {
    const result = await this.getWeeklyTimesheet(userId, weekStart);
    // Get all project IDs from entries
    const projectIds = [...new Set(result.entries.map(e => e.projectId))];
    const submissions: TimesheetSubmission[] = [];
    for (const pid of projectIds) {
      const sub = await timesheetSubmissionRepository.findByUserProjectWeek(userId, pid, weekStart);
      if (sub) submissions.push(sub);
    }
    return { ...result, submissions };
  }

  private async notifyProjectManagers(projectId: string, userId: string, weekStart: string, totalHours: number): Promise<void> {
    const members = await projectMemberService.findByProjectId(projectId);
    const managers = members.filter(m => m.role === 'owner' || m.role === 'manager');
    for (const mgr of managers) {
      if (mgr.userId === userId) continue; // Don't notify self
      await notificationService.create({
        userId: mgr.userId,
        type: 'timesheet_submitted',
        severity: 'medium',
        title: 'Timesheet Submitted for Approval',
        message: `A timesheet for week of ${weekStart} (${totalHours}h) has been submitted for your review.`,
        projectId,
      });
    }
  }
}

export const timeEntryService = new TimeEntryService();
