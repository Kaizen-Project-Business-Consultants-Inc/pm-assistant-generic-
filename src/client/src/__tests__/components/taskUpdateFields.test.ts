/**
 * Guard (2026-10-06): the list of task fields the schedule grids send (shared/taskUpdateFields.ts)
 * covers every field the shared inline-edit and paste steps of the Gantt grid and the Table can
 * send, and the bulk bars' fields. The server side checks the same list is accepted, not stripped
 * (src/server/__tests__/routes/gridFieldsAccepted.test.ts) — Work edits were silently dropped
 * because nothing tied the two together.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { GRID_TASK_UPDATE_FIELDS, GRID_BULK_UPDATE_FIELDS } from '../../components/schedule/shared/taskUpdateFields';
import { GANTT_EDIT_RULES, TABLE_EDIT_RULES, type InlineEditRules } from '../../components/schedule/shared/hooks/useInlineCellEdit';
import { GANTT_KEYBOARD_RULES, TABLE_KEYBOARD_RULES, type GridKeyboardRules } from '../../components/schedule/shared/hooks/useGridKeyboardPaste';
import { FIELD_ORDER } from '../../components/schedule/gantt/types';
import { COLUMN_DEFS } from '../../components/schedule/tableColumns';
import { CALCULATED_CELL_HINTS, isLockedCell } from '../../components/schedule/summaryRollup';

// Duration and Predecessors go through the shared planners, which send these instead
const PLANNED: Record<string, string> = { duration: 'endDate', dependency: 'dependencies' };

const GANTT_FIELDS: string[] = [...FIELD_ORDER];
const TABLE_FIELDS: string[] = COLUMN_DEFS.filter(c => c.editable).map(c => c.key);

const views: Array<[string, string[], InlineEditRules<string>, GridKeyboardRules<string>]> = [
  ['Gantt grid', GANTT_FIELDS, GANTT_EDIT_RULES, GANTT_KEYBOARD_RULES],
  ['Table', TABLE_FIELDS, TABLE_EDIT_RULES, TABLE_KEYBOARD_RULES],
];

describe('the grids\' task-update field list covers what they send', () => {
  for (const [view, fields, edit, paste] of views) {
    it(`${view}: every inline-edit and paste field is listed, with a value of the same kind`, () => {
      for (const f of fields) {
        for (const api of [PLANNED[f] ?? edit.toApiField(f), PLANNED[f] ?? paste.toPasteApiField(f)]) {
          expect(Object.keys(GRID_TASK_UPDATE_FIELDS), `${view} ${f} → ${api}`).toContain(api);
        }
        if (PLANNED[f]) continue;
        const api = edit.toApiField(f);
        const sample = GRID_TASK_UPDATE_FIELDS[api];
        const typed = String(sample);
        expect(typeof edit.toSaveValue(f, typed), `${view} ${f} (typed)`).toBe(typeof sample);
        expect(typeof paste.toPasteValue(f, typed), `${view} ${f} (pasted)`).toBe(typeof sample);
      }
    });
  }

  it('Est Days and Work are sent as numbers by both views', () => {
    for (const [, , edit, paste] of views) {
      expect(edit.toSaveValue('estimatedDurationHours', '12.5')).toBe(12.5);
      expect(paste.toPasteValue('estimatedDays', '3')).toBe(3);
    }
  });

  it('the bulk bars only send listed bulk fields', () => {
    const dir = join(__dirname, '../../components/schedule');
    const src = ['gantt/GanttBulkActionBar.tsx', 'table/TableBulkActionBar.tsx'].map(f => readFileSync(join(dir, f), 'utf8')).join('\n');
    const sent = [...src.matchAll(/(?:applyBulkUpdate|onApplyBulkUpdate)\('([A-Za-z]+)'/g)].map(m => m[1]);
    expect(sent.length).toBeGreaterThan(0);
    for (const f of sent) expect(Object.keys(GRID_BULK_UPDATE_FIELDS)).toContain(f);
  });

  it('Budget and Actual Cost are calculated (hours × rate): no grid edits or sends them', () => {
    for (const f of Object.keys(CALCULATED_CELL_HINTS)) {
      expect(Object.keys(GRID_TASK_UPDATE_FIELDS), f).not.toContain(f);
      expect(Object.keys(GRID_BULK_UPDATE_FIELDS), f).not.toContain(f);
      expect(GANTT_FIELDS, f).not.toContain(f);
      expect(TABLE_FIELDS, f).not.toContain(f);
      expect(isLockedCell({ isSummary: false }, f), f).toBe(true);
    }
  });
});
