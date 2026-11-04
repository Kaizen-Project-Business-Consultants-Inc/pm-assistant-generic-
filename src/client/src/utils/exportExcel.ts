import { COLUMN_DEFS, COST_KEYS, type ColumnKey } from '../components/schedule/tableColumns';
import { barColors } from '../components/schedule/gantt/types';
import { STATUS_LABEL, effectiveTaskStatus } from './taskStatus';
import { safeFileName } from './exportUtils';
import { todayYmd } from './rateCard';

/**
 * Export tasks to an Excel (.xlsx) file. ExcelJS is loaded only when a person clicks the button
 * (dynamic import), so it is a separate chunk and the main bundle does not grow.
 *
 * What the file holds (approved mock, 2026-11-03): a header row on a dark teal band, frozen, with the
 * auto-filter on; phases (summary tasks) bold on a light fill; tasks indented by outline level with the
 * cell's own indent (not spaces); dates as real Excel dates; durations, percentages and money as numbers;
 * Status cells in the app's status colours. Money columns are left out unless the person may see pay rates.
 */

/** The task fields the sheet reads itself (name, status, outline); every other cell comes from `value` */
interface ExportTask {
  id: string;
  name?: string;
  status?: string;
  endDate?: string;
  parentTaskId?: string;
  isSummary?: boolean;
  isMilestone?: boolean;
}

/** One cell's raw content. A date column takes a YYYY-MM-DD string; a percent column takes 0-100. */
export type CellRaw = string | number | null | undefined;

interface ExportColumn {
  key: ColumnKey;
  label: string;
}

interface TasksSheetInput<T extends ExportTask> {
  tasks: readonly T[];
  columns: readonly ExportColumn[];
  /** Raw content of every column except Task Name and Status */
  value: (task: T, key: ColumnKey) => CellRaw;
  /** Outline level (0 = top); defaults to the depth through parentTaskId within `tasks` */
  levelOf?: (task: T) => number;
  /** Whether the person may see pay rates (canSeePayRates); money columns are dropped without it */
  canSeePay: boolean;
  sheetName?: string;
}

type Kind = 'text' | 'date' | 'days' | 'varDays' | 'hours' | 'count' | 'percent' | 'money' | 'varMoney';

const KIND: Partial<Record<ColumnKey, Kind>> = {
  rowNum: 'count',
  startDate: 'date', endDate: 'date', actualStartDate: 'date', actualEndDate: 'date', constraintDate: 'date',
  earlyStart: 'date', earlyFinish: 'date', lateStart: 'date', lateFinish: 'date',
  baselineStart: 'date', baselineEnd: 'date',
  duration: 'days', estimatedDays: 'days', totalFloat: 'days', freeFloat: 'days', baselineDuration: 'days',
  startVariance: 'varDays', endVariance: 'varDays',
  estimatedDurationHours: 'hours',
  progressPercentage: 'percent',
  budgetAllocated: 'money', actualCost: 'money', baselineCost: 'money',
  budgetVariance: 'varMoney',
};

const NUM_FMT: Record<Kind, string | undefined> = {
  text: undefined,
  date: 'dd-mmm-yyyy',
  days: '0.##"d"',
  varDays: '+0.##"d";-0.##"d";0"d"',
  hours: '0.##"h"',
  count: '0',
  percent: '0%',
  money: '$#,##0',
  varMoney: '+$#,##0;-$#,##0;$0',
};

const WIDTH: Partial<Record<ColumnKey, number>> = { rowNum: 6, name: 46, notes: 40, dependency: 14, successor: 14, assignedTo: 22, resource: 24, status: 14 };
const TEAL_BAND = 'FF0F766E';
const PHASE_FILL = 'FFE6F4F1';
const MILESTONE_MARK = '◆ ';

/** Columns the person may see: money columns only with the right to see pay rates */
export function exportColumns(columns: readonly ExportColumn[], canSeePay: boolean): ExportColumn[] {
  return canSeePay ? [...columns] : columns.filter(c => !COST_KEYS.has(c.key));
}

/** The columns the quick CSV has always held, in its order (labels from the table's column list) */
const BASIC_KEYS: readonly ColumnKey[] = ['name', 'status', 'priority', 'assignedTo', 'startDate', 'endDate', 'progressPercentage'];
const LABEL = new Map(COLUMN_DEFS.map(c => [c.key, c.label] as const));
export const BASIC_COLUMNS: readonly ExportColumn[] = BASIC_KEYS.map(key => ({ key, label: LABEL.get(key) ?? key }));

