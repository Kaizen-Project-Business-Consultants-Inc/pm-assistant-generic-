import { describe, it, expect, vi } from 'vitest';

vi.mock('../../services/api', () => ({ apiService: {} }));

import { acceptAiSuggestion, sampleValues, taskColumnAsPhase, TARGET_COLUMNS } from '../../components/schedule/ColumnMapper';

describe('ColumnMapper — AI suggestion guard', () => {
  it('rejects an AI guess of Notes for a column whose header is not about notes', () => {
    // DBJ_LMS_Schedule.xlsx: "Task" holds T1/T2 codes and AI mapped it to Notes
    expect(acceptAiSuggestion('Task', 'description')).toBe(false);
    expect(acceptAiSuggestion('ID#', 'description')).toBe(false);
  });

  it('accepts Notes when the header means notes', () => {
    for (const h of ['Comments', 'Remarks', 'Task Description', 'Details', 'PM notes']) {
      expect(acceptAiSuggestion(h, 'description')).toBe(true);
    }
  });

  it('leaves every other target alone', () => {
    expect(acceptAiSuggestion('Task', 'phase')).toBe(true);
    expect(acceptAiSuggestion('Resp.', 'assignedTo')).toBe(true);
  });
});

describe('ColumnMapper — sample values for the AI', () => {
  const headers = ['ID#', 'Task', 'Activity'];
  const rows = [
    ['T1.1', 'T1', 'Kick-Off Meeting'],
    ['T1.2', '', 'Onboarding'],
    ['T2.1', 'T2', 'x'.repeat(200)],
  ];

  it('returns only the requested headers, skipping blanks', () => {
    expect(sampleValues(headers, ['Task'], rows)).toEqual({ Task: ['T1', 'T2'] });
  });

  it('caps values at 5 per column and 80 characters each', () => {
    const many = Array.from({ length: 9 }, (_, i) => ['', '', `v${i}`]);
    expect(sampleValues(headers, ['Activity'], many).Activity).toHaveLength(5);
    expect(sampleValues(headers, ['Activity'], rows).Activity[2]).toHaveLength(80);
  });

  it('ignores headers that are not in the file', () => {
    expect(sampleValues(headers, ['Nope'], rows)).toEqual({});
  });
});

describe('ColumnMapper — "Task" column beside a name column becomes the phase', () => {
  const targets = TARGET_COLUMNS.map(c => c.value).filter(Boolean) as string[];
  // DBJ_LMS_Schedule - Sep 14.xlsx header row
  const headers = ['ID#', 'Task', 'Activity', 'Assignrd to', 'Planned Start Date'];

  it('maps Task to Phase when Activity already holds the task name', () => {
    const out = taskColumnAsPhase(headers, { 2: 'name', 3: 'assignedTo', 4: 'startDate' }, targets);
    expect(out[1]).toBe('phase');
    expect(out[0]).toBeUndefined(); // ID# stays skipped
  });

  it('leaves Task alone when nothing else is the task name', () => {
    expect(taskColumnAsPhase(headers, { 4: 'startDate' }, targets)[1]).toBeUndefined();
  });

  it('does not override a phase column already mapped', () => {
    const out = taskColumnAsPhase([...headers, 'Phase'], { 2: 'name', 5: 'phase' }, targets);
    expect(out[1]).toBeUndefined();
  });

  it('does nothing for mappers without a phase target (e.g. RAID import)', () => {
    expect(taskColumnAsPhase(headers, { 2: 'name' }, ['name', 'description'])[1]).toBeUndefined();
  });
});

describe('ColumnMapper — Phase / Group target', () => {
  it('offers Phase / Group as a mapping choice', () => {
    expect(TARGET_COLUMNS.some(c => c.value === 'phase' && c.label === 'Phase / Group')).toBe(true);
  });
});
