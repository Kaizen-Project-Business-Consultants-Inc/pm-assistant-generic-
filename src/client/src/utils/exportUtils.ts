import { todayYmd } from './rateCard';

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function downloadCSV(filename: string, headers: string[], rows: string[][]): void {
  const csvLines = [
    headers.map(escapeCSV).join(','),
    ...rows.map(row => row.map(escapeCSV).join(',')),
  ];
  const blob = new Blob([csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** A schedule name made safe for a file name (shared by the CSV and Excel exports) */
export function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'tasks';
}

export function exportTasksCSV(tasks: Array<{
  name?: string;
  status?: string;
  priority?: string;
  assignedTo?: string;
  startDate?: string;
  endDate?: string;
  progressPercentage?: number;
}>, scheduleName: string, names?: ReadonlyMap<string, string>): void {
  const headers = ['Name', 'Status', 'Priority', 'Assigned To', 'Start Date', 'End Date', 'Progress %'];
  const rows = tasks.map(t => [
    t.name || '',
    t.status || '',
    t.priority || '',
    (t.assignedTo && names?.get(t.assignedTo)) || t.assignedTo || '', // the name, as on screen — not the stored id
    t.startDate || '',
    t.endDate || '',
    String(t.progressPercentage ?? 0),
  ]);
  downloadCSV(`${safeFileName(scheduleName)}_${todayYmd()}.csv`, headers, rows);
}