/** Outline depth through parentTaskId; a parent that is not in the list does not count */
export function levelsByParent(tasks: readonly ExportTask[]): Map<string, number> {
  const byId = new Map(tasks.map(t => [t.id, t] as const));
  const levels = new Map<string, number>();
  const levelOf = (t: ExportTask, guard = 0): number => {
    const known = levels.get(t.id);
    if (known != null) return known;
    const parent = t.parentTaskId ? byId.get(t.parentTaskId) : undefined;
    const level = parent && guard < 50 ? levelOf(parent, guard + 1) + 1 : 0;
    levels.set(t.id, level);
    return level;
  };
  for (const t of tasks) levelOf(t);
  return levels;
}

/** Cell content for the columns the quick (non-Table) exports hold: the CSV's seven */
export function basicValue(names?: ReadonlyMap<string, string>) {
  return (task: ExportTask & { priority?: string; assignedTo?: string; startDate?: string; progressPercentage?: number }, key: ColumnKey): CellRaw => {
    switch (key) {
      case 'priority': return task.priority || '';
      case 'assignedTo': return (task.assignedTo && names?.get(task.assignedTo)) || task.assignedTo || ''; // the name, not the stored id
      case 'startDate': return task.startDate;
      case 'endDate': return task.endDate;
      case 'progressPercentage': return task.progressPercentage ?? 0;
      default: return '';
    }
  };
}

/** A calendar day (YYYY-MM-DD…) as an Excel date. Built from its parts, never through a time zone. */
function calendarDay(raw: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return isNaN(d.getTime()) ? null : d;
}

function cellContent(kind: Kind, raw: CellRaw): string | number | Date | null {
  if (raw == null || raw === '') return null;
  if (kind === 'date') return typeof raw === 'string' ? calendarDay(raw) : null;
  if (kind === 'text') return String(raw);
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return kind === 'percent' ? n / 100 : n;
}

export async function buildTasksWorkbook<T extends ExportTask>(input: TasksSheetInput<T>) {
  const mod = await import('exceljs');
  const Workbook = (mod.default ?? mod).Workbook;
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet((input.sheetName || 'Tasks').replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Tasks');
  const columns = exportColumns(input.columns, input.canSeePay);
  const kinds = columns.map(c => KIND[c.key] ?? 'text');
  const levels = input.levelOf ? null : levelsByParent(input.tasks);
  const levelOf = input.levelOf ?? ((t: T) => levels!.get(t.id) ?? 0);

  sheet.columns = columns.map((c, i) => ({
    header: c.label,
    key: c.key,
    width: WIDTH[c.key] ?? (kinds[i] === 'date' ? 13 : Math.max(11, c.label.length + 3)),
  }));
  const header = sheet.getRow(1);
  header.height = 22;
  header.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL_BAND } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  if (columns.length > 0) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  for (const task of input.tasks) {
    const row = sheet.addRow([]);
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const kind = kinds[i];
      if (c.key === 'name') {
        cell.value = `${task.isMilestone ? MILESTONE_MARK : ''}${task.name || ''}`;
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: levelOf(task) };
      } else if (c.key === 'status') {
        const status = effectiveTaskStatus(task);
        const colors = barColors[status] || barColors.pending;
        cell.value = STATUS_LABEL[status] ?? String(task.status ?? '');
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(colors.bg) } };
        cell.font = { color: { argb: argb(colors.text) }, bold: !!task.isSummary };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else {
        cell.value = cellContent(kind, input.value(task, c.key));
        const fmt = NUM_FMT[kind];
        if (fmt) cell.numFmt = fmt;
        cell.alignment = { vertical: 'middle', horizontal: kind === 'text' ? 'left' : kind === 'date' || kind === 'count' ? 'center' : 'right' };
      }
      if (task.isSummary) {
        cell.font = { ...cell.font, bold: true };
        if (c.key !== 'status') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PHASE_FILL } };
      }
    });
  }
  return workbook;
}

function argb(hex: string): string {
  return `FF${hex.replace('#', '').toUpperCase()}`;
}

/** Build the workbook and hand it to the browser as `<schedule name>_<YYYY-MM-DD>.xlsx` */
export async function downloadTasksExcel<T extends ExportTask>(input: TasksSheetInput<T>, scheduleName: string): Promise<void> {
  try {
    const workbook = await buildTasksWorkbook({ ...input, sheetName: input.sheetName ?? scheduleName });
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeFileName(scheduleName)}_${todayYmd()}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Excel export failed:', err);
    window.alert('The Excel file could not be created. Please try again.');
  }
}
