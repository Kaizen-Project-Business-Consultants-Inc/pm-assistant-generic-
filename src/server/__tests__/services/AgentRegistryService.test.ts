import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { resolveTemplates } from '../../services/DagWorkflowService';

// Mock dependencies before importing the registry
vi.mock('../../database/connection', () => ({
  databaseService: {
    query: vi.fn().mockResolvedValue([]),
    testConnection: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../../services/AuditLedgerService', () => ({
  auditLedgerService: {
    append: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../services/PolicyEngineService', () => ({
  policyEngineService: {
    evaluate: vi.fn().mockResolvedValue({ allowed: true, enforcement: 'allowed', matchedPolicies: [] }),
  },
}));

vi.mock('../../config', () => ({
  config: { APP_URL: 'https://pm.kpbc.ca' },
}));

vi.mock('../../services/WebSocketService', () => ({
  WebSocketService: { sendToUser: vi.fn(), broadcast: vi.fn() },
}));

vi.mock('../../services/EmailService', () => ({
  emailService: { sendNotificationEmail: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../services/UserService', () => ({
  userService: { findById: vi.fn().mockResolvedValue(null) },
}));

import { agentRegistry, type AgentCapability, type InvocationContext } from '../../services/AgentRegistryService';
import { auditLedgerService } from '../../services/AuditLedgerService';
import { policyEngineService } from '../../services/PolicyEngineService';

function makeCapability(overrides: Partial<AgentCapability> = {}): AgentCapability {
  return {
    id: 'test-agent-v1',
    capability: 'test.action',
    version: '1.0.0',
    description: 'Test agent',
    inputSchema: z.object({ value: z.string() }),
    outputSchema: z.object({ result: z.string() }),
    permissions: [],
    timeoutMs: 5000,
    handler: vi.fn().mockResolvedValue({ result: 'ok' }),
    ...overrides,
  };
}

const ctx: InvocationContext = {
  actorId: 'system',
  actorType: 'system',
  source: 'system',
  projectId: 'proj-1',
};

describe('AgentRegistry', () => {
  beforeEach(() => {
    agentRegistry.clear();
    vi.clearAllMocks();
  });

  // --- register ---
  describe('register', () => {
    it('registers a capability', () => {
      const cap = makeCapability();
      agentRegistry.register(cap);
      expect(agentRegistry.get('test-agent-v1')).toBe(cap);
    });

    it('throws on duplicate id', () => {
      agentRegistry.register(makeCapability());
      expect(() => agentRegistry.register(makeCapability())).toThrow('already registered');
    });
  });

  // --- get / findByCapability ---
  describe('get / findByCapability', () => {
    it('returns undefined for unknown id', () => {
      expect(agentRegistry.get('nonexistent')).toBeUndefined();
    });

    it('finds by exact capability name', () => {
      const cap = makeCapability({ id: 'a1', capability: 'schedule.optimize' });
      agentRegistry.register(cap);
      const found = agentRegistry.findByCapability('schedule.optimize');
      expect(found).toHaveLength(1);
      expect(found[0].id).toBe('a1');
    });

    it('returns empty for no match', () => {
      agentRegistry.register(makeCapability());
      expect(agentRegistry.findByCapability('nonexistent')).toHaveLength(0);
    });
  });

  // --- listAll ---
  describe('listAll', () => {
    it('returns all registered capabilities', () => {
      agentRegistry.register(makeCapability({ id: 'a1' }));
      agentRegistry.register(makeCapability({ id: 'a2', capability: 'other' }));
      expect(agentRegistry.listAll()).toHaveLength(2);
    });
  });

  // --- invoke: validation ---
  describe('invoke — validation', () => {
    it('rejects invalid input', async () => {
      agentRegistry.register(makeCapability());
      const result = await agentRegistry.invoke('test-agent-v1', { value: 123 }, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Input validation failed');
    });

    it('rejects invalid output', async () => {
      const cap = makeCapability({
        handler: vi.fn().mockResolvedValue({ bad: 'schema' }),
        outputSchema: z.object({ result: z.string() }),
      });
      agentRegistry.register(cap);
      const result = await agentRegistry.invoke('test-agent-v1', { value: 'hello' }, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Output validation failed');
    });
  });

  // --- invoke: policy ---
  describe('invoke — policy', () => {
    it('blocks when policy denies', async () => {
      vi.mocked(policyEngineService.evaluate).mockResolvedValueOnce({
        allowed: false,
        enforcement: 'blocked',
        matchedPolicies: [{ policyId: 'p1', policyName: 'Block agents', enforcement: 'block' }],
      });
      agentRegistry.register(makeCapability());
      const result = await agentRegistry.invoke('test-agent-v1', { value: 'hello' }, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Policy blocked');
    });
  });

  // --- invoke: execution ---
  describe('invoke — execution', () => {
    it('calls handler and returns output with duration', async () => {
      const handler = vi.fn().mockResolvedValue({ result: 'done' });
      agentRegistry.register(makeCapability({ handler }));
      const result = await agentRegistry.invoke('test-agent-v1', { value: 'hello' }, ctx);
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ result: 'done' });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(handler).toHaveBeenCalledWith({ value: 'hello' });
    });
  });

  // --- invoke: timeout ---
  describe('invoke — timeout', () => {
    it('rejects handlers exceeding timeout', async () => {
      const handler = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ result: 'late' }), 10000)),
      );
      agentRegistry.register(makeCapability({ handler, timeoutMs: 50 }));
      const result = await agentRegistry.invoke('test-agent-v1', { value: 'hello' }, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
    });
  });

  // --- invoke: audit ---
  describe('invoke — audit', () => {
    it('appends to audit ledger on success', async () => {
      agentRegistry.register(makeCapability());
      await agentRegistry.invoke('test-agent-v1', { value: 'hello' }, ctx);
      expect(auditLedgerService.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'agent.invoke.success',
          entityType: 'agent',
          entityId: 'test-agent-v1',
        }),
      );
    });

    it('appends to audit ledger on error', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('boom'));
      agentRegistry.register(makeCapability({ handler }));
      await agentRegistry.invoke('test-agent-v1', { value: 'hello' }, ctx);
      expect(auditLedgerService.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'agent.invoke.failure',
          entityType: 'agent',
          entityId: 'test-agent-v1',
        }),
      );
    });
  });

  // --- invoke: unknown capability ---
  describe('invoke — unknown', () => {
    it('returns error for unregistered capability', async () => {
      const result = await agentRegistry.invoke('nonexistent', {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown capability');
    });
  });
});

