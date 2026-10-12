export type NodeType = 'trigger' | 'condition' | 'action' | 'approval' | 'delay' | 'agent';

export interface WorkflowDefinition {
  id: string;
  projectId: string | null;
  name: string;
  description: string | null;
  isEnabled: boolean;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowNode {
  id: string;
  workflowId: string;
  nodeType: NodeType;
  name: string;
  config: Record<string, any>;
  positionX: number;
  positionY: number;
  createdAt: string;
}

export interface WorkflowEdge {
  id: string;
  workflowId: string;
  sourceNodeId: string;
  targetNodeId: string;
  conditionExpr: Record<string, any> | null;
  label: string | null;
  sortOrder: number;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  triggerNodeId: string;
  entityType: string;
  entityId: string;
  /** The task's/project's name (list only); null when it no longer exists */
  entityName?: string | null;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'waiting';
  context: Record<string, any>;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface WorkflowNodeExecution {
  id: string;
  executionId: string;
  nodeId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'waiting';
  inputData: Record<string, any> | null;
  outputData: Record<string, any> | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface DefinitionWithGraph extends WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface ExecutionWithNodes extends WorkflowExecution {
  nodeExecutions: WorkflowNodeExecution[];
}
