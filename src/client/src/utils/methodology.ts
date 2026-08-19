export type Methodology = 'waterfall' | 'agile' | 'hybrid';

type Tab = 'overview' | 'schedule' | 'raid' | 'ai-insights' | 'performance' | 'scenarios' | 'team' | 'agent-activity' | 'change-requests' | 'sprints' | 'backlog' | 'resources' | 'time' | 'files' | 'budget';

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

  // Waterfall
  return [
    { id: 'overview', label: 'Overview' },
    { id: 'schedule', label: 'Schedule' },
    { id: 'team', label: 'Team' },
    { id: 'raid', label: 'Risks & Issues' },
    { id: 'budget', label: 'Financials' },
    { id: 'change-requests', label: 'Changes' },
  ];
}

export function getOverflowTabs(m: Methodology): { id: Tab; label: string }[] {
  const allOverflow: { id: Tab; label: string }[] = [
    { id: 'time', label: 'Time' },
    { id: 'files', label: 'Files' },
    { id: 'performance', label: 'Performance' },
    { id: 'ai-insights', label: 'AI Insights' },
    { id: 'resources', label: 'Resources' },
    { id: 'agent-activity', label: 'Agent Activity' },
  ];

  if (m === 'waterfall') {
    // Budget + Changes are primary for waterfall; add Sprints to overflow
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
  doneKey: 'tasks' | 'dependencies' | 'resources' | 'sprints';
  targetTab: string;
}

export function getReadinessSteps(m: Methodology): ReadinessStepConfig[] {
  if (m === 'agile') {
    return [
      { key: 'backlog', label: 'Backlog', tooltip: 'Create user stories in your backlog', doneKey: 'tasks', targetTab: 'schedule' },
      { key: 'sprint', label: 'Sprint', tooltip: 'Create your first sprint to start iterating', doneKey: 'sprints', targetTab: 'sprints' },
      { key: 'team', label: 'Team', tooltip: 'Add team members for capacity planning', doneKey: 'resources', targetTab: 'resources' },
    ];
  }

  if (m === 'hybrid') {
    return [
      { key: 'tasks', label: 'Tasks', tooltip: 'Import or create tasks to build your schedule', doneKey: 'tasks', targetTab: 'schedule' },
      { key: 'sprint', label: 'Sprint', tooltip: 'Create sprints for iterative delivery', doneKey: 'sprints', targetTab: 'sprints' },
      { key: 'resources', label: 'Resources', tooltip: 'Add team members for workload forecasting', doneKey: 'resources', targetTab: 'resources' },
      { key: 'dependencies', label: 'Predecessors', tooltip: 'Link predecessor tasks to build your critical path', doneKey: 'dependencies', targetTab: 'schedule' },
    ];
  }

  // Waterfall (default)
  return [
    { key: 'tasks', label: 'Tasks', tooltip: 'Import or create tasks to build your schedule', doneKey: 'tasks', targetTab: 'schedule' },
    { key: 'dependencies', label: 'Predecessors', tooltip: 'Link predecessor tasks to build your critical path', doneKey: 'dependencies', targetTab: 'schedule' },
    { key: 'resources', label: 'Resources', tooltip: 'Add team members for workload and cost forecasting', doneKey: 'resources', targetTab: 'resources' },
  ];
}

