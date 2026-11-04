import { describe, it, expect } from 'vitest';
import { buildTasksWorkbook, BASIC_COLUMNS, basicValue, levelsByParent, exportColumns } from '../../utils/exportExcel';
import type { ColumnKey } from '../../components/schedule/tableColumns';

const tasks = [
  { id: 'p', name: 'Phase 1', status: 'in_progress', isSummary: true, startDate: '2026-11-02', endDate: '2026-11-13', progressPercentage: 50 },
  { id: 'a', name: 'Design', parentTaskId: 'p', status: 'completed', assignedTo: 'res-1', startDate: '2026-11-02', endDate: '2026-11-06', progressPercentage: 100 },
  { id: 'b', name: 'Sub task', parentTaskId: 'a', status: 'blocked', startDate: '2026-11-09', endDate: '2026-11-13', progressPercentage: 0 },
  { id: 'm', name: 'Go live', status: 'pending', isMilestone: true, startDate: '2026-12-31', endDate: '2026-12-31' },
];
const names = new Map([['res-1', 'Ada Lovelace']]);
const columns = [
  ...BASIC_COLUMNS,
  { key: 'budgetAllocated' as ColumnKey, label: 'Budget' },
  { key: 'duration' as ColumnKey, label: 'Duration' },
];
const value = (t: (typeof tasks)[number], key: ColumnKey) =>
  key === 'budgetAllocated' ? 1500 : key === 'duration' ? 5 : basicValue(names)(t, key);

describe('buildTasksWorkbook', { timeout: 30_000 }, () => {
  it('writes a styled, frozen, filtered sheet with real cells', async () => {
    const wb = await buildTasksWorkbook({ tasks, columns, value, canSeePay: true, sheetName: 'My plan' });
    const ws = wb.getWorksheet('My plan')!;
    expect(ws.getRow(1).values).toEqual([undefined, 'Task Name', 'Status', 'Priority', 'Assigned To', 'Start Date', 'End Date', 'Progress', 'Budget', 'Duration']);
    expect(ws.getCell('A1').font?.bold).toBe(true);
    expect(ws.getCell('A1').fill).toMatchObject({ fgColor: { argb: 'FF0F766E' } });
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(ws.autoFilter).toMatchObject({ from: { row: 1, column: 1 }, to: { row: 1, column: 9 } });

    // outline: indent per level through the cell alignment, not spaces
    expect(ws.getCell('A2').value).toBe('Phase 1');
    expect(ws.getCell('A2').alignment?.indent).toBe(0);
    expect(ws.getCell('A3').alignment?.indent).toBe(1);
    expect(ws.getCell('A4').alignment?.indent).toBe(2);
    expect(ws.getCell('A4').value).toBe('Sub task');
    // phase row bold and shaded; a task row is not
    expect(ws.getCell('A2').font?.bold).toBe(true);
    expect(ws.getCell('A2').fill).toMatchObject({ fgColor: { argb: 'FFE6F4F1' } });
    expect(ws.getCell('A3').font?.bold).toBeFalsy();
    // milestone is marked
    expect(String(ws.getCell('A5').value)).toContain('Go live');
    expect(String(ws.getCell('A5').value).startsWith('◆')).toBe(true);
    // status: label and the app's colour
    expect(ws.getCell('B3').value).toBe('Completed');
    expect(ws.getCell('B3').fill).toMatchObject({ fgColor: { argb: 'FFDBEAFE' } });
    expect(ws.getCell('B4').value).toBe('Blocked');
    // assigned by name, not by id
    expect(ws.getCell('D3').value).toBe('Ada Lovelace');
    // real dates, the calendar day exactly as given (no time-zone shift)
    const start = ws.getCell('E3').value as Date;
    expect(start).toBeInstanceOf(Date);
    expect(start.toISOString().slice(0, 10)).toBe('2026-11-02');
    expect(ws.getCell('E3').numFmt).toBe('dd-mmm-yyyy');
    // numbers
    expect(ws.getCell('G3').value).toBe(1);
    expect(ws.getCell('G3').numFmt).toBe('0%');
    expect(ws.getCell('I3').value).toBe(5);
    expect(ws.getCell('H3').value).toBe(1500);
  });

  it('survives a save and reload (what Excel opens)', async () => {
    const wb = await buildTasksWorkbook({ tasks, columns, value, canSeePay: true });
    const buffer = await wb.xlsx.writeBuffer();
    const mod = await import('exceljs');
    const again = new (mod.default ?? mod).Workbook();
    await again.xlsx.load(buffer as ArrayBuffer);
    const ws = again.worksheets[0];
    expect(ws.rowCount).toBe(5);
    expect((ws.getCell('E3').value as Date).toISOString().slice(0, 10)).toBe('2026-11-02');
    expect(ws.getCell('A4').alignment?.indent).toBe(2);
  });

  it('leaves out the money columns without the right to see pay rates', async () => {
    const wb = await buildTasksWorkbook({ tasks, columns, value, canSeePay: false });
    const headers = wb.worksheets[0].getRow(1).values as unknown[];
    expect(headers).not.toContain('Budget');
    expect(headers).toContain('Duration');
    expect(exportColumns([{ key: 'baselineCost', label: 'Baseline Cost' }, { key: 'actualCost', label: 'Actual Cost' }, { key: 'budgetVariance', label: 'Cost Variance' }], false)).toEqual([]);
  });

  it('works out outline levels from parents inside the list', () => {
    const levels = levelsByParent([{ id: 'x', parentTaskId: 'gone' }, { id: 'y', parentTaskId: 'x' }]);
    expect(levels.get('x')).toBe(0);
    expect(levels.get('y')).toBe(1);
  });
});
