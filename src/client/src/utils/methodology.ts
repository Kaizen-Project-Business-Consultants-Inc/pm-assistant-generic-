export type Methodology = 'waterfall' | 'agile' | 'hybrid';

type Tab = 'overview' | 'schedule' | 'raid' | 'ai-insights' | 'performance' | 'insights' | 'scenarios' | 'team' | 'agent-activity' | 'change-requests' | 'sprints' | 'backlog' | 'resources' | 'time' | 'files' | 'budget' | 'automations' | 'documents';

export function getDefaultViewMode(m: Methodology): string {
  return m === 'agile' ? 'kanban' : 'gantt';
}

export function getPrimaryTabs(m: Methodology): { id: Tab; label: string }[] {
  if (m === 'agile') {
    return [
      { id: 'overview', label: 'Overview' },
      { id: 'sprints', label: 'Sprints' },
      { id: 'backlog', label: 'Backlog' },
      { id: 'schedule', label: 'Schedule' },
      { id: 'raid', label: 'Risks & Issues' },
      { id: 'team', label: 'Team' },
    ];
  }

  if (m === 'hybrid') {
    return [
      { id: 'overview', label: 'Overview' },
      { id: 'schedule', label: 'Schedule' },
      { id: 'sprints', label: 'Sprints' },
      { id: 'backlog', label: 'Backlog' },
      { id: 'raid', label: 'Risks & Issues' },
      { id: 'team', label: 'Team' },
    ];
  }

  // Waterfall — 5 primary tabs; Changes moves to overflow
  return [
    { id: 'overview', label: 'Overview' },
    { id: 'schedule', label: 'Schedule' },
    { id: 'team', label: 'Team' },
    { id: 'raid', label: 'Risks & Issues' },
    { id: 'budget', label: 'Financials' },
  ];
}

export function getOverflowTabs(m: Methodology): { id: Tab; label: string }[] {
  const allOverflow: { id: Tab; label: string }[] = [
    { id: 'time', label: 'Hours' },
    { id: 'files', label: 'Files' },
    { id: 'insights', label: 'Forecast' },
    { id: 'resources', label: 'Resources' },
    { id: 'agent-activity', label: 'Agent Activity' },
    { id: 'automations', label: 'Automations' },
    { id: 'documents', label: 'Doc Intelligence' },
  ];

  if (m === 'waterfall') {
    // Budget is primary for waterfall; Changes + Sprints go to overflow
    allOverflow.push({ id: 'change-requests', label: 'Changes' });
    allOverflow.push({ id: 'sprints', label: 'Sprints' });
    allOverflow.push({ id: 'backlog', label: 'Backlog' });
    allOverflow.push({ id: 'scenarios', label: 'What-If' });
  } else {
    // Agile / Hybrid: Budget, Changes, What-If go to overflow
    allOverflow.push({ id: 'budget', label: 'Financials' });
    allOverflow.push({ id: 'change-requests', label: 'Changes' });
    allOverflow.push({ id: 'scenarios', label: 'What-If' });
  }

  return allOverflow;
}

export interface ReadinessStepConfig {
  key: string;
  label: string;
  tooltip: string;
  doneKey: 'tasks' | 'dependencies' | 'team' | 'sprints' | 'budget' | 'risks';
  /** a project tab, or 'edit' = the Edit project form */
  targetTab: string;
}

const TEAM_STEP = (label: string, tooltip: string): ReadinessStepConfig => ({ key: 'team', label, tooltip, doneKey: 'team', targetTab: 'team' });
const BUDGET_STEP: ReadinessStepConfig = { key: 'budget', label: 'Budget', tooltip: 'Set the project budget (Edit project)', doneKey: 'budget', targetTab: 'edit' };
const RISKS_STEP: ReadinessStepConfig = { key: 'risks', label: 'Risks', tooltip: 'Log the first risks or issues', doneKey: 'risks', targetTab: 'raid' };
const LINK_STEP: ReadinessStepConfig = { key: 'dependencies', label: 'Link tasks', tooltip: 'Link tasks that depend on each other (predecessors) to build your critical path', doneKey: 'dependencies', targetTab: 'schedule' };

/**
 * The project's setup steps (U14; one list since 2026-10-15 — the separate "Get Started" card
 * was removed): build the plan, people, budget, first risks — per methodology.
 */
export function getReadinessSteps(m: Methodology): ReadinessStepConfig[] {
  if (m === 'agile') {
    return [
      { key: 'backlog', label: 'Backlog', tooltip: 'Create user stories in your backlog', doneKey: 'tasks', targetTab: 'schedule' },
      { key: 'sprint', label: 'Sprint', tooltip: 'Create your first sprint to start iterating', doneKey: 'sprints', targetTab: 'sprints' },
      TEAM_STEP('Team', 'Add the people on this project'),
      BUDGET_STEP,
      RISKS_STEP,
    ];
  }

  if (m === 'hybrid') {
    return [
      { key: 'tasks', label: 'Tasks', tooltip: 'Import or create tasks to build your schedule', doneKey: 'tasks', targetTab: 'schedule' },
      { key: 'sprint', label: 'Sprint', tooltip: 'Create sprints for iterative delivery', doneKey: 'sprints', targetTab: 'sprints' },
      LINK_STEP,
      TEAM_STEP('Team', 'Add the people on this project, for workload and cost'),
      BUDGET_STEP,
      RISKS_STEP,
    ];
  }

  // Waterfall (default)
  return [
    { key: 'tasks', label: 'Tasks', tooltip: 'Import or create tasks to build your schedule', doneKey: 'tasks', targetTab: 'schedule' },
    LINK_STEP,
    TEAM_STEP('Team', 'Add the people on this project, for workload and cost'),
    BUDGET_STEP,
    RISKS_STEP,
  ];
}


type ProgressView = 'burndown' | 'scurve';

/**
 * The schedule's progress charts (U18): Agile = Burndown (fixed sprint scope), Waterfall =
 * S-curve (planned / earned / actual cost), Hybrid = both.
 */
export function progressViews(m: string | undefined): ProgressView[] {
  if (m === 'agile') return ['burndown'];
  if (m === 'waterfall' || !m) return ['scurve'];
  return ['burndown', 'scurve'];
}

/** A remembered view that this project's methodology doesn't offer becomes the one it does */
export function fitView<T extends string>(m: string | undefined, view: T): T | ProgressView {
  const offered = progressViews(m);
  return (view === 'burndown' || view === 'scurve') && !offered.includes(view as ProgressView) ? offered[0] : view;
}
