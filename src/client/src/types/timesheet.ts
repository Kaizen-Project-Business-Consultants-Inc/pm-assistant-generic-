/** Weekly timesheets (mirrors src/server/services/WeeklyTimesheetService.ts) */

export type SheetStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export interface TimesheetLine {
  projectId: string;
  projectName: string;
  scheduleId: string;
  taskId: string;
  taskName: string;
  /** Planned for the person this week (their share of the task, this week's working days) */
  plannedThisWeek: number;
  /** date → their entry that day */
  days: Record<string, { entryId: string; hours: number; status: string }>;
  workedThisWeek: number;
  taskPlanned: number;
  taskApproved: number;
  remaining: number;
  overPlanBy: number;
  percent: number;
  taskDone: boolean;
}

export interface WeekView {
  weekStart: string;
  days: string[];
  status: SheetStatus;
  sheet: { id: string; status: SheetStatus; submittedAt: string | null; reviewedAt: string | null; rejectionReason: string | null } | null;
  approver: { userId: string; name: string } | null;
  lines: TimesheetLine[];
  totals: { planned: number; worked: number };
  flags: Array<{ id: string; taskId: string; projectId: string; note: string; flaggedByName: string; createdAt: string }>;
}

export interface PendingTimesheet {
  id: string;
  userId: string;
  userName: string;
  weekStart: string;
  totalHours: number;
  projectCount: number;
  flagCount: number;
  submittedAt: string;
}

export interface ProjectPending {
  sheetId: string | null;
  userId: string;
  userName: string;
  weekStart: string;
  lines: Array<{ taskId: string; taskName: string; hours: number; plannedThisWeek: number }>;
}
