/** Team Planner — the shapes /resources/planner sends (server: services/TeamPlannerService.ts) */

export interface PlannerBlock {
  key: string;
  taskId: string;
  resourceId: string | null;
  scheduleId: string;
  /** null when you can't open that project: shown as hours only */
  projectId: string | null;
  projectName: string | null;
  taskName: string | null;
  startDate: string;
  endDate: string;
  hoursPerWeek: number | null;
  /** on a project you manage: can be moved */
  editable: boolean;
  /** started: can change hands, its dates stay */
  started: boolean;
}

export interface PlannerPerson {
  id: string;
  name: string;
  role: string | null;
  isGeneric: boolean;
  capacity: number[];
  load: number[];
  blocks: PlannerBlock[];
}

export interface PlannerBoard {
  weeks: string[];
  projects: Array<{ id: string; name: string }>;
  people: PlannerPerson[];
  unassigned: PlannerBlock[];
}

export interface PlannerMoveInput {
  taskId: string;
  fromResourceId: string | null;
  toResourceId: string | null;
  weeks: number;
}

export interface PlannerPreview {
  taskName: string;
  projectName: string;
  fromName: string | null;
  toName: string | null;
  reassign: boolean;
  dates: { startBefore: string; endBefore: string; startAfter: string; endAfter: string } | null;
  heldByPredecessor: boolean;
  linkedMoved: Array<{ taskId: string; name: string; startBefore: string | null; startAfter: string }>;
  projectEndBefore: string | null;
  projectEndAfter: string | null;
  projectEndShift: number;
  others: string[];
  load: Array<{ resourceId: string; name: string; weeks: Array<{ weekStart: string; before: number; after: number; capacity: number }> }>;
  overloads: Array<{ name: string; weekStart: string; hours: number; capacity: number }>;
  cost: { before: number; after: number } | null;
  loggedStays: boolean;
}
