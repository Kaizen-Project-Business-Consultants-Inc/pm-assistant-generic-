// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { QuickFilterPills } from '../../pages/ProjectDetailPage/schedule-tab/QuickFilterPills';
import { ScheduleSummaryBar } from '../../pages/ProjectDetailPage/schedule-tab/ScheduleSummaryBar';
import { DEFAULT_RISK_THRESHOLDS } from '../../utils/taskRiskAssessment';

afterEach(() => cleanup());

describe('schedule quick filters and summary use the new status words', () => {
  it('the progress check is called Behind plan (not At Risk), next to Late', () => {
    const counts = { all: 5, due: 1, late: 2, at_risk: 1, my_tasks: 0, unassigned: 0 };
    const { container } = render(<QuickFilterPills activeFilter="all" onFilterChange={() => {}} dueWeeks={2} onDueWeeksChange={() => {}} counts={counts} thresholds={DEFAULT_RISK_THRESHOLDS} onThresholdsChange={() => {}} />);
    const text = container.textContent ?? '';
    expect(text).toContain('Late');
    expect(text).toContain('Behind plan');
    expect(text).not.toContain('At Risk');
  });
  it('the summary line says On Track, not In Progress', () => {
    const { container } = render(<ScheduleSummaryBar stats={{ total: 4, completed: 1, inProgress: 2, pending: 1, overdue: 0, pct: 25 }} />);
    expect(container.textContent).toContain('2 on track');
    expect(container.textContent).not.toContain('in progress');
  });
});
