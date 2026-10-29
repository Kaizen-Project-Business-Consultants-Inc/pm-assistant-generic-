import { describe, it, expect } from 'vitest';
import { statusOptions as ganttOptions, TASK_STATUSES } from '../../components/schedule/gantt/types';
import { statusOptions as tableOptions } from '../../components/schedule/table/types';
import { groupTasksByStatus } from '../../components/schedule/KanbanBoard';

const FIVE = ['pending', 'in_progress', 'late', 'completed', 'blocked'];

describe('every place a status is picked offers the same five', () => {
  it('Gantt cell, Table cell, bulk bars and the Gantt key/filter', () => {
    expect([...ganttOptions]).toEqual(FIVE);
    expect([...tableOptions]).toEqual(FIVE);
    expect([...TASK_STATUSES]).toEqual(FIVE);
  });
  it('the Kanban board has those five columns, and a Cancelled one only while a task still has it', () => {
    expect(Object.keys(groupTasksByStatus([]))).toEqual(FIVE);
    const withCancelled = groupTasksByStatus([{ id: 'a', name: 'A', status: 'cancelled' }]);
    expect(Object.keys(withCancelled)).toEqual([...FIVE, 'cancelled']);
  });
  it('the Kanban board puts a task past its finish in Late and shows In Review / Testing under On Track', () => {
    const g = groupTasksByStatus([
      { id: 'a', name: 'A', status: 'in_progress', endDate: '2000-01-01' },
      { id: 'b', name: 'B', status: 'testing', endDate: '2999-01-01' },
      { id: 'c', name: 'C', status: 'completed', endDate: '2000-01-01' },
    ]);
    expect(g.late.map(t => t.id)).toEqual(['a']);
    expect(g.in_progress.map(t => t.id)).toEqual(['b']);
    expect(g.completed.map(t => t.id)).toEqual(['c']);
  });
});
