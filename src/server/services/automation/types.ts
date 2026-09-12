export type AutomationStatus = 'draft' | 'active' | 'paused' | 'disabled' | 'error';

export type ActionType =
  | 'create_task'
  | 'notify'
  | 'send_email'
  | 'add_risk'
  | 'change_status'
  | 'update_field'
  | 'add_comment'
  | 'escalate'
  | 'call_webhook'
  | 'log_audit'
  | 'auto_assign'
  | 'ai_generate'
  | 'apply_lesson'
  | 'extract_lesson';

export type ConditionOperator =
  | 'equals' | 'not_equals'
  | 'greater_than' | 'less_than' | 'greater_equal' | 'less_equal'
  | 'contains' | 'not_contains'
  | 'in' | 'not_in'
  | 'before' | 'after'
  | 'is_empty' | 'is_not_empty';

export interface ConditionRule {
  field: string;
  operator: ConditionOperator;
  value?: any;
}

export interface AutomationConditionGroup {
  logic: 'and' | 'or';
  conditions: (ConditionRule | AutomationConditionGroup)[];
}

export interface AutomationAction {
  id: string;
  type: ActionType;
  params: Record<string, any>;
  runOrder: number;
  haltOnFailure?: boolean;
}

export interface AutomationDefinition {
  conditions?: AutomationConditionGroup;
  actions: AutomationAction[];
}

export interface AutomationRule {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  ownerUserId: string;
  status: AutomationStatus;
  version: number;
  triggerEventType: string;
  triggerEntityType: string | null;
  scope: 'project' | 'portfolio';
  definition: AutomationDefinition;
  triggerCount: number;
  lastTriggeredAt: string | null;
  lastError: string | null;
  maxRunsPerDay: number;
  cooldownSeconds: number;
  enabledAt: string | null;
  disabledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationEvent {
  type: string;
  entityType: string;
  entityId: string;
  projectId: string;
  userId: string;
  payload: Record<string, any>;
  previous?: Record<string, any>;
  timestamp: string;
  recursionDepth?: number;
}

export interface AutomationContext {
  event: AutomationEvent;
  entity: Record<string, any>;
  previous?: Record<string, any>;
  project?: Record<string, any>;
  user?: Record<string, any>;
  _aiOutputs?: Record<string, string>;
}

export interface ConditionTraceNode {
  type: 'rule' | 'group';
  passed: boolean;
  field?: string;
  operator?: string;
  expectedValue?: any;
  actualValue?: any;
  logic?: 'and' | 'or';
  children?: ConditionTraceNode[];
}

export interface AutomationAnalytics {
  totalRuns: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgDurationMs: number;
  errorPatterns: { message: string; count: number }[];
  dailyRuns: { date: string; count: number }[];
}

export interface AutomationSuggestion {
  id: string;
  name: string;
  description: string;
  why: string;
  triggerEventType: string;
  definition: AutomationDefinition;
  confidence: number;
  source: 'static' | 'ai';
}

export interface AutomationExecution {
  id: string;
  automationId: string;
  eventType: string;
  eventPayload: Record<string, any> | null;
  status: 'running' | 'completed' | 'failed' | 'skipped';
  actionsExecuted: number;
  actionsFailed: number;
  result: Record<string, any> | null;
  errorMessage: string | null;
  durationMs: number | null;
  triggeredBy: string | null;
  isDryRun: boolean;
  recursionDepth: number;
  createdAt: string;
}

export interface AutomationCooldown {
  id: string;
  automationId: string;
  cooldownKey: string;
  lastFiredAt: string;
  fireCountToday: number;
  fireDate: string;
}
