export interface ProjectKpiPM {
  label: string;
  value: number | string;
  icon: string;
  color: 'green' | 'amber' | 'red' | 'teal' | 'gray';
  drillPath?: string;
}

export interface PriorityItemPM {
  id: string;
  type: 'task' | 'risk' | 'issue' | 'milestone';
  title: string;
  projectName: string;
  dueLabel: string;
  isOverdue: boolean;
  daysUntilDue: number;
  projectId: string;
}

export interface ProjectSummaryPM {
  /** PRJ-001…, given automatically when the project is made */
  code?: string;
  id: string;
  name: string;
  client?: string;
  status: string;
  priority: string;
  projectType?: string;
  methodology?: string;
  healthScore: number;
  progress: number;
  budgetAllocated: number;
  budgetSpent: number;
  endDate?: string;
  daysLeft?: number;
  archivedAt?: string;
}

export interface TaskPM {
  id: string;
  name: string;
  status: string;
  priority: string;
  assignedTo?: string;
  startDate?: string;
  endDate?: string;
  progressPercentage?: number;
}

export interface RiskPM {
  id: string;
  title: string;
  severity: string;
  status: string;
  projectId: string;
  projectName?: string;
}

export interface IssuePM {
  id: string;
  title: string;
  severity: string;
  status: string;
  projectId: string;
}

export interface MilestonePM {
  id: string;
  name: string;
  dueDate: string;
  status: string;
  projectId: string;
  projectName?: string;
}

export interface RaidEntryPM {
  id: string;
  type: 'risk' | 'action' | 'issue' | 'decision';
  title: string;
  status: string;
  owner?: string;
  dueDate?: string;
}

export interface DocumentPM {
  id: string;
  name: string;
  type: string;
  uploadedAt: string;
  uploadedBy?: string;
  size?: number;
}
