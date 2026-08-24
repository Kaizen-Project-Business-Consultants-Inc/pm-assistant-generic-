import type { GanttTask } from '../GanttChart';
import type { ColumnKey, ColumnDef } from '../tableColumns';
import type { ColumnState } from '../../../hooks/useColumnState';

export type SortDir = 'asc' | 'desc';
export type GroupByField = '' | 'status' | 'priority' | 'assignedTo';
export type EditableField = 'name' | 'status' | 'priority' | 'startDate' | 'endDate' | 'progressPercentage' | 'assignedTo' | 'dependency' | 'duration' | 'budgetAllocated' | 'actualCost' | 'constraintType' | 'constraintDate' | 'notes';

export interface CpmTaskData {
  taskId: string;
  ES: number;
  EF: number;
  LS: number;
  LF: number;
  totalFloat: number;
  freeFloat: number;
  isCritical: boolean;
}

export interface BaselineTaskVariance {
  taskId: string;
  baselineStart?: string;
  baselineEnd?: string;
  startVarianceDays?: number;
  endVarianceDays?: number;
}

export interface TableViewProps {
  tasks: GanttTask[];
  scheduleId: string;
  onTaskClick: (task: GanttTask) => void;
  onTaskSelect?: (task: GanttTask) => void;
  activeTaskId?: string | null;
  onTaskUpdate: (taskId: string, data: Record<string, unknown>) => void;
  onTaskReorder?: (updates: Array<{ taskId: string; sortOrder: number; parentTaskId?: string | null }>) => void;
  onQuickAdd?: (name: string) => void;
  columnState: ColumnState;
  cpmData?: { tasks: CpmTaskData[]; criticalPathTaskIds: string[] };
  baselineData?: { taskVariances: BaselineTaskVariance[] };
  scheduleStartDate?: string;
  onBulkUpdate?: (taskIds: string[], field: string, value: string) => Promise<void>;
  onBulkDelete?: (taskIds: string[]) => Promise<void>;
  onDeleteTask?: (taskId: string) => void;
  onInsertAfter?: (afterTaskId: string, parentTaskId?: string) => void;
  onInsertBefore?: (beforeTaskId: string, parentTaskId?: string) => void;
  onInlineInsert?: (name: string, afterTaskId: string, parentTaskId?: string) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  undoDescription?: string;
  redoDescription?: string;
  onUndo?: () => void;
  onRedo?: () => void;
  onDuplicateTasks?: (tasks: GanttTask[]) => void;
}

export const barColors: Record<string, { bg: string; text: string }> = {
  completed: { bg: 'bg-green-100 dark:bg-green-900/20', text: 'text-green-700 dark:text-green-400' },
  in_progress: { bg: 'bg-blue-100 dark:bg-blue-900/20', text: 'text-blue-700 dark:text-blue-400' },
  pending: { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-600 dark:text-gray-300' },
  cancelled: { bg: 'bg-red-100 dark:bg-red-900/20', text: 'text-red-600 dark:text-red-400' },
};

export const priorityColors: Record<string, string> = {
  urgent: 'bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400',
  high: 'bg-orange-100 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400',
  medium: 'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400',
  low: 'bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400',
};

export const statusOptions = ['pending', 'in_progress', 'completed'];
export const priorityOptions = ['low', 'medium', 'high', 'urgent'];

export const SUMMARY_ROLLUP_FIELDS: Set<EditableField> = new Set(['startDate', 'endDate', 'progressPercentage', 'status', 'budgetAllocated', 'actualCost', 'duration']);

export function addDaysToDate(baseDate: string, days: number): string {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDate(d?: string): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export type { GanttTask, ColumnKey, ColumnDef, ColumnState };