// ── resolveTemplates ──────────────────────────────────────────────────────

describe('resolveTemplates', () => {
  const task = { id: 'task-1', name: 'My Task', status: 'in_progress', progressPercentage: 50 } as any;
  const nodeOutputs: Record<string, any> = {
    'node-a': { agentOutput: { forecast: 42, details: { confidence: 0.95 } }, durationMs: 100 },
  };

  it('resolves {{task.id}} from task context', () => {
    const result = resolveTemplates({ taskId: '{{task.id}}' }, {}, task);
    expect(result.taskId).toBe('task-1');
  });

  it('resolves {{task.name}} preserving string type', () => {
    const result = resolveTemplates({ label: '{{task.name}}' }, {}, task);
    expect(result.label).toBe('My Task');
  });

  it('resolves {{nodes.<id>.agentOutput.field}} from node outputs', () => {
    const result = resolveTemplates(
      { value: '{{nodes.node-a.agentOutput.forecast}}' },
      nodeOutputs,
      null,
    );
    expect(result.value).toBe(42);
  });

  it('resolves deeply nested node output paths', () => {
    const result = resolveTemplates(
      { conf: '{{nodes.node-a.agentOutput.details.confidence}}' },
      nodeOutputs,
      null,
    );
    expect(result.conf).toBe(0.95);
  });

  it('does mixed string interpolation', () => {
    const result = resolveTemplates(
      { msg: 'Project {{task.name}} is {{task.status}}' },
      {},
      task,
    );
    expect(result.msg).toBe('Project My Task is in_progress');
  });

  it('preserves non-template values unchanged', () => {
    const result = resolveTemplates(
      { plain: 'hello', num: 42, nested: { keep: true } },
      {},
      task,
    );
    expect(result).toEqual({ plain: 'hello', num: 42, nested: { keep: true } });
  });

  it('leaves unresolved templates as-is', () => {
    const result = resolveTemplates(
      { missing: '{{nodes.unknown.value}}', also: '{{task.nonexistent}}' },
      {},
      task,
    );
    expect(result.missing).toBe('{{nodes.unknown.value}}');
    expect(result.also).toBe('{{task.nonexistent}}');
  });

  it('handles null task gracefully', () => {
    const result = resolveTemplates({ x: '{{task.id}}' }, {}, null);
    expect(result.x).toBe('{{task.id}}');
  });
});

