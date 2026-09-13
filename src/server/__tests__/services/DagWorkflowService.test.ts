import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('../../database/WorkflowRepository', () => {
  const mockRepo = {
    checkTablesExist: vi.fn().mockResolvedValue(true),
    insertDefinition: vi.fn().mockResolvedValue(undefined),
    insertNode: vi.fn().mockImplementation((id, wfId, nodeType, name, config, posX, posY) => ({
      id, workflowId: wfId, nodeType, name, config, positionX: posX, positionY: posY, createdAt: '2026-01-01',
    })),
    insertEdge: vi.fn().mockImplementation((id, wfId, srcId, tgtId, condExpr, label, sortOrder) => ({
      id, workflowId: wfId, sourceNodeId: srcId, targetNodeId: tgtId,
      conditionExpr: condExpr, label, sortOrder,
    })),
    insertEdgeNoReturn: vi.fn().mockResolvedValue(undefined),
    findDefinitionById: vi.fn().mockResolvedValue(null),
    findDefinitions: vi.fn().mockResolvedValue([]),
    findEnabledDefinitions: vi.fn().mockResolvedValue([]),
    findNodesByWorkflow: vi.fn().mockResolvedValue([]),
    findEdgesByWorkflow: vi.fn().mockResolvedValue([]),
    updateDefinitionFields: vi.fn().mockResolvedValue(undefined),
    deleteDefinition: vi.fn().mockResolvedValue(true),
    deleteNodesByWorkflow: vi.fn().mockResolvedValue(undefined),
    deleteEdgesByWorkflow: vi.fn().mockResolvedValue(undefined),
    setEnabled: vi.fn().mockResolvedValue(undefined),
    insertExecution: vi.fn().mockResolvedValue(undefined),
    findExecutionById: vi.fn().mockResolvedValue(null),
    findExecutions: vi.fn().mockResolvedValue([]),
    updateExecutionStatus: vi.fn().mockResolvedValue(undefined),
    completeExecution: vi.fn().mockResolvedValue(undefined),
    getExecutionContext: vi.fn().mockResolvedValue({}),
    updateExecutionContext: vi.fn().mockResolvedValue(undefined),
    insertNodeExecution: vi.fn().mockResolvedValue(undefined),
    findNodeExecutionsByExecution: vi.fn().mockResolvedValue([]),
    updateNodeExecutionCompleted: vi.fn().mockResolvedValue(undefined),
    completeWaitingNodeExecution: vi.fn().mockResolvedValue(undefined),
    updateNodeExecutionWaiting: vi.fn().mockResolvedValue(undefined),
    updateNodeExecutionSkipped: vi.fn().mockResolvedValue(undefined),
    updateNodeExecutionFailed: vi.fn().mockResolvedValue(undefined),
    getNodeExecutionStatuses: vi.fn().mockResolvedValue([]),
  };
  return { workflowRepository: mockRepo };
});

vi.mock('../../services/AuditLedgerService', () => ({
  auditLedgerService: {
    append: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/DeadLetterService', () => ({
  deadLetterService: {
    capture: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findTaskById: vi.fn().mockResolvedValue(null),
    updateTask: vi.fn().mockResolvedValue(undefined),
    logActivity: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn().mockResolvedValue(null),
  },
  ScheduleService: class {},
}));

vi.mock('../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('mock-uuid'),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────

import { workflowRepository } from '../../database/WorkflowRepository';
import { auditLedgerService } from '../../services/AuditLedgerService';
import { deadLetterService } from '../../services/DeadLetterService';
import { scheduleService } from '../../services/ScheduleService';
import { v4 as uuidv4 } from 'uuid';
import type { Task } from '../../services/ScheduleService';
import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowEdge,
  WorkflowExecution,
  WorkflowNodeExecution,
  DefinitionWithGraph,
  ExecutionWithNodes,
} from '../../services/dagWorkflow/types';

const mockRepo = workflowRepository as any;
const mockAudit = auditLedgerService as any;
const mockDead = deadLetterService as any;
const mockUuid = uuidv4 as any;
const mockScheduleService = scheduleService as any;

// ── Test helpers ──────────────────────────────────────────────────────────

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    scheduleId: 's1',
    name: 'Test Task',
    status: 'pending',
    priority: 'medium',
    taskType: 'task',
    sortOrder: 0,
    createdBy: 'u1',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    dependencies: [],
    ...overrides,
  };
}

function makeNode(overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id: 'n1',
    workflowId: 'wf1',
    nodeType: 'trigger',
    name: 'Trigger Node',
    config: { triggerType: 'status_change' },
    positionX: 0,
    positionY: 0,
    createdAt: '2026-01-01',
    ...overrides,
  };
}

