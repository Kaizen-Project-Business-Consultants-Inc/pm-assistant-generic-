import { describe, it, expect } from 'vitest';
import { fixTaskIds } from '../../components/schedule/review/ScheduleFixProposalPanel';

const base = { id: 'f1', confidence: 0.9, reason: '', defaultChecked: true } as const;

describe('fixTaskIds', () => {
  it('link: the task waited on first, then the task that waits', () => {
    expect(fixTaskIds({ ...base, type: 'add_dependency', taskId: 'b', dependsOnTaskId: 'a' } as any)).toEqual(['a', 'b']);
  });
  it('buffer: the gate it protects', () => {
    expect(fixTaskIds({ ...base, type: 'insert_buffer', gateTaskId: 'g' } as any)).toEqual(['g']);
  });
  it('new task: the rows either side, missing ends skipped', () => {
    expect(fixTaskIds({ ...base, type: 'add_task', afterTaskId: 'a', beforeTaskId: 'b' } as any)).toEqual(['a', 'b']);
    expect(fixTaskIds({ ...base, type: 'add_task', afterTaskId: 'a' } as any)).toEqual(['a']);
  });
  it('anything else: its own task; none when it has no task', () => {
    expect(fixTaskIds({ ...base, type: 'set_duration', taskId: 't' } as any)).toEqual(['t']);
    expect(fixTaskIds({ ...base, type: 'set_duration' } as any)).toEqual([]);
  });
});
