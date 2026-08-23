// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskDependencyRef {
  dependencyId: string;
  dependencyType: string;
  lagDays: number;
}

export interface GanttTask {
  id: string;
  name: string;
  description?: string;
  status: string;
  priority?: string;
  startDate?: string;
  endDate?: string;
  progressPercentage?: number;
  /** @deprecated Use dependencies[] */
  dependency?: string;
  /** @deprecated Use dependencies[] */
  dependencyType?: string;
  /** @deprecated Use dependencies[] */
  dependencyLagDays?: number;
  taskType?: string;
  epicId?: string;
  acceptanceCriteria?: string;
  parentTaskId?: string;
  assignedTo?: string;
  estimatedDays?: number;
  estimatedDurationHours?: number;
  recurrenceRule?: string;
  recurrenceParentId?: string;
  isRecurrenceTemplate?: boolean;
  isMilestone?: boolean;
  sortOrder?: number;
  dependencies?: TaskDependencyRef[];
  budgetAllocated?: number;
  actualCost?: number;
  isSummary?: boolean;
  constraintType?: string;
  constraintDate?: string;
  workHours?: number;
  effortDriven?: boolean;
  assignments?: Array<{ id: string; resourceId: string; allocationPct: number; roleOnTask?: string; hoursPlanned?: number }>;
}

export interface FlatRow {
  task: GanttTask;
  level: number;
  wbs: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const DAY_MS = 86_400_000;

export function toDate(s?: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / DAY_MS));
}

export function formatShortDate(d: Date, referenceYear?: number): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (referenceYear != null && d.getFullYear() !== referenceYear) {
    opts.year = '2-digit';
  }
  return d.toLocaleDateString(undefined, opts);
}

/** Build a flat, sorted list of tasks with WBS numbers & hierarchy levels.
 *  Collapsed parents have their children omitted from the result. */
export function buildFlatRows(tasks: GanttTask[], collapsedIds?: Set<string>): FlatRow[] {
  const rows: FlatRow[] = [];
  const taskIds = new Set(tasks.map((t) => t.id));

  // Pre-build childrenOf map to avoid O(n) filter per parent
  const childrenOf = new Map<string | null, GanttTask[]>();
  for (const t of tasks) {
    const parent = (t.parentTaskId && taskIds.has(t.parentTaskId)) ? t.parentTaskId : null;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent)!.push(t);
  }

  const sortTasks = (list: GanttTask[]) => list.sort((a, b) => {
    const sa = a.sortOrder ?? 0;
    const sb = b.sortOrder ?? 0;
    if (sa !== sb) return sa - sb;
    const da = toDate(a.startDate)?.getTime() ?? 0;
    const db = toDate(b.startDate)?.getTime() ?? 0;
    return da - db;
  });

  const topLevel = sortTasks(childrenOf.get(null) || []);

  function addChildren(parentId: string, level: number, parentWbs: string) {
    if (collapsedIds?.has(parentId)) return;
    const children = sortTasks(childrenOf.get(parentId) || []);
    children.forEach((child, idx) => {
      const wbs = `${parentWbs}.${idx + 1}`;
      rows.push({ task: child, level, wbs });
      addChildren(child.id, level + 1, wbs);
    });
  }

  topLevel.forEach((task, idx) => {
    const wbs = `${idx + 1}`;
    rows.push({ task, level: 0, wbs });
    addChildren(task.id, 1, wbs);
  });

  return rows;
}

// ---------------------------------------------------------------------------
// Status / priority colors
// ---------------------------------------------------------------------------

export const barColors: Record<string, { bg: string; fill: string; text: string }> = {
  completed: { bg: '#dcfce7', fill: '#22c55e', text: '#166534' },
  done: { bg: '#dcfce7', fill: '#22c55e', text: '#166534' },
  in_progress: { bg: '#dbeafe', fill: '#3b82f6', text: '#1e40af' },
  in_review: { bg: '#f3e8ff', fill: '#a855f7', text: '#6b21a8' },
  testing: { bg: '#fef3c7', fill: '#f59e0b', text: '#92400e' },
  pending: { bg: '#f3f4f6', fill: '#9ca3af', text: '#374151' },
  not_started: { bg: '#f3f4f6', fill: '#9ca3af', text: '#374151' },
  blocked: { bg: '#fee2e2', fill: '#ef4444', text: '#991b1b' },
  cancelled: { bg: '#fce4ec', fill: '#78909c', text: '#37474f' },
};

export const AVATAR_PALETTE = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

export function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

