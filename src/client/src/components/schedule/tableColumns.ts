export type ColumnKey =
  | 'rowNum' | 'name' | 'status' | 'priority' | 'startDate' | 'endDate'
  | 'progressPercentage' | 'assignedTo' | 'duration' | 'earlyStart' | 'earlyFinish'
  | 'lateStart' | 'lateFinish' | 'totalFloat' | 'freeFloat' | 'critical'
  | 'baselineStart' | 'baselineEnd' | 'startVariance' | 'endVariance'
  | 'notes' | 'dependency' | 'successor' | 'wbs' | 'resource'
  | 'budgetAllocated' | 'actualCost' | 'budgetVariance'
  | 'constraintType' | 'constraintDate';

export type ColumnGroup = 'standard' | 'scheduling' | 'baseline' | 'cost' | 'other';

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  group: ColumnGroup;
  defaultVisible: boolean;
  editable: boolean;
  sortable: boolean;
}

export const COLUMN_DEFS: ColumnDef[] = [
  // Row number (always first)
  { key: 'rowNum', label: '#', group: 'standard', defaultVisible: true, editable: false, sortable: false },

  // Standard
  { key: 'name', label: 'Task Name', group: 'standard', defaultVisible: true, editable: true, sortable: true },
  { key: 'status', label: 'Status', group: 'standard', defaultVisible: true, editable: true, sortable: true },
  { key: 'priority', label: 'Priority', group: 'standard', defaultVisible: true, editable: true, sortable: true },
  { key: 'startDate', label: 'Start Date', group: 'standard', defaultVisible: true, editable: true, sortable: true },
  { key: 'endDate', label: 'End Date', group: 'standard', defaultVisible: true, editable: true, sortable: true },
  { key: 'progressPercentage', label: 'Progress', group: 'standard', defaultVisible: true, editable: true, sortable: true },
  { key: 'assignedTo', label: 'Assigned To', group: 'standard', defaultVisible: true, editable: true, sortable: true },
  { key: 'duration', label: 'Duration', group: 'standard', defaultVisible: true, editable: true, sortable: true },

  // Scheduling (CPM)
  { key: 'earlyStart', label: 'Early Start', group: 'scheduling', defaultVisible: false, editable: false, sortable: true },
  { key: 'earlyFinish', label: 'Early Finish', group: 'scheduling', defaultVisible: false, editable: false, sortable: true },
  { key: 'lateStart', label: 'Late Start', group: 'scheduling', defaultVisible: false, editable: false, sortable: true },
  { key: 'lateFinish', label: 'Late Finish', group: 'scheduling', defaultVisible: false, editable: false, sortable: true },
  { key: 'totalFloat', label: 'Total Float', group: 'scheduling', defaultVisible: false, editable: false, sortable: true },
  { key: 'freeFloat', label: 'Free Float', group: 'scheduling', defaultVisible: false, editable: false, sortable: true },
  { key: 'critical', label: 'Critical', group: 'scheduling', defaultVisible: false, editable: false, sortable: true },
  { key: 'constraintType', label: 'Constraint', group: 'scheduling', defaultVisible: false, editable: true, sortable: true },
  { key: 'constraintDate', label: 'Constraint Date', group: 'scheduling', defaultVisible: false, editable: true, sortable: true },

  // Baseline
  { key: 'baselineStart', label: 'Baseline Start', group: 'baseline', defaultVisible: false, editable: false, sortable: true },
  { key: 'baselineEnd', label: 'Baseline End', group: 'baseline', defaultVisible: false, editable: false, sortable: true },
  { key: 'startVariance', label: 'Start Variance', group: 'baseline', defaultVisible: false, editable: false, sortable: true },
  { key: 'endVariance', label: 'End Variance', group: 'baseline', defaultVisible: false, editable: false, sortable: true },

  // Cost
  { key: 'budgetAllocated', label: 'Budget', group: 'cost', defaultVisible: false, editable: true, sortable: true },
  { key: 'actualCost', label: 'Actual Cost', group: 'cost', defaultVisible: false, editable: true, sortable: true },
  { key: 'budgetVariance', label: 'Cost Variance', group: 'cost', defaultVisible: false, editable: false, sortable: true },

  // Other
  { key: 'notes', label: 'Notes', group: 'standard', defaultVisible: false, editable: true, sortable: true },
  { key: 'dependency', label: 'Predecessor', group: 'standard', defaultVisible: false, editable: true, sortable: false },
  { key: 'successor', label: 'Successor', group: 'standard', defaultVisible: false, editable: false, sortable: false },
  { key: 'wbs', label: 'WBS', group: 'other', defaultVisible: false, editable: false, sortable: false },
  { key: 'resource', label: 'Resource', group: 'standard', defaultVisible: false, editable: false, sortable: false },
];

export const DEFAULT_VISIBLE_KEYS = new Set<ColumnKey>(
  COLUMN_DEFS.filter(c => c.defaultVisible).map(c => c.key)
);

export const SCHEDULING_KEYS = new Set<ColumnKey>(
  COLUMN_DEFS.filter(c => c.group === 'scheduling').map(c => c.key)
);

export const BASELINE_KEYS = new Set<ColumnKey>(
  COLUMN_DEFS.filter(c => c.group === 'baseline').map(c => c.key)
);

export const COST_KEYS = new Set<ColumnKey>(
  COLUMN_DEFS.filter(c => c.group === 'cost').map(c => c.key)
);
