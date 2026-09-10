export interface FieldInfo {
  name: string;
  label: string;
  type: 'string' | 'number' | 'date' | 'boolean';
}

export const FIELD_CATALOG: Record<string, FieldInfo[]> = {
  task: [
    { name: 'name', label: 'Task Name', type: 'string' },
    { name: 'status', label: 'Status', type: 'string' },
    { name: 'priority', label: 'Priority', type: 'string' },
    { name: 'assignedTo', label: 'Assigned To', type: 'string' },
    { name: 'progressPercentage', label: 'Progress %', type: 'number' },
    { name: 'startDate', label: 'Start Date', type: 'date' },
    { name: 'endDate', label: 'End Date', type: 'date' },
    { name: 'duration', label: 'Duration', type: 'number' },
    { name: 'isMilestone', label: 'Is Milestone', type: 'boolean' },
    { name: 'isCritical', label: 'Is Critical', type: 'boolean' },
  ],
  project: [
    { name: 'name', label: 'Project Name', type: 'string' },
    { name: 'status', label: 'Status', type: 'string' },
    { name: 'priority', label: 'Priority', type: 'string' },
    { name: 'budget', label: 'Budget', type: 'number' },
    { name: 'startDate', label: 'Start Date', type: 'date' },
    { name: 'endDate', label: 'End Date', type: 'date' },
  ],
  risk: [
    { name: 'title', label: 'Title', type: 'string' },
    { name: 'type', label: 'Type', type: 'string' },
    { name: 'status', label: 'Status', type: 'string' },
    { name: 'severity', label: 'Severity', type: 'string' },
    { name: 'probability', label: 'Probability', type: 'number' },
    { name: 'impact', label: 'Impact', type: 'number' },
    { name: 'category', label: 'Category', type: 'string' },
  ],
  sprint: [
    { name: 'name', label: 'Sprint Name', type: 'string' },
    { name: 'status', label: 'Status', type: 'string' },
    { name: 'startDate', label: 'Start Date', type: 'date' },
    { name: 'endDate', label: 'End Date', type: 'date' },
    { name: 'goal', label: 'Goal', type: 'string' },
  ],
  change_request: [
    { name: 'title', label: 'Title', type: 'string' },
    { name: 'status', label: 'Status', type: 'string' },
    { name: 'priority', label: 'Priority', type: 'string' },
    { name: 'category', label: 'Category', type: 'string' },
  ],
};