export function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export const statusLabels: Record<string, string> = {
  completed: 'Complete',
  done: 'Complete',
  in_progress: 'In Progress',
  in_review: 'In Review',
  testing: 'Testing',
  pending: 'Not Started',
  not_started: 'Not Started',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
};

export const priorityDot: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-400',
  medium: 'bg-yellow-400',
  low: 'bg-green-400',
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ROW_H = 36;
export const HEADER_H = 52;
export const VIRTUALIZE_THRESHOLD = 100;
export const OVERSCAN = 15;
export const TABLE_DEFAULT_W = 720;
export const TABLE_MIN_W = 200;
export const TABLE_MAX_W = 1100;

// ---------------------------------------------------------------------------
// Gantt left-panel column definitions (for resizable columns)
// ---------------------------------------------------------------------------

export interface GanttColDef {
  key: string;
  label: string;
  defaultWidth: number;
  minWidth: number;
  resizable: boolean;
  /** Fixed columns cannot be resized and ignore width state */
  fixed?: boolean;
  /** If true, column cannot be hidden via column picker */
  alwaysVisible?: boolean;
}

export const GANTT_COLUMNS: GanttColDef[] = [
  { key: 'rowNum',    label: '#',        defaultWidth: 40,  minWidth: 30,  resizable: false, fixed: true, alwaysVisible: true },
  { key: 'name',      label: 'Task Name',defaultWidth: 250, minWidth: 120, resizable: true, alwaysVisible: true },
  { key: 'pred',      label: 'Pred',     defaultWidth: 56,  minWidth: 40,  resizable: true },
  { key: 'succ',      label: 'Succ',     defaultWidth: 56,  minWidth: 40,  resizable: true },
  { key: 'start',     label: 'Start',    defaultWidth: 80,  minWidth: 60,  resizable: true },
  { key: 'end',       label: 'End',      defaultWidth: 80,  minWidth: 60,  resizable: true },
  { key: 'dur',       label: 'Dur',      defaultWidth: 48,  minWidth: 36,  resizable: true },
  { key: 'est',       label: 'Est',      defaultWidth: 48,  minWidth: 36,  resizable: true },
  { key: 'work',      label: 'Work',     defaultWidth: 56,  minWidth: 40,  resizable: true },
  { key: 'pct',       label: '%',        defaultWidth: 48,  minWidth: 36,  resizable: true },
  { key: 'priority',  label: 'Priority', defaultWidth: 64,  minWidth: 50,  resizable: true },
  { key: 'assigned',  label: 'Assigned', defaultWidth: 96,  minWidth: 60,  resizable: true },
  { key: 'resource',  label: 'Resource', defaultWidth: 110, minWidth: 70,  resizable: true },
  { key: 'status',    label: 'Status',   defaultWidth: 64,  minWidth: 50,  resizable: true },
  { key: 'notes',     label: 'Notes',    defaultWidth: 120, minWidth: 60,  resizable: true },
  { key: 'editIcon',  label: '',         defaultWidth: 72,  minWidth: 72,  resizable: false, fixed: true, alwaysVisible: true },
];

/** Default visible columns -- show only essential columns so the name column isn't squeezed */
export const DEFAULT_VISIBLE_COLS = new Set(['pred', 'start', 'end', 'dur', 'pct', 'status']);

/** Default column order */
export const DEFAULT_COL_ORDER = GANTT_COLUMNS.map(c => c.key);

/** Auto-scroll edge zone width (px) and speed */
export const AUTO_SCROLL_EDGE = 60;
export const AUTO_SCROLL_SPEED = 12;

// ---------------------------------------------------------------------------
// Zoom / Timescale
// ---------------------------------------------------------------------------

export type ZoomLevel = 'day' | 'week' | 'month' | 'quarter' | 'year';
export type TierUnit = 'day' | 'week' | 'month' | 'quarter' | 'year';

export const ZOOM_CONFIGS: Record<ZoomLevel, { dayPx: number; lower: TierUnit; upper: TierUnit | null }> = {
  day:     { dayPx: 32,   lower: 'day',     upper: 'month' },
  week:    { dayPx: 10,   lower: 'week',    upper: 'month' },
  month:   { dayPx: 3.2,  lower: 'month',   upper: 'year' },
  quarter: { dayPx: 1.2,  lower: 'quarter', upper: 'year' },
  year:    { dayPx: 0.27, lower: 'year',    upper: null },
};

export const ZOOM_LEVELS: ZoomLevel[] = ['day', 'week', 'month', 'quarter', 'year'];
export const ZOOM_LABELS: Record<ZoomLevel, string> = { day: 'D', week: 'W', month: 'M', quarter: 'Q', year: 'Y' };

