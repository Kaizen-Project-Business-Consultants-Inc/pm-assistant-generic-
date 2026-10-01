import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { GanttLegend } from '../../components/schedule/gantt/GanttLegend';

/** The colour key showed "Complete" and "Not Started" twice (older status spellings). 2026-10-01 */
describe('Gantt colour key', () => {
  it('lists each status once', () => {
    const { container } = render(<GanttLegend showOverallocation={false} overallocatedTaskIds={new Set()} />);
    const labels = Array.from(container.querySelectorAll('span')).map(s => s.textContent?.trim()).filter(Boolean);
    for (const l of ['Complete', 'Not Started', 'In Progress', 'In Review', 'Testing', 'Blocked', 'Cancelled']) {
      expect(labels.filter(x => x === l)).toHaveLength(1);
    }
  });
});
