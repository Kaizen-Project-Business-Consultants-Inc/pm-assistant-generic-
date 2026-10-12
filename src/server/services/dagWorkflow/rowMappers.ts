import { WorkflowDefinition, WorkflowNode, WorkflowEdge, WorkflowExecution, WorkflowNodeExecution } from './types';

export function parseJson(val: any): Record<string, any> {
  if (!val) return {};
  try { return typeof val === 'string' ? JSON.parse(val) : val; } catch { return {}; }
}

export function rowToDef(r: any): WorkflowDefinition {
  return {
    id: r.id, projectId: r.project_id ?? null, name: r.name,
    description: r.description ?? null, isEnabled: !!r.is_enabled,
    version: r.version, createdBy: r.created_by,
    createdAt: String(r.created_at), updatedAt: String(r.updated_at),
  };
}

export function rowToNode(r: any): WorkflowNode {
  return {
    id: r.id, workflowId: r.workflow_id, nodeType: r.node_type,
    name: r.name, config: parseJson(r.config),
    positionX: r.position_x, positionY: r.position_y,
    createdAt: String(r.created_at),
  };
}

export function rowToEdge(r: any): WorkflowEdge {
  return {
    id: r.id, workflowId: r.workflow_id,
    sourceNodeId: r.source_node_id, targetNodeId: r.target_node_id,
    conditionExpr: r.condition_expr ? parseJson(r.condition_expr) : null,
    label: r.label ?? null, sortOrder: r.sort_order,
  };
}

export function rowToExecution(r: any): WorkflowExecution {
  return {
    id: r.id, workflowId: r.workflow_id, triggerNodeId: r.trigger_node_id,
    entityType: r.entity_type, entityId: r.entity_id,
    // only the list query reads it (null = the task/project no longer exists)
    ...(r.entity_name !== undefined ? { entityName: r.entity_name ?? null } : {}),
    status: r.status, context: parseJson(r.context),
    startedAt: String(r.started_at),
    completedAt: r.completed_at ? String(r.completed_at) : null,
    errorMessage: r.error_message ?? null,
  };
}

export function rowToNodeExec(r: any): WorkflowNodeExecution {
  return {
    id: r.id, executionId: r.execution_id, nodeId: r.node_id,
    status: r.status, inputData: r.input_data ? parseJson(r.input_data) : null,
    outputData: r.output_data ? parseJson(r.output_data) : null,
    errorMessage: r.error_message ?? null,
    startedAt: r.started_at ? String(r.started_at) : null,
    completedAt: r.completed_at ? String(r.completed_at) : null,
  };
}