export interface TimescaleBand { label: string; left: number; width: number }
export interface Timescale { upper: TimescaleBand[]; lower: TimescaleBand[] }

export function daysBetweenRaw(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / DAY_MS;
}

export function snapToUnitStart(d: Date, unit: TierUnit): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  switch (unit) {
    case 'day':
      break;
    case 'week': {
      // ISO week: Monday
      const day = r.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      r.setDate(r.getDate() + diff);
      break;
    }
    case 'month':
      r.setDate(1);
      break;
    case 'quarter':
      r.setDate(1);
      r.setMonth(Math.floor(r.getMonth() / 3) * 3);
      break;
    case 'year':
      r.setMonth(0, 1);
      break;
  }
  return r;
}

export function advanceByUnit(d: Date, unit: TierUnit): Date {
  const r = new Date(d);
  switch (unit) {
    case 'day': r.setDate(r.getDate() + 1); break;
    case 'week': r.setDate(r.getDate() + 7); break;
    case 'month': r.setMonth(r.getMonth() + 1); break;
    case 'quarter': r.setMonth(r.getMonth() + 3); break;
    case 'year': r.setFullYear(r.getFullYear() + 1); break;
  }
  return r;
}

export function getISOWeek(d: Date): number {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil(((tmp.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
}

export function formatTierLabel(d: Date, unit: TierUnit): string {
  switch (unit) {
    case 'day': return String(d.getDate());
    case 'week': return `W${getISOWeek(d)}`;
    case 'month': return d.toLocaleDateString('en-US', { month: 'short' });
    case 'quarter': return `Q${Math.floor(d.getMonth() / 3) + 1}`;
    case 'year': return String(d.getFullYear());
  }
}

export function formatUpperLabel(d: Date, unit: TierUnit): string {
  switch (unit) {
    case 'month': return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    case 'year': return String(d.getFullYear());
    default: return formatTierLabel(d, unit);
  }
}

export function buildTier(unit: TierUnit, minDate: Date, maxDate: Date, dayPx: number, isUpper: boolean): TimescaleBand[] {
  const bands: TimescaleBand[] = [];
  let cursor = snapToUnitStart(new Date(minDate), unit);

  while (cursor <= maxDate) {
    const unitStart = new Date(Math.max(cursor.getTime(), minDate.getTime()));
    const nextUnit = advanceByUnit(new Date(cursor), unit);
    const unitEnd = new Date(Math.min(nextUnit.getTime(), maxDate.getTime()));

    const left = daysBetweenRaw(minDate, unitStart) * dayPx;
    const width = Math.max(daysBetweenRaw(unitStart, unitEnd) * dayPx, 1);

    bands.push({ label: isUpper ? formatUpperLabel(cursor, unit) : formatTierLabel(cursor, unit), left, width });
    cursor = nextUnit;
  }
  return bands;
}

export function buildTimescale(zoom: ZoomLevel, minDate: Date, maxDate: Date, dayPx: number): Timescale {
  const cfg = ZOOM_CONFIGS[zoom];
  const lower = buildTier(cfg.lower, minDate, maxDate, dayPx, false);
  const upper = cfg.upper ? buildTier(cfg.upper, minDate, maxDate, dayPx, true) : [];
  return { upper, lower };
}

// ---------------------------------------------------------------------------
// Inline editing types & constants
// ---------------------------------------------------------------------------

export type EditableField = 'name' | 'dependency' | 'startDate' | 'endDate' | 'duration' | 'estimatedDays' | 'estimatedDurationHours' | 'progressPercentage' | 'priority' | 'assignedTo' | 'status';
export const FIELD_ORDER: EditableField[] = ['name', 'dependency', 'startDate', 'endDate', 'duration', 'estimatedDays', 'estimatedDurationHours', 'progressPercentage', 'priority', 'assignedTo', 'status'];
export const statusOptions = ['pending', 'in_progress', 'in_review', 'testing', 'completed', 'blocked', 'cancelled'];
export const priorityOptions = ['low', 'medium', 'high', 'urgent'];

// ---------------------------------------------------------------------------
// Filter interface
// ---------------------------------------------------------------------------

export interface GanttFilters {
  statuses: Set<string>;
  priorities: Set<string>;
  assignee: string;
  startAfter: string;
  startBefore: string;
  progressMin: number | null;
  progressMax: number | null;
}

// ---------------------------------------------------------------------------
// Health color helper
// ---------------------------------------------------------------------------

export const healthColor = (health: 'satisfied' | 'in_progress' | 'at_risk') =>
  health === 'satisfied' ? '#22c55e' : health === 'in_progress' ? '#eab308' : '#ef4444';
