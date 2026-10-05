import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { isSummaryRollupCell, SUMMARY_ROLLUP_FIELD_NAMES } from '../../components/schedule/summaryRollup';
import { SUMMARY_ROLLUP_FIELDS } from '../../components/schedule/table/types';

describe('isSummaryRollupCell — cells a summary task cannot be given by hand', () => {
  const summary = { isSummary: true };
  it('refuses Start, Finish, Duration, % complete and Status on a summary row', () => {
    for (const f of ['startDate', 'endDate', 'duration', 'progressPercentage', 'status', 'budgetAllocated', 'actualCost']) {
      expect(isSummaryRollupCell(summary, f)).toBe(true);
    }
  });
  it('leaves the other cells of a summary row editable', () => {
    for (const f of ['name', 'dependency', 'priority', 'assignedTo', 'estimatedDays', 'estimatedDurationHours', 'notes']) {
      expect(isSummaryRollupCell(summary, f)).toBe(false);
    }
  });
  it('never refuses anything on an ordinary task', () => {
    for (const f of SUMMARY_ROLLUP_FIELD_NAMES) {
      expect(isSummaryRollupCell({ isSummary: false }, f)).toBe(false);
      expect(isSummaryRollupCell({}, f)).toBe(false);
      expect(isSummaryRollupCell(undefined, f)).toBe(false);
    }
  });
  it('the Table view list is the same list', () => {
    expect([...SUMMARY_ROLLUP_FIELDS].sort()).toEqual([...SUMMARY_ROLLUP_FIELD_NAMES].sort());
  });
});

// Oct 2026: the Table view refused typing a summary's Start/Finish/% but the Gantt grid let
// you, and neither checked on paste. Both views must ask the same rule when a cell opens for
// typing, when it is drawn, and when something is pasted into it.
describe('Gantt and Table refuse the same cells on summary rows', () => {
  const SCHEDULE = join(__dirname, '../../components/schedule');
  const read = (f: string) => readFileSync(join(SCHEDULE, f), 'utf8');
  const fnBody = (src: string, start: string) => {
    const i = src.indexOf(start);
    expect(i).toBeGreaterThan(-1);
    return src.slice(i, src.indexOf('}, [', i));
  };

  // The Gantt grid's paste path lives in gantt/hooks/useGridKeyboard.ts (moved out of GanttChart.tsx 2026-10-04)
  const GANTT_KEYBOARD = 'gantt/hooks/useGridKeyboard.ts';
  for (const file of ['GanttChart.tsx', 'TableView.tsx']) {
    const src = file === 'GanttChart.tsx' ? `${read(file)}\n${read(GANTT_KEYBOARD)}` : read(file);
    it(`${file}: a summary's rolled-up cell does not open for typing`, () => {
      expect(fnBody(src, 'const startEditing = useCallback(')).toContain('isSummaryRollupCell(task, field)');
    });
    it(`${file}: Ctrl+V into a summary's rolled-up cell is refused`, () => {
      const paste = src.slice(src.indexOf('copiedValue.field === focusedCell.field'));
      const guard = paste.indexOf('isSummaryRollupCell(pasteTarget, focusedCell.field)');
      const firstUpdate = paste.indexOf('onTaskUpdate');
      expect(guard).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(firstUpdate);
    });
  }

  it('the Gantt grid draws those cells as not editable, like the Table view', () => {
    const row = read('gantt/GanttLeftPanelRow.tsx');
    expect(row).toContain("if (isSummaryRollupCell(task, field)) return 'relative cursor-default opacity-70';");
    expect(row).toMatch(/editableCellClass\([^)]*field, task\)/);
  });
});