// ── Output piping (integration-style) ────────────────────────────────────

describe('Output piping via resolveTemplates', () => {
  it('chains output from one node into input of another', () => {
    const nodeOutputs: Record<string, any> = {};

    // Simulate first node completing
    nodeOutputs['step-1'] = { agentOutput: { scheduleId: 'sched-99' }, durationMs: 50 };

    // Second node resolves templates referencing first node
    const input = resolveTemplates(
      { scheduleId: '{{nodes.step-1.agentOutput.scheduleId}}' },
      nodeOutputs,
      null,
    );
    expect(input.scheduleId).toBe('sched-99');
  });

  it('supports multiple node references in one input', () => {
    const nodeOutputs: Record<string, any> = {
      'a': { agentOutput: { x: 1 } },
      'b': { agentOutput: { y: 2 } },
    };
    const input = resolveTemplates(
      { x: '{{nodes.a.agentOutput.x}}', y: '{{nodes.b.agentOutput.y}}' },
      nodeOutputs,
      null,
    );
    expect(input.x).toBe(1);
    expect(input.y).toBe(2);
  });
});

// ── Retry logic (unit-style) ─────────────────────────────────────────────

describe('Agent retry logic', () => {
  it('succeeds on first try with 0 retries', async () => {
    const handler = vi.fn().mockResolvedValue({ result: 'ok' });
    agentRegistry.clear();
    agentRegistry.register(makeCapability({ id: 'retry-test-v1', handler }));

    const result = await agentRegistry.invoke('retry-test-v1', { value: 'hi' }, ctx);
    expect(result.success).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('simulates fail-then-succeed pattern used by retry loop', async () => {
    const handler = vi.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({ result: 'recovered' });
    agentRegistry.clear();
    agentRegistry.register(makeCapability({ id: 'retry-sim-v1', handler }));

    // First call fails
    const r1 = await agentRegistry.invoke('retry-sim-v1', { value: 'hi' }, ctx);
    expect(r1.success).toBe(false);

    // Second call succeeds (simulating retry)
    const r2 = await agentRegistry.invoke('retry-sim-v1', { value: 'hi' }, ctx);
    expect(r2.success).toBe(true);
    expect(r2.output).toEqual({ result: 'recovered' });
  });

  it('all retries exhausted yields failure', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('permanent'));
    agentRegistry.clear();
    agentRegistry.register(makeCapability({ id: 'retry-fail-v1', handler }));

    // Simulate 3 attempts all failing
    for (let i = 0; i < 3; i++) {
      const r = await agentRegistry.invoke('retry-fail-v1', { value: 'hi' }, ctx);
      expect(r.success).toBe(false);
    }
    expect(handler).toHaveBeenCalledTimes(3);
  });
});