function makeDef(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: 'wf1',
    projectId: 'p1',
    name: 'Test Workflow',
    description: null,
    isEnabled: true,
    version: 1,
    createdBy: 'u1',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

function makeDefWithGraph(
  nodes: WorkflowNode[] = [],
  edges: WorkflowEdge[] = [],
  overrides: Partial<WorkflowDefinition> = {},
): DefinitionWithGraph {
  return { ...makeDef(overrides), nodes, edges };
}

function makeEdge(overrides: Partial<WorkflowEdge> = {}): WorkflowEdge {
  return {
    id: 'e1',
    workflowId: 'wf1',
    sourceNodeId: 'n1',
    targetNodeId: 'n2',
    conditionExpr: null,
    label: null,
    sortOrder: 0,
    ...overrides,
  };
}

function makeExecution(overrides: Partial<WorkflowExecution> = {}): WorkflowExecution {
  return {
    id: 'exec1',
    workflowId: 'wf1',
    triggerNodeId: 'n1',
    entityType: 'task',
    entityId: 't1',
    status: 'running',
    context: {},
    startedAt: '2026-01-01',
    completedAt: null,
    errorMessage: null,
    ...overrides,
  };
}

function makeNodeExecution(overrides: Partial<WorkflowNodeExecution> = {}): WorkflowNodeExecution {
  return {
    id: 'ne1',
    executionId: 'exec1',
    nodeId: 'n1',
    status: 'completed',
    inputData: null,
    outputData: null,
    errorMessage: null,
    startedAt: '2026-01-01',
    completedAt: '2026-01-01',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Part 1: Pure functions from engine.ts
// ═══════════════════════════════════════════════════════════════════════════

import { matchesTrigger, evaluateCondition, buildAdjacencyList } from '../../services/dagWorkflow/engine';
import { resolveTemplates } from '../../services/dagWorkflow/templateResolver';

describe('matchesTrigger', () => {
  describe('status_change', () => {
    const config = { triggerType: 'status_change' };

    it('returns true when status actually changed', () => {
      const oldTask = makeTask({ status: 'pending' });
      const newTask = makeTask({ status: 'in_progress' });
      expect(matchesTrigger(config, newTask, oldTask)).toBe(true);
    });

    it('returns false when status did not change', () => {
      const oldTask = makeTask({ status: 'pending' });
      const newTask = makeTask({ status: 'pending' });
      expect(matchesTrigger(config, newTask, oldTask)).toBe(false);
    });

    it('returns false when oldTask is null', () => {
      const newTask = makeTask();
      expect(matchesTrigger(config, newTask, null)).toBe(false);
    });

    it('respects fromStatus filter', () => {
      const configWithFrom = { triggerType: 'status_change', fromStatus: 'pending' };
      const oldTask = makeTask({ status: 'in_progress' });
      const newTask = makeTask({ status: 'completed' });
      expect(matchesTrigger(configWithFrom, newTask, oldTask)).toBe(false);
    });

    it('respects toStatus filter', () => {
      const configWithTo = { triggerType: 'status_change', toStatus: 'completed' };
      const oldTask = makeTask({ status: 'pending' });
      const newTask = makeTask({ status: 'in_progress' });
      expect(matchesTrigger(configWithTo, newTask, oldTask)).toBe(false);
    });

    it('matches when both fromStatus and toStatus match', () => {
      const configBoth = { triggerType: 'status_change', fromStatus: 'pending', toStatus: 'completed' };
      const oldTask = makeTask({ status: 'pending' });
      const newTask = makeTask({ status: 'completed' });
      expect(matchesTrigger(configBoth, newTask, oldTask)).toBe(true);
    });
  });

  describe('progress_threshold', () => {
    it('returns true when progress meets threshold (above)', () => {
      const config = { triggerType: 'progress_threshold', progressThreshold: 80 };
      const task = makeTask({ progressPercentage: 85 });
      expect(matchesTrigger(config, task, null)).toBe(true);
    });

    it('returns false when progress is below threshold (above direction)', () => {
      const config = { triggerType: 'progress_threshold', progressThreshold: 80 };
      const task = makeTask({ progressPercentage: 50 });
      expect(matchesTrigger(config, task, null)).toBe(false);
    });

    it('returns true when progress meets threshold (below direction)', () => {
      const config = { triggerType: 'progress_threshold', progressThreshold: 20, progressDirection: 'below' };
      const task = makeTask({ progressPercentage: 10 });
      expect(matchesTrigger(config, task, null)).toBe(true);
    });

    it('defaults to 0 threshold when not specified', () => {
      const config = { triggerType: 'progress_threshold' };
      const task = makeTask({ progressPercentage: 0 });
      expect(matchesTrigger(config, task, null)).toBe(true);
    });

    it('defaults to 0 progress when not set on task', () => {
      const config = { triggerType: 'progress_threshold', progressThreshold: 10 };
      const task = makeTask({ progressPercentage: undefined });
      expect(matchesTrigger(config, task, null)).toBe(false);
    });
  });

  describe('date_passed', () => {
    it('returns true when endDate is in the past', () => {
      const config = { triggerType: 'date_passed' };
      const task = makeTask({ endDate: '2020-01-01' });
      expect(matchesTrigger(config, task, null)).toBe(true);
    });

    it('returns false when endDate is in the future', () => {
      const config = { triggerType: 'date_passed' };
      const task = makeTask({ endDate: '2099-12-31' });
      expect(matchesTrigger(config, task, null)).toBe(false);
    });

    it('returns false when no endDate', () => {
      const config = { triggerType: 'date_passed' };
      const task = makeTask({ endDate: undefined });
      expect(matchesTrigger(config, task, null)).toBe(false);
    });
  });

  describe('task_created', () => {
    it('returns true when oldTask is null (new task)', () => {
      const config = { triggerType: 'task_created' };
      const task = makeTask();
      expect(matchesTrigger(config, task, null)).toBe(true);
    });

    it('returns false when oldTask exists (update, not creation)', () => {
      const config = { triggerType: 'task_created' };
      const task = makeTask();
      const oldTask = makeTask();
      expect(matchesTrigger(config, task, oldTask)).toBe(false);
    });

    it('respects statusFilter', () => {
      const config = { triggerType: 'task_created', statusFilter: 'in_progress' };
      const task = makeTask({ status: 'pending' });
      expect(matchesTrigger(config, task, null)).toBe(false);
    });

    it('matches when statusFilter matches', () => {
      const config = { triggerType: 'task_created', statusFilter: 'pending' };
      const task = makeTask({ status: 'pending' });
      expect(matchesTrigger(config, task, null)).toBe(true);
    });
  });

  describe('assignment_change', () => {
    it('returns true when assignedTo changed', () => {
      const config = { triggerType: 'assignment_change' };
      const oldTask = makeTask({ assignedTo: 'u1' });
      const newTask = makeTask({ assignedTo: 'u2' });
      expect(matchesTrigger(config, newTask, oldTask)).toBe(true);
    });

    it('returns false when assignedTo did not change', () => {
      const config = { triggerType: 'assignment_change' };
      const oldTask = makeTask({ assignedTo: 'u1' });
      const newTask = makeTask({ assignedTo: 'u1' });
      expect(matchesTrigger(config, newTask, oldTask)).toBe(false);
    });

    it('returns false when oldTask is null', () => {
      const config = { triggerType: 'assignment_change' };
      const newTask = makeTask({ assignedTo: 'u2' });
      expect(matchesTrigger(config, newTask, null)).toBe(false);
    });

    it('respects toAssignee filter', () => {
      const config = { triggerType: 'assignment_change', toAssignee: 'u3' };
      const oldTask = makeTask({ assignedTo: 'u1' });
      const newTask = makeTask({ assignedTo: 'u2' });
      expect(matchesTrigger(config, newTask, oldTask)).toBe(false);
    });

    it('treats undefined and empty string assignedTo as equal', () => {
      const config = { triggerType: 'assignment_change' };
      const oldTask = makeTask({ assignedTo: undefined });
      const newTask = makeTask({ assignedTo: undefined });
      expect(matchesTrigger(config, newTask, oldTask)).toBe(false);
    });
  });

  describe('dependency_change', () => {
    it('returns true when dependencies differ', () => {
      const config = { triggerType: 'dependency_change' };
      const oldTask = makeTask({ dependencies: [{ id: 'd1', taskId: 't1', dependencyId: 'dep1', type: 'FS' as const, lagDays: 0 }] });
      const newTask = makeTask({ dependencies: [{ id: 'd2', taskId: 't1', dependencyId: 'dep2', type: 'FS' as const, lagDays: 0 }] });
      expect(matchesTrigger(config, newTask, oldTask)).toBe(true);
    });

    it('returns false when dependencies are the same', () => {
      const config = { triggerType: 'dependency_change' };
      const deps = [{ id: 'd1', taskId: 't1', dependencyId: 'dep1', type: 'FS' as const, lagDays: 0 }];
      const oldTask = makeTask({ dependencies: deps });
      const newTask = makeTask({ dependencies: deps });
      expect(matchesTrigger(config, newTask, oldTask)).toBe(false);
    });

    it('returns false when oldTask is null', () => {
      const config = { triggerType: 'dependency_change' };
      const newTask = makeTask();
      expect(matchesTrigger(config, newTask, null)).toBe(false);
    });
  });

  describe('priority_change', () => {
    it('returns true when priority changed', () => {
      const config = { triggerType: 'priority_change' };
      const oldTask = makeTask({ priority: 'low' });
      const newTask = makeTask({ priority: 'high' });
      expect(matchesTrigger(config, newTask, oldTask)).toBe(true);
    });

    it('returns false when priority did not change', () => {
      const config = { triggerType: 'priority_change' };
      const oldTask = makeTask({ priority: 'medium' });
      const newTask = makeTask({ priority: 'medium' });
      expect(matchesTrigger(config, newTask, oldTask)).toBe(false);
    });

    it('returns false when oldTask is null', () => {
      const config = { triggerType: 'priority_change' };
      const newTask = makeTask();
      expect(matchesTrigger(config, newTask, null)).toBe(false);
    });

    it('respects toPriority filter', () => {
      const config = { triggerType: 'priority_change', toPriority: 'urgent' };
      const oldTask = makeTask({ priority: 'low' });
      const newTask = makeTask({ priority: 'high' });
      expect(matchesTrigger(config, newTask, oldTask)).toBe(false);
    });
  });

  describe('manual trigger', () => {
    it('always returns true', () => {
      const config = { triggerType: 'manual' };
      expect(matchesTrigger(config, makeTask(), null)).toBe(true);
    });
  });

  describe('non-task trigger types', () => {
    it('budget_threshold returns false (handled elsewhere)', () => {
      expect(matchesTrigger({ triggerType: 'budget_threshold' }, makeTask(), null)).toBe(false);
    });

    it('project_status_change returns false (handled elsewhere)', () => {
      expect(matchesTrigger({ triggerType: 'project_status_change' }, makeTask(), null)).toBe(false);
    });

    it('proposal_created returns false (handled elsewhere)', () => {
      expect(matchesTrigger({ triggerType: 'proposal_created' }, makeTask(), null)).toBe(false);
    });
  });

  describe('unknown trigger type', () => {
    it('returns false', () => {
      expect(matchesTrigger({ triggerType: 'some_unknown' }, makeTask(), null)).toBe(false);
    });
  });
});

describe('evaluateCondition', () => {
  it('returns false when task is null', () => {
    expect(evaluateCondition({ field: 'status', operator: 'equals', value: 'pending' }, null)).toBe(false);
  });

  it('evaluates equals correctly', () => {
    const task = makeTask({ status: 'pending' });
    expect(evaluateCondition({ field: 'status', operator: 'equals', value: 'pending' }, task)).toBe(true);
    expect(evaluateCondition({ field: 'status', operator: 'equals', value: 'completed' }, task)).toBe(false);
  });

  it('evaluates not_equals correctly', () => {
    const task = makeTask({ status: 'pending' });
    expect(evaluateCondition({ field: 'status', operator: 'not_equals', value: 'completed' }, task)).toBe(true);
    expect(evaluateCondition({ field: 'status', operator: 'not_equals', value: 'pending' }, task)).toBe(false);
  });

  it('evaluates greater_than correctly', () => {
    const task = makeTask({ progressPercentage: 75 });
    expect(evaluateCondition({ field: 'progressPercentage', operator: 'greater_than', value: 50 }, task)).toBe(true);
    expect(evaluateCondition({ field: 'progressPercentage', operator: 'greater_than', value: 90 }, task)).toBe(false);
  });

  it('evaluates less_than correctly', () => {
    const task = makeTask({ progressPercentage: 25 });
    expect(evaluateCondition({ field: 'progressPercentage', operator: 'less_than', value: 50 }, task)).toBe(true);
    expect(evaluateCondition({ field: 'progressPercentage', operator: 'less_than', value: 10 }, task)).toBe(false);
  });

  it('evaluates contains correctly', () => {
    const task = makeTask({ name: 'Deploy to production' });
    expect(evaluateCondition({ field: 'name', operator: 'contains', value: 'production' }, task)).toBe(true);
    expect(evaluateCondition({ field: 'name', operator: 'contains', value: 'staging' }, task)).toBe(false);
  });

  it('evaluates not_contains correctly', () => {
    const task = makeTask({ name: 'Deploy to production' });
    expect(evaluateCondition({ field: 'name', operator: 'not_contains', value: 'staging' }, task)).toBe(true);
    expect(evaluateCondition({ field: 'name', operator: 'not_contains', value: 'production' }, task)).toBe(false);
  });

  it('returns false for unknown operator', () => {
    const task = makeTask();
    expect(evaluateCondition({ field: 'status', operator: 'unknown_op', value: 'pending' }, task)).toBe(false);
  });
});

describe('buildAdjacencyList', () => {
  it('builds adjacency list from edges', () => {
    const nodes = [makeNode({ id: 'n1' }), makeNode({ id: 'n2' }), makeNode({ id: 'n3' })];
    const edges = [
      makeEdge({ id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2', sortOrder: 0 }),
      makeEdge({ id: 'e2', sourceNodeId: 'n1', targetNodeId: 'n3', sortOrder: 1 }),
    ];
    const def = makeDefWithGraph(nodes, edges);
    const adj = buildAdjacencyList(def);

    expect(adj.get('n1')).toHaveLength(2);
    expect(adj.get('n1')![0].targetNodeId).toBe('n2');
    expect(adj.get('n1')![1].targetNodeId).toBe('n3');
    expect(adj.get('n2')).toBeUndefined();
  });

  it('sorts edges by sortOrder', () => {
    const nodes = [makeNode({ id: 'n1' }), makeNode({ id: 'n2' }), makeNode({ id: 'n3' })];
    const edges = [
      makeEdge({ id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n3', sortOrder: 5 }),
      makeEdge({ id: 'e2', sourceNodeId: 'n1', targetNodeId: 'n2', sortOrder: 1 }),
    ];
    const def = makeDefWithGraph(nodes, edges);
    const adj = buildAdjacencyList(def);

    expect(adj.get('n1')![0].targetNodeId).toBe('n2');
    expect(adj.get('n1')![1].targetNodeId).toBe('n3');
  });

  it('returns empty map for definition with no edges', () => {
    const def = makeDefWithGraph([makeNode()], []);
    const adj = buildAdjacencyList(def);
    expect(adj.size).toBe(0);
  });
});

describe('resolveTemplates', () => {
  it('resolves node output templates preserving type for single-template values', () => {
    const nodeOutputs = { nodeA: { result: true, value: 42 } };
    const input = { val: '{{nodes.nodeA.value}}' };
    const result = resolveTemplates(input, nodeOutputs, null);
    // Single-template strings preserve the original type (number, not string)
    expect(result.val).toBe(42);
    expect(typeof result.val).toBe('number');
  });

  it('resolves boolean node outputs preserving type', () => {
    const nodeOutputs = { nodeA: { result: true } };
    const input = { flag: '{{nodes.nodeA.result}}' };
    const result = resolveTemplates(input, nodeOutputs, null);
    expect(result.flag).toBe(true);
    expect(typeof result.flag).toBe('boolean');
  });

  it('resolves task field templates via single template', () => {
    const task = { name: 'My Task', status: 'in_progress', id: 't1' } as any;
    // Use single-template syntax which preserves type
    const result1 = resolveTemplates({ val: '{{task.name}}' }, {}, task);
    const result2 = resolveTemplates({ val: '{{task.status}}' }, {}, task);
    expect(result1.val).toBe('My Task');
    expect(result2.val).toBe('in_progress');
  });

  it('resolves single task field template preserving numeric type', () => {
    const task = { id: 't1', progressPercentage: 75 } as any;
    const input = { val: '{{task.progressPercentage}}' };
    const result = resolveTemplates(input, {}, task);
    expect(result.val).toBe(75);
  });

  it('resolves trigger context templates', () => {
    const triggerCtx = { proposalId: 'prop1', title: 'My Proposal' };
    const input = { id: '{{trigger.proposalId}}' };
    const result = resolveTemplates(input, {}, null, triggerCtx);
    expect(result.id).toBe('prop1');
  });

  it('leaves unresolved templates as-is', () => {
    const input = { val: '{{nonexistent.path}}' };
    const result = resolveTemplates(input, {}, null);
    expect(result.val).toBe('{{nonexistent.path}}');
  });

  it('handles nested objects', () => {
    const task = { name: 'Task1' } as any;
    const input = { outer: { inner: '{{task.name}}' } };
    const result = resolveTemplates(input, {}, task);
    expect(result.outer.inner).toBe('Task1');
  });

  it('handles arrays', () => {
    const task = { name: 'Task1' } as any;
    const input = { items: ['{{task.name}}', 'static'] };
    const result = resolveTemplates(input, {}, task);
    expect(result.items[0]).toBe('Task1');
    expect(result.items[1]).toBe('static');
  });

  it('handles mixed string interpolation with node outputs', () => {
    const nodeOutputs = { n1: { action: 'update_field', value: 42 } };
    const input = { msg: 'Action {{nodes.n1.action}} set value to {{nodes.n1.value}}' };
    const result = resolveTemplates(input, nodeOutputs, null);
    expect(result.msg).toBe('Action update_field set value to 42');
  });

  it('does not mutate original input', () => {
    const task = { name: 'Task1' } as any;
    const input = { val: '{{task.name}}' };
    resolveTemplates(input, {}, task);
    expect(input.val).toBe('{{task.name}}');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 2: DagWorkflowService (the class)
// ═══════════════════════════════════════════════════════════════════════════

// We must dynamically import after mocks are set up
let dagWorkflowService: any;

beforeEach(async () => {
  vi.clearAllMocks();
  // Reset the uuid counter for deterministic IDs
  let uuidCounter = 0;
  mockUuid.mockImplementation(() => `uuid-${uuidCounter++}`);
  // Re-import to get fresh singleton state
  const mod = await import('../../services/dagWorkflow/index');
  dagWorkflowService = mod.dagWorkflowService;
  // Reset tablesVerified (private field)
  (dagWorkflowService as any).tablesVerified = false;
});

describe('DagWorkflowService', () => {
  // ── CRUD: Definitions ──────────────────────────────────────────────────

  describe('createDefinition', () => {
    it('creates a definition with nodes and edges', async () => {
      const defResult = makeDef({ id: 'uuid-0' });
      mockRepo.findDefinitionById.mockResolvedValueOnce(defResult);

      const result = await dagWorkflowService.createDefinition({
        projectId: 'p1',
        name: 'Test Workflow',
        createdBy: 'u1',
        nodes: [
          { nodeType: 'trigger', name: 'Trigger', config: { triggerType: 'manual' } },
          { nodeType: 'action', name: 'Action', config: { actionType: 'log_activity' } },
        ],
        edges: [{ sourceIndex: 0, targetIndex: 1 }],
      });

      expect(mockRepo.insertDefinition).toHaveBeenCalledWith('uuid-0', 'p1', 'Test Workflow', null, 'u1');
      expect(mockRepo.insertNode).toHaveBeenCalledTimes(2);
      expect(mockRepo.insertEdge).toHaveBeenCalledTimes(1);
      expect(result).toHaveProperty('nodes');
      expect(result).toHaveProperty('edges');
    });

    it('uses null for projectId when not provided', async () => {
      mockRepo.findDefinitionById.mockResolvedValueOnce(makeDef());

      await dagWorkflowService.createDefinition({
        name: 'Global Workflow',
        createdBy: 'u1',
        nodes: [],
        edges: [],
      });

      expect(mockRepo.insertDefinition).toHaveBeenCalledWith(
        expect.any(String), null, 'Global Workflow', null, 'u1',
      );
    });

    it('skips edges with invalid source/target indices', async () => {
      mockRepo.findDefinitionById.mockResolvedValueOnce(makeDef());

      await dagWorkflowService.createDefinition({
        name: 'Test',
        createdBy: 'u1',
        nodes: [{ nodeType: 'trigger', name: 'Trigger', config: {} }],
        edges: [{ sourceIndex: 0, targetIndex: 5 }], // index 5 doesn't exist
      });

      expect(mockRepo.insertEdge).not.toHaveBeenCalled();
    });
  });

  describe('getDefinition', () => {
    it('returns definition with nodes and edges', async () => {
      const def = makeDef();
      const nodes = [makeNode()];
      const edges = [makeEdge()];
      mockRepo.findDefinitionById.mockResolvedValueOnce(def);
      mockRepo.findNodesByWorkflow.mockResolvedValueOnce(nodes);
      mockRepo.findEdgesByWorkflow.mockResolvedValueOnce(edges);

      const result = await dagWorkflowService.getDefinition('wf1');

      expect(result).toEqual({ ...def, nodes, edges });
    });

    it('returns null when definition not found', async () => {
      mockRepo.findDefinitionById.mockResolvedValueOnce(null);

      const result = await dagWorkflowService.getDefinition('nonexistent');
      expect(result).toBeNull();
    });

    it('returns null when tables do not exist', async () => {
      mockRepo.checkTablesExist.mockResolvedValueOnce(false);

      const result = await dagWorkflowService.getDefinition('wf1');
      expect(result).toBeNull();
    });

    it('caches table existence check after first success', async () => {
      mockRepo.checkTablesExist.mockResolvedValue(true);
      mockRepo.findDefinitionById.mockResolvedValue(null);

      await dagWorkflowService.getDefinition('wf1');
      await dagWorkflowService.getDefinition('wf2');

      // Should only check once because tablesVerified becomes true
      expect(mockRepo.checkTablesExist).toHaveBeenCalledTimes(1);
    });
  });

  describe('listDefinitions', () => {
    it('delegates to repository', async () => {
      const defs = [makeDef()];
      mockRepo.checkTablesExist.mockResolvedValueOnce(true);
      mockRepo.findDefinitions.mockResolvedValueOnce(defs);

      const result = await dagWorkflowService.listDefinitions('p1');
      expect(mockRepo.findDefinitions).toHaveBeenCalledWith('p1');
      expect(result).toEqual(defs);
    });

    it('returns empty array when tables do not exist', async () => {
      mockRepo.checkTablesExist.mockResolvedValueOnce(false);

      const result = await dagWorkflowService.listDefinitions();
      expect(result).toEqual([]);
    });
  });

  describe('updateDefinition', () => {
    it('updates name and description fields', async () => {
      // getDefinition calls: checkTablesExist, findDefinitionById, findNodes, findEdges
      mockRepo.checkTablesExist.mockResolvedValueOnce(true);
      const def = makeDef();
      const nodes = [makeNode()];
      const edges = [makeEdge()];
      mockRepo.findDefinitionById.mockResolvedValueOnce(def);
      mockRepo.findNodesByWorkflow.mockResolvedValueOnce(nodes);
      mockRepo.findEdgesByWorkflow.mockResolvedValueOnce(edges);

      // After update, getDefinition is called again
      mockRepo.findDefinitionById.mockResolvedValueOnce({ ...def, name: 'Updated' });
      mockRepo.findNodesByWorkflow.mockResolvedValueOnce(nodes);
      mockRepo.findEdgesByWorkflow.mockResolvedValueOnce(edges);

      const result = await dagWorkflowService.updateDefinition('wf1', { name: 'Updated', description: 'Desc' });

      expect(mockRepo.updateDefinitionFields).toHaveBeenCalledWith(
        'wf1',
        ['name = ?', 'description = ?', 'version = version + 1'],
        ['Updated', 'Desc'],
      );
      expect(result).toBeDefined();
      expect(result!.name).toBe('Updated');
    });

    it('returns null when definition does not exist', async () => {
      mockRepo.checkTablesExist.mockResolvedValueOnce(true);
      mockRepo.findDefinitionById.mockResolvedValueOnce(null);

      const result = await dagWorkflowService.updateDefinition('nonexistent', { name: 'X' });
      expect(result).toBeNull();
    });

    it('replaces nodes and edges when nodes array is provided', async () => {
      mockRepo.checkTablesExist.mockResolvedValueOnce(true);
      const def = makeDef();
      mockRepo.findDefinitionById.mockResolvedValueOnce(def);
      mockRepo.findNodesByWorkflow.mockResolvedValueOnce([]);
      mockRepo.findEdgesByWorkflow.mockResolvedValueOnce([]);

      // After update
      mockRepo.findDefinitionById.mockResolvedValueOnce(def);
      mockRepo.findNodesByWorkflow.mockResolvedValueOnce([]);
      mockRepo.findEdgesByWorkflow.mockResolvedValueOnce([]);

      await dagWorkflowService.updateDefinition('wf1', {
        nodes: [
          { nodeType: 'trigger', name: 'T', config: {} },
          { nodeType: 'action', name: 'A', config: {} },
        ],
        edges: [{ sourceIndex: 0, targetIndex: 1 }],
      });

      expect(mockRepo.deleteEdgesByWorkflow).toHaveBeenCalledWith('wf1');
      expect(mockRepo.deleteNodesByWorkflow).toHaveBeenCalledWith('wf1');
      expect(mockRepo.insertNode).toHaveBeenCalledTimes(2);
      expect(mockRepo.insertEdgeNoReturn).toHaveBeenCalledTimes(1);
    });

    it('does not call updateDefinitionFields when no scalar fields changed', async () => {
      mockRepo.checkTablesExist.mockResolvedValueOnce(true);
      const def = makeDef();
      mockRepo.findDefinitionById.mockResolvedValueOnce(def);
      mockRepo.findNodesByWorkflow.mockResolvedValueOnce([]);
      mockRepo.findEdgesByWorkflow.mockResolvedValueOnce([]);
      mockRepo.findDefinitionById.mockResolvedValueOnce(def);
      mockRepo.findNodesByWorkflow.mockResolvedValueOnce([]);
      mockRepo.findEdgesByWorkflow.mockResolvedValueOnce([]);

      await dagWorkflowService.updateDefinition('wf1', {
        nodes: [{ nodeType: 'trigger', name: 'T', config: {} }],
      });

      expect(mockRepo.updateDefinitionFields).not.toHaveBeenCalled();
    });
  });

  describe('deleteDefinition', () => {
    it('delegates to repository', async () => {
      mockRepo.deleteDefinition.mockResolvedValueOnce(true);

      const result = await dagWorkflowService.deleteDefinition('wf1');
      expect(mockRepo.deleteDefinition).toHaveBeenCalledWith('wf1');
      expect(result).toBe(true);
    });

    it('returns false when definition does not exist', async () => {
      mockRepo.deleteDefinition.mockResolvedValueOnce(false);

      const result = await dagWorkflowService.deleteDefinition('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('toggleEnabled', () => {
    it('enables a workflow', async () => {
      const def = makeDef({ isEnabled: false });
      mockRepo.findDefinitionById
        .mockResolvedValueOnce(def) // first call to check existence
        .mockResolvedValueOnce({ ...def, isEnabled: true }); // second call to return updated

      const result = await dagWorkflowService.toggleEnabled('wf1', true);
      expect(mockRepo.setEnabled).toHaveBeenCalledWith('wf1', true);
      expect(result!.isEnabled).toBe(true);
    });

    it('returns null when definition does not exist', async () => {
      mockRepo.findDefinitionById.mockResolvedValueOnce(null);

      const result = await dagWorkflowService.toggleEnabled('nonexistent', true);
      expect(result).toBeNull();
    });
  });

  // ── Execution queries ─────────────────────────────────────────────────

  describe('getExecution', () => {
    it('returns execution with node executions', async () => {
      const exec = makeExecution();
      const nodeExecs = [makeNodeExecution()];
      mockRepo.checkTablesExist.mockResolvedValueOnce(true);
      mockRepo.findExecutionById.mockResolvedValueOnce(exec);
      mockRepo.findNodeExecutionsByExecution.mockResolvedValueOnce(nodeExecs);

      const result = await dagWorkflowService.getExecution('exec1');
      expect(result).toEqual({ ...exec, nodeExecutions: nodeExecs });
    });

    it('returns null when execution not found', async () => {
      mockRepo.checkTablesExist.mockResolvedValueOnce(true);
      mockRepo.findExecutionById.mockResolvedValueOnce(null);

      const result = await dagWorkflowService.getExecution('nonexistent');
      expect(result).toBeNull();
    });

    it('returns null when tables do not exist', async () => {
      mockRepo.checkTablesExist.mockResolvedValueOnce(false);

      const result = await dagWorkflowService.getExecution('exec1');
      expect(result).toBeNull();
    });
  });

  describe('listExecutions', () => {
    it('returns executions with filters', async () => {
      const execs = [makeExecution()];
      mockRepo.checkTablesExist.mockResolvedValueOnce(true);
      mockRepo.findExecutions.mockResolvedValueOnce(execs);

      const result = await dagWorkflowService.listExecutions({ workflowId: 'wf1', status: 'running' });
      expect(mockRepo.findExecutions).toHaveBeenCalledWith({ workflowId: 'wf1', status: 'running' });
      expect(result).toEqual(execs);
    });

    it('returns empty array when tables do not exist', async () => {
      mockRepo.checkTablesExist.mockResolvedValueOnce(false);

      const result = await dagWorkflowService.listExecutions();
      expect(result).toEqual([]);
    });
  });

  // ── evaluateTaskChange ───────────────────────────────────────────────

  describe('evaluateTaskChange', () => {
    it('triggers matching workflows on task status change', async () => {
      mockRepo.checkTablesExist.mockResolvedValueOnce(true);

      const def = makeDef({ id: 'wf1' });
      mockRepo.findEnabledDefinitions.mockResolvedValueOnce([def]);

      const triggerNode = makeNode({
        id: 'n1',
        nodeType: 'trigger',
        config: { triggerType: 'status_change', toStatus: 'completed' },
      });
      const fullDef = makeDefWithGraph([triggerNode], []);

      // getDefinition
      mockRepo.findDefinitionById.mockResolvedValueOnce(makeDef({ id: 'wf1' }));
      mockRepo.findNodesByWorkflow.mockResolvedValueOnce([triggerNode]);
      mockRepo.findEdgesByWorkflow.mockResolvedValueOnce([]);

      // executeWorkflowEngine -> insertExecution, insertNodeExecution, getNodeExecutionStatuses, completeExecution
      mockRepo.getNodeExecutionStatuses.mockResolvedValueOnce([{ status: 'completed' }]);

      // getExecution for audit
      mockRepo.findExecutionById.mockResolvedValueOnce(makeExecution({ status: 'completed' }));
      mockRepo.findNodeExecutionsByExecution.mockResolvedValueOnce([]);

      const oldTask = makeTask({ status: 'in_progress' });
      const newTask = makeTask({ status: 'completed' });

      await dagWorkflowService.evaluateTaskChange(newTask, oldTask, {} as any);

      expect(mockRepo.insertExecution).toHaveBeenCalled();
      expect(mockAudit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'workflow.execute',
          entityType: 'workflow',
        }),
      );
    });

    it('does nothing when tables do not exist', async () => {
      mockRepo.checkTablesExist.mockResolvedValueOnce(false);

      await dagWorkflowService.evaluateTaskChange(makeTask(), null, {} as any);
      expect(mockRepo.findEnabledDefinitions).not.toHaveBeenCalled();
    });

    it('catches and logs errors without throwing', async () => {
      mockRepo.checkTablesExist.mockResolvedValueOnce(true);
      mockRepo.findEnabledDefinitions.mockRejectedValueOnce(new Error('DB error'));

      // Should not throw
      await dagWorkflowService.evaluateTaskChange(makeTask(), null, {} as any);
    });

    it('skips workflows with no matching triggers', async () => {
      mockRepo.checkTablesExist.mockResolvedValueOnce(true);

      const def = makeDef({ id: 'wf1' });
      mockRepo.findEnabledDefinitions.mockResolvedValueOnce([def]);

      const triggerNode = makeNode({
        nodeType: 'trigger',
        config: { triggerType: 'status_change', toStatus: 'completed' },
      });
      mockRepo.findDefinitionById.mockResolvedValueOnce(makeDef());
      mockRepo.findNodesByWorkflow.mockResolvedValueOnce([triggerNode]);
      mockRepo.findEdgesByWorkflow.mockResolvedValueOnce([]);

      // Task status didn't change to 'completed'
      const oldTask = makeTask({ status: 'pending' });
      const newTask = makeTask({ status: 'in_progress' });

      await dagWorkflowService.evaluateTaskChange(newTask, oldTask, {} as any);
      expect(mockRepo.insertExecution).not.toHaveBeenCalled();
    });
  });

  // ── evaluateProjectChange ──────────────────────────────────────────────

  describe('evaluateProjectChange', () => {
    it('triggers on budget_threshold when utilization meets threshold', async () => {
      mockRepo.checkTablesExist.mockResolvedValueOnce(true);

      const def = makeDef({ id: 'wf1' });
      mockRepo.findEnabledDefinitions.mockResolvedValueOnce([def]);

      const triggerNode = makeNode({
        id: 'n1',
        nodeType: 'trigger',
        config: { triggerType: 'budget_threshold', thresholdPercent: 90 },
      });
      mockRepo.findDefinitionById.mockResolvedValueOnce(makeDef());
      mockRepo.findNodesByWorkflow.mockResolvedValueOnce([triggerNode]);
      mockRepo.findEdgesByWorkflow.mockResolvedValueOnce([]);

      mockRepo.getNodeExecutionStatuses.mockResolvedValueOnce([{ status: 'completed' }]);
      mockRepo.findExecutionById.mockResolvedValueOnce(makeExecution({ status: 'completed' }));
      mockRepo.findNodeExecutionsByExecution.mockResolvedValueOnce([]);

      await dagWorkflowService.evaluateProjectChange('p1', 'budget_update', { utilization: 95 });

      expect(mockRepo.insertExecution).toHaveBeenCalled();
    });

    it('does not trigger when utilization is below threshold', async () => {
      mockRepo.checkTablesExist.mockResolvedValueOnce(true);

      const def = makeDef({ id: 'wf1' });
      mockRepo.findEnabledDefinitions.mockResolvedValueOnce([def]);

      const triggerNode = makeNode({
        nodeType: 'trigger',
        config: { triggerType: 'budget_threshold', thresholdPercent: 90 },
      });
      mockRepo.findDefinitionById.mockResolvedValueOnce(makeDef());
      mockRepo.findNodesByWorkflow.mockResolvedValueOnce([triggerNode]);
      mockRepo.findEdgesByWorkflow.mockResolvedValueOnce([]);

      await dagWorkflowService.evaluateProjectChange('p1', 'budget_update', { utilization: 50 });

      expect(mockRepo.insertExecution).not.toHaveBeenCalled();
    });

    it('triggers on project_status_change with matching status', async () => {
      mockRepo.checkTablesExist.mockResolvedValueOnce(true);

      const def = makeDef({ id: 'wf1' });
      mockRepo.findEnabledDefinitions.mockResolvedValueOnce([def]);

      const triggerNode = makeNode({
        nodeType: 'trigger',
        config: { triggerType: 'project_status_change', toStatus: 'at_risk' },
      });
      mockRepo.findDefinitionById.mockResolvedValueOnce(makeDef());
      mockRepo.findNodesByWorkflow.mockResolvedValueOnce([triggerNode]);
      mockRepo.findEdgesByWorkflow.mockResolvedValueOnce([]);

      mockRepo.getNodeExecutionStatuses.mockResolvedValueOnce([{ status: 'completed' }]);
      mockRepo.findExecutionById.mockResolvedValueOnce(makeExecution({ status: 'completed' }));
      mockRepo.findNodeExecutionsByExecution.mockResolvedValueOnce([]);

      await dagWorkflowService.evaluateProjectChange('p1', 'project_status_change', { newStatus: 'at_risk', oldStatus: 'on_track' });

      expect(mockRepo.insertExecution).toHaveBeenCalled();
    });

    it('skips project_status_change when toStatus does not match', async () => {
      mockRepo.checkTablesExist.mockResolvedValueOnce(true);

      const def = makeDef({ id: 'wf1' });
      mockRepo.findEnabledDefinitions.mockResolvedValueOnce([def]);

      const triggerNode = makeNode({
        nodeType: 'trigger',
        config: { triggerType: 'project_status_change', toStatus: 'at_risk' },
      });
      mockRepo.findDefinitionById.mockResolvedValueOnce(makeDef());
      mockRepo.findNodesByWorkflow.mockResolvedValueOnce([triggerNode]);
      mockRepo.findEdgesByWorkflow.mockResolvedValueOnce([]);

      await dagWorkflowService.evaluateProjectChange('p1', 'project_status_change', { newStatus: 'on_track' });

      expect(mockRepo.insertExecution).not.toHaveBeenCalled();
    });

    it('does nothing when tables do not exist', async () => {
      mockRepo.checkTablesExist.mockResolvedValueOnce(false);

      await dagWorkflowService.evaluateProjectChange('p1', 'budget_update', {});
      expect(mockRepo.findEnabledDefinitions).not.toHaveBeenCalled();
    });
  });

  // ── evaluateProposalEvent ─────────────────────────────────────────────

  describe('evaluateProposalEvent', () => {
    const proposalData = {
      proposalId: 'prop1',
      projectId: 'p1',
      agentId: 'agent1',
      confidenceScore: 0.9,
      riskLevel: 'low',
      title: 'Test Proposal',
    };

    it('triggers on matching proposal_created event', async () => {
      mockRepo.checkTablesExist.mockResolvedValueOnce(true);

      const def = makeDef();
      mockRepo.findEnabledDefinitions.mockResolvedValueOnce([def]);

      const triggerNode = makeNode({
        nodeType: 'trigger',
        config: { triggerType: 'proposal_created' },
      });
      mockRepo.findDefinitionById.mockResolvedValueOnce(makeDef());
      mockRepo.findNodesByWorkflow.mockResolvedValueOnce([triggerNode]);
      mockRepo.findEdgesByWorkflow.mockResolvedValueOnce([]);

      mockRepo.getNodeExecutionStatuses.mockResolvedValueOnce([{ status: 'completed' }]);
      mockRepo.findExecutionById.mockResolvedValueOnce(makeExecution({ status: 'completed' }));
      mockRepo.findNodeExecutionsByExecution.mockResolvedValueOnce([]);

      await dagWorkflowService.evaluateProposalEvent('proposal_created', proposalData);

      expect(mockRepo.insertExecution).toHaveBeenCalled();
    });

    it('filters by agentId when specified in config', async () => {
      mockRepo.checkTablesExist.mockResolvedValueOnce(true);

      const def = makeDef();
      mockRepo.findEnabledDefinitions.mockResolvedValueOnce([def]);

      const triggerNode = makeNode({
        nodeType: 'trigger',
        config: { triggerType: 'proposal_created', agentId: 'other_agent' },
      });
      mockRepo.findDefinitionById.mockResolvedValueOnce(makeDef());
      mockRepo.findNodesByWorkflow.mockResolvedValueOnce([triggerNode]);
      mockRepo.findEdgesByWorkflow.mockResolvedValueOnce([]);

      await dagWorkflowService.evaluateProposalEvent('proposal_created', proposalData);

      expect(mockRepo.insertExecution).not.toHaveBeenCalled();
    });

    it('filters by minConfidence when specified', async () => {
      mockRepo.checkTablesExist.mockResolvedValueOnce(true);

      const def = makeDef();
      mockRepo.findEnabledDefinitions.mockResolvedValueOnce([def]);

      const triggerNode = makeNode({
        nodeType: 'trigger',
        config: { triggerType: 'proposal_created', minConfidence: 0.95 },
      });
      mockRepo.findDefinitionById.mockResolvedValueOnce(makeDef());
      mockRepo.findNodesByWorkflow.mockResolvedValueOnce([triggerNode]);
      mockRepo.findEdgesByWorkflow.mockResolvedValueOnce([]);

      await dagWorkflowService.evaluateProposalEvent('proposal_created', { ...proposalData, confidenceScore: 0.8 });

      expect(mockRepo.insertExecution).not.toHaveBeenCalled();
    });

    it('filters by riskLevel when specified', async () => {
      mockRepo.checkTablesExist.mockResolvedValueOnce(true);

      const def = makeDef();
      mockRepo.findEnabledDefinitions.mockResolvedValueOnce([def]);

      const triggerNode = makeNode({
        nodeType: 'trigger',
        config: { triggerType: 'proposal_created', riskLevel: 'high' },
      });
      mockRepo.findDefinitionById.mockResolvedValueOnce(makeDef());
      mockRepo.findNodesByWorkflow.mockResolvedValueOnce([triggerNode]);
      mockRepo.findEdgesByWorkflow.mockResolvedValueOnce([]);

      await dagWorkflowService.evaluateProposalEvent('proposal_created', proposalData);

      expect(mockRepo.insertExecution).not.toHaveBeenCalled();
    });

    it('does not trigger when event type does not match trigger config', async () => {
      mockRepo.checkTablesExist.mockResolvedValueOnce(true);

      const def = makeDef();
      mockRepo.findEnabledDefinitions.mockResolvedValueOnce([def]);

      const triggerNode = makeNode({
        nodeType: 'trigger',
        config: { triggerType: 'proposal_executed' },
      });
      mockRepo.findDefinitionById.mockResolvedValueOnce(makeDef());
      mockRepo.findNodesByWorkflow.mockResolvedValueOnce([triggerNode]);
      mockRepo.findEdgesByWorkflow.mockResolvedValueOnce([]);

      await dagWorkflowService.evaluateProposalEvent('proposal_created', proposalData);

      expect(mockRepo.insertExecution).not.toHaveBeenCalled();
    });
  });

  // ── triggerManual ─────────────────────────────────────────────────────

  describe('triggerManual', () => {
    it('returns null when definition not found', async () => {
      mockRepo.checkTablesExist.mockResolvedValueOnce(true);
      mockRepo.findDefinitionById.mockResolvedValueOnce(null);

      const result = await dagWorkflowService.triggerManual('nonexistent', 'task', 't1', {} as any);
      expect(result).toBeNull();
    });

    it('returns null when definition has no trigger node', async () => {
      const actionNode = makeNode({ nodeType: 'action', config: { actionType: 'log_activity' } });
      mockRepo.checkTablesExist.mockResolvedValueOnce(true);
      mockRepo.findDefinitionById.mockResolvedValueOnce(makeDef());
      mockRepo.findNodesByWorkflow.mockResolvedValueOnce([actionNode]);
      mockRepo.findEdgesByWorkflow.mockResolvedValueOnce([]);

      const result = await dagWorkflowService.triggerManual('wf1', 'task', 't1', {} as any);
      expect(result).toBeNull();
    });

    it('looks up task when entityType is task', async () => {
      const triggerNode = makeNode({ nodeType: 'trigger', config: { triggerType: 'manual' } });
      mockRepo.checkTablesExist.mockResolvedValueOnce(true);
      mockRepo.findDefinitionById.mockResolvedValueOnce(makeDef());
      mockRepo.findNodesByWorkflow.mockResolvedValueOnce([triggerNode]);
      mockRepo.findEdgesByWorkflow.mockResolvedValueOnce([]);

      mockScheduleService.findTaskById.mockResolvedValueOnce(makeTask());
      mockRepo.getNodeExecutionStatuses.mockResolvedValueOnce([{ status: 'completed' }]);
      mockRepo.findExecutionById.mockResolvedValueOnce(makeExecution({ status: 'completed' }));
      mockRepo.findNodeExecutionsByExecution.mockResolvedValueOnce([]);

      await dagWorkflowService.triggerManual('wf1', 'task', 't1', {} as any);

      expect(mockScheduleService.findTaskById).toHaveBeenCalledWith('t1');
    });
  });

  // ── resumeExecution ───────────────────────────────────────────────────

  describe('resumeExecution', () => {
    it('returns null when execution not found', async () => {
      mockRepo.checkTablesExist.mockResolvedValueOnce(true);
      mockRepo.findExecutionById.mockResolvedValueOnce(null);

      const result = await dagWorkflowService.resumeExecution('exec1', 'n1', {}, {} as any);
      expect(result).toBeNull();
    });

    it('returns null when execution is not in waiting status', async () => {
      mockRepo.checkTablesExist.mockResolvedValueOnce(true);
      mockRepo.findExecutionById.mockResolvedValueOnce(makeExecution({ status: 'running' }));
      mockRepo.findNodeExecutionsByExecution.mockResolvedValueOnce([]);

      const result = await dagWorkflowService.resumeExecution('exec1', 'n1', {}, {} as any);
      expect(result).toBeNull();
    });

    it('resumes a waiting execution', async () => {
      const exec = makeExecution({ status: 'waiting', workflowId: 'wf1', entityType: 'task', entityId: 't1' });
      const nodeExecs = [
        makeNodeExecution({ nodeId: 'n1', status: 'completed', outputData: { result: true } }),
        makeNodeExecution({ nodeId: 'n2', status: 'waiting', id: 'ne2' }),
      ];

      // getExecution (first call)
      mockRepo.checkTablesExist.mockResolvedValueOnce(true);
      mockRepo.findExecutionById.mockResolvedValueOnce(exec);
      mockRepo.findNodeExecutionsByExecution.mockResolvedValueOnce(nodeExecs);

      // getDefinition
      mockRepo.findDefinitionById.mockResolvedValueOnce(makeDef());
      mockRepo.findNodesByWorkflow.mockResolvedValueOnce([
        makeNode({ id: 'n1', nodeType: 'trigger' }),
        makeNode({ id: 'n2', nodeType: 'approval' }),
      ]);
      mockRepo.findEdgesByWorkflow.mockResolvedValueOnce([]);

      // scheduleService.findTaskById
      mockScheduleService.findTaskById.mockResolvedValueOnce(makeTask());

      // advanceExecution -> checkCompletion
      mockRepo.getNodeExecutionStatuses.mockResolvedValueOnce([
        { status: 'completed' },
        { status: 'completed' },
      ]);

      // getExecution (final return)
      mockRepo.findExecutionById.mockResolvedValueOnce(makeExecution({ status: 'completed' }));
      mockRepo.findNodeExecutionsByExecution.mockResolvedValueOnce([]);

      const result = await dagWorkflowService.resumeExecution('exec1', 'n2', { approved: true }, {} as any);

      expect(mockRepo.completeWaitingNodeExecution).toHaveBeenCalledWith('exec1', 'n2', JSON.stringify({ approved: true }));
      expect(mockRepo.updateExecutionStatus).toHaveBeenCalledWith('exec1', 'running');
      expect(result).toBeDefined();
    });

    it('returns null when workflow definition not found', async () => {
      const exec = makeExecution({ status: 'waiting' });
      mockRepo.checkTablesExist.mockResolvedValueOnce(true);
      mockRepo.findExecutionById.mockResolvedValueOnce(exec);
      mockRepo.findNodeExecutionsByExecution.mockResolvedValueOnce([]);

      // getDefinition returns null
      mockRepo.findDefinitionById.mockResolvedValueOnce(null);

      const result = await dagWorkflowService.resumeExecution('exec1', 'n1', {}, {} as any);
      expect(result).toBeNull();
    });
  });

  // ── Audit & dead letter on executeWorkflow ────────────────────────────

  describe('audit logging', () => {
    it('captures audit failure to dead letter queue', async () => {
      mockRepo.checkTablesExist.mockResolvedValueOnce(true);

      const def = makeDef();
      mockRepo.findEnabledDefinitions.mockResolvedValueOnce([def]);

      const triggerNode = makeNode({
        nodeType: 'trigger',
        config: { triggerType: 'task_created' },
      });
      mockRepo.findDefinitionById.mockResolvedValueOnce(makeDef());
      mockRepo.findNodesByWorkflow.mockResolvedValueOnce([triggerNode]);
      mockRepo.findEdgesByWorkflow.mockResolvedValueOnce([]);

      mockRepo.getNodeExecutionStatuses.mockResolvedValueOnce([{ status: 'completed' }]);
      mockRepo.findExecutionById.mockResolvedValueOnce(makeExecution({ status: 'completed' }));
      mockRepo.findNodeExecutionsByExecution.mockResolvedValueOnce([]);

      const auditError = new Error('Audit DB down');
      mockAudit.append.mockRejectedValueOnce(auditError);

      const newTask = makeTask();
      await dagWorkflowService.evaluateTaskChange(newTask, null, {} as any);

      // Give the .catch handler a tick to fire
      await new Promise(r => setTimeout(r, 10));

      expect(mockDead.capture).toHaveBeenCalledWith(
        'audit.workflow_trigger',
        expect.objectContaining({ workflowId: 'wf1' }),
        auditError,
      );
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 3: Row mappers
// ═══════════════════════════════════════════════════════════════════════════

import { parseJson, rowToDef, rowToNode, rowToEdge, rowToExecution, rowToNodeExec } from '../../services/dagWorkflow/rowMappers';

describe('rowMappers', () => {
  describe('parseJson', () => {
    it('parses valid JSON string', () => {
      expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    });

    it('returns object as-is when not a string', () => {
      const obj = { a: 1 };
      expect(parseJson(obj)).toBe(obj);
    });

    it('returns empty object for null/undefined', () => {
      expect(parseJson(null)).toEqual({});
      expect(parseJson(undefined)).toEqual({});
    });

    it('returns empty object for invalid JSON string', () => {
      expect(parseJson('not json')).toEqual({});
    });
  });

  describe('rowToDef', () => {
    it('maps database row to WorkflowDefinition', () => {
      const row = {
        id: 'wf1',
        project_id: 'p1',
        name: 'My Workflow',
        description: 'desc',
        is_enabled: 1,
        version: 2,
        created_by: 'u1',
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-02'),
      };
      const result = rowToDef(row);
      expect(result.id).toBe('wf1');
      expect(result.projectId).toBe('p1');
      expect(result.isEnabled).toBe(true);
      expect(result.version).toBe(2);
    });

    it('handles null project_id', () => {
      const row = {
        id: 'wf1', project_id: null, name: 'X', description: null,
        is_enabled: 0, version: 1, created_by: 'u1',
        created_at: '2026-01-01', updated_at: '2026-01-01',
      };
      const result = rowToDef(row);
      expect(result.projectId).toBeNull();
      expect(result.isEnabled).toBe(false);
    });
  });

  describe('rowToNode', () => {
    it('maps database row to WorkflowNode', () => {
      const row = {
        id: 'n1', workflow_id: 'wf1', node_type: 'action',
        name: 'My Action', config: '{"actionType":"log_activity"}',
        position_x: 10, position_y: 20, created_at: '2026-01-01',
      };
      const result = rowToNode(row);
      expect(result.nodeType).toBe('action');
      expect(result.config).toEqual({ actionType: 'log_activity' });
      expect(result.positionX).toBe(10);
    });
  });

  describe('rowToEdge', () => {
    it('maps database row to WorkflowEdge', () => {
      const row = {
        id: 'e1', workflow_id: 'wf1',
        source_node_id: 'n1', target_node_id: 'n2',
        condition_expr: '{"field":"status","operator":"equals","value":"done"}',
        label: 'yes', sort_order: 1,
      };
      const result = rowToEdge(row);
      expect(result.sourceNodeId).toBe('n1');
      expect(result.conditionExpr).toEqual({ field: 'status', operator: 'equals', value: 'done' });
      expect(result.label).toBe('yes');
    });

    it('handles null condition_expr', () => {
      const row = {
        id: 'e1', workflow_id: 'wf1',
        source_node_id: 'n1', target_node_id: 'n2',
        condition_expr: null, label: null, sort_order: 0,
      };
      const result = rowToEdge(row);
      expect(result.conditionExpr).toBeNull();
    });
  });

  describe('rowToExecution', () => {
    it('maps database row to WorkflowExecution', () => {
      const row = {
        id: 'exec1', workflow_id: 'wf1', trigger_node_id: 'n1',
        entity_type: 'task', entity_id: 't1',
        status: 'running', context: '{"taskId":"t1"}',
        started_at: '2026-01-01', completed_at: null,
        error_message: null,
      };
      const result = rowToExecution(row);
      expect(result.status).toBe('running');
      expect(result.context).toEqual({ taskId: 't1' });
      expect(result.completedAt).toBeNull();
    });
  });

  describe('rowToNodeExec', () => {
    it('maps database row to WorkflowNodeExecution', () => {
      const row = {
        id: 'ne1', execution_id: 'exec1', node_id: 'n1',
        status: 'completed',
        input_data: '{"taskId":"t1"}',
        output_data: '{"result":true}',
        error_message: null,
        started_at: '2026-01-01', completed_at: '2026-01-02',
      };
      const result = rowToNodeExec(row);
      expect(result.inputData).toEqual({ taskId: 't1' });
      expect(result.outputData).toEqual({ result: true });
    });

    it('handles null input/output data', () => {
      const row = {
        id: 'ne1', execution_id: 'exec1', node_id: 'n1',
        status: 'pending', input_data: null, output_data: null,
        error_message: null, started_at: null, completed_at: null,
      };
      const result = rowToNodeExec(row);
      expect(result.inputData).toBeNull();
      expect(result.outputData).toBeNull();
      expect(result.startedAt).toBeNull();
    });
  });
});
