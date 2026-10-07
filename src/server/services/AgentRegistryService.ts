import { z, ZodSchema } from 'zod';
import { policyEngineService, type EvaluationContext } from './PolicyEngineService';
import { auditLedgerService } from './AuditLedgerService';
import { agentMemoryService } from './AgentMemoryService';
import { agentRepository } from '../database/AgentRepository';
import logger from '../utils/logger';
import { deadLetterService } from './DeadLetterService';
import { MS_PER_MINUTE } from '../utils/constants';

export interface AgentCapability {
  id: string;
  capability: string;
  version: string;
  description: string;
  inputSchema: ZodSchema;
  outputSchema: ZodSchema;
  permissions: string[];
  timeoutMs?: number;
  /** `context.projectId` is the project the agent runs for (a project's workflow: always its own) */
  handler: (input: any, context?: { projectId?: string | null }) => Promise<any>;
}

export interface InvocationResult {
  success: boolean;
  output?: any;
  error?: string;
  durationMs: number;
  capabilityId: string;
}

export interface InvocationContext {
  actorId: string;
  actorType: 'user' | 'api_key' | 'system';
  source: 'web' | 'mcp' | 'api' | 'system';
  projectId?: string;
}

export class AgentRegistry {
  private capabilities = new Map<string, AgentCapability>();

  register(cap: AgentCapability): void {
    if (this.capabilities.has(cap.id)) {
      throw new Error(`Agent capability "${cap.id}" is already registered`);
    }
    this.capabilities.set(cap.id, cap);
    logger.info(`[AgentRegistry] Registered: ${cap.id} (${cap.capability})`);
  }

  unregister(id: string): void {
    this.capabilities.delete(id);
  }

  get(id: string): AgentCapability | undefined {
    return this.capabilities.get(id);
  }

  findByCapability(name: string): AgentCapability[] {
    const results: AgentCapability[] = [];
    for (const cap of this.capabilities.values()) {
      if (cap.capability === name || cap.capability.startsWith(name + '.') || name.startsWith(cap.capability + '.')) {
        results.push(cap);
      }
    }
    return results;
  }

  listAll(): AgentCapability[] {
    return Array.from(this.capabilities.values());
  }

  async invoke(
    capabilityId: string,
    input: unknown,
    context: InvocationContext,
  ): Promise<InvocationResult> {
    const cap = this.capabilities.get(capabilityId);
    if (!cap) {
      return { success: false, error: `Unknown capability: ${capabilityId}`, durationMs: 0, capabilityId };
    }

    // 0. Check if agent is enabled in the database
    try {
      const agentRecord = await agentRepository.findById(capabilityId);
      if (agentRecord && !agentRecord.isEnabled) {
        return { success: false, error: `Agent "${capabilityId}" is disabled`, durationMs: 0, capabilityId };
      }
    } catch {
      // DB unavailable — proceed (code-registered agents still work)
    }

    const start = Date.now();

    // 1. Validate input
    const inputResult = cap.inputSchema.safeParse(input);
    if (!inputResult.success) {
      const error = `Input validation failed: ${inputResult.error.message}`;
      await this.audit(cap, context, false, error, 0);
      return { success: false, error, durationMs: Date.now() - start, capabilityId };
    }

    // 2. Policy gate
    const policyCtx: EvaluationContext = {
      actorId: context.actorId,
      entityType: 'agent',
      entityId: capabilityId,
      projectId: context.projectId,
    };
    try {
      const policyResult = await policyEngineService.evaluate(`agent.invoke.${cap.capability}`, policyCtx);
      if (!policyResult.allowed) {
        const error = `Policy blocked: ${policyResult.matchedPolicies.map(p => p.policyName).join(', ')}`;
        await this.audit(cap, context, false, error, Date.now() - start);
        return { success: false, error, durationMs: Date.now() - start, capabilityId };
      }
    } catch {
      // Policy engine failure is non-blocking — proceed
    }

    // 3. Execute with timeout
    const timeoutMs = cap.timeoutMs ?? MS_PER_MINUTE;
    let output: any;
    // the timer is cleared when the work finishes — it used to keep a finished nightly job's
    // process alive for up to its full length (2026-10-07: ~100 s after the scan ended)
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      output = await Promise.race([
        cap.handler(inputResult.data, { projectId: context.projectId ?? null }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Agent timeout after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
    } catch (err: any) {
      const error = err.message || 'Agent execution failed';
      await this.audit(cap, context, false, error, Date.now() - start);
      return { success: false, error, durationMs: Date.now() - start, capabilityId };
    } finally {
      if (timer) clearTimeout(timer);
    }

    // 4. Validate output
    const outputResult = cap.outputSchema.safeParse(output);
    if (!outputResult.success) {
      const error = `Output validation failed: ${outputResult.error.message}`;
      await this.audit(cap, context, false, error, Date.now() - start);
      return { success: false, error, durationMs: Date.now() - start, capabilityId };
    }

    const durationMs = Date.now() - start;
    await this.audit(cap, context, true, undefined, durationMs);

    // Store reflection (fire-and-forget)
    agentMemoryService.storeReflection(
      capabilityId,
      context.projectId || null,
      {
        action: cap.capability,
        decision: capabilityId,
        reasoning: `Invoked by ${context.actorType}:${context.actorId} via ${context.source}`,
        outcome: `Success in ${durationMs}ms`,
        timestamp: new Date().toISOString(),
      },
    ).catch(err => deadLetterService.capture('agent.reflection', { capabilityId, projectId: context.projectId }, err));

    return { success: true, output: outputResult.data, durationMs, capabilityId };
  }

  clear(): void {
    this.capabilities.clear();
  }

  private async audit(
    cap: AgentCapability,
    context: InvocationContext,
    success: boolean,
    error: string | undefined,
    durationMs: number,
  ): Promise<void> {
    try {
      await auditLedgerService.append({
        actorId: context.actorId,
        actorType: context.actorType,
        action: success ? 'agent.invoke.success' : 'agent.invoke.failure',
        entityType: 'agent',
        entityId: cap.id,
        projectId: context.projectId ?? null,
        payload: { capability: cap.capability, durationMs, error },
        source: context.source,
      });
    } catch {
      // Audit failure is non-blocking
    }
  }
}

export const agentRegistry = new AgentRegistry();
