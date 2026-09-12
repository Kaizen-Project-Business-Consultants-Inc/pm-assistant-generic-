import { automationRepository } from '../../database/AutomationRepository';
import { automationExecutionRepository } from '../../database/AutomationExecutionRepository';
import { automationCooldownRepository } from '../../database/AutomationCooldownRepository';
import { evaluateConditions, evaluateConditionsWithTrace } from './conditionEvaluator';
import { resolveTemplate } from './templateResolver';
import { executeAction } from './actionExecutors';
import { buildContext } from './contextBuilder';
import type { AutomationEvent, AutomationRule, AutomationContext } from './types';
import logger from '../../utils/logger';

const MAX_RECURSION_DEPTH = 3;

export class AutomationEventBus {
  async emit(event: AutomationEvent): Promise<void> {
    const depth = event.recursionDepth ?? 0;
    if (depth >= MAX_RECURSION_DEPTH) {
      logger.warn(`[AutomationEventBus] Recursion guard: depth ${depth} for ${event.type}, skipping`);
      return;
    }

    logger.info(`[AutomationEventBus] Event received: ${event.type} entity=${event.entityId} project=${event.projectId}`);

    let automations: AutomationRule[];
    try {
      automations = await automationRepository.findActiveByTrigger(event.type);
    } catch (err) {
      logger.error('[AutomationEventBus] Failed to query automations:', err);
      return;
    }

    const projectScoped = automations.filter(a => a.projectId === event.projectId && a.scope !== 'portfolio');

    // Also query portfolio-scoped automations (fire for any project)
    let portfolioScoped: AutomationRule[] = [];
    try {
      portfolioScoped = await automationRepository.findActivePortfolioByTrigger(event.type);
    } catch (err) {
      logger.error('[AutomationEventBus] Failed to query portfolio automations:', err);
    }

    const matching = [...projectScoped, ...portfolioScoped];
    if (matching.length === 0) return;

    for (const automation of matching) {
      this.processAutomation(automation, event).catch(err => {
        logger.error(`[AutomationEventBus] Failed to process automation ${automation.id}:`, err);
      });
    }
  }

  private async processAutomation(automation: AutomationRule, event: AutomationEvent): Promise<void> {
    const startTime = Date.now();
    const cooldownKey = `${event.entityType}:${event.entityId}`;

    // Cooldown check
    if (automation.cooldownSeconds > 0) {
      const cooldown = await automationCooldownRepository.get(automation.id, cooldownKey);
      if (cooldown) {
        const elapsed = (Date.now() - new Date(cooldown.lastFiredAt).getTime()) / 1000;
        if (elapsed < automation.cooldownSeconds) {
          logger.info(`[AutomationEventBus] Cooldown active for automation ${automation.id}, skipping (${elapsed.toFixed(0)}s < ${automation.cooldownSeconds}s)`);
          return;
        }
      }
    }

    // Max runs per day check
    const todayCount = await automationExecutionRepository.countTodayByAutomation(automation.id);
    if (todayCount >= automation.maxRunsPerDay) {
      logger.warn(`[AutomationEventBus] Max runs/day (${automation.maxRunsPerDay}) reached for automation ${automation.id}`);
      return;
    }

    // Build context
    let context: AutomationContext;
    try {
      context = await buildContext(event);
    } catch (err) {
      logger.error(`[AutomationEventBus] Failed to build context for automation ${automation.id}:`, err);
      return;
    }

    // Evaluate conditions
    if (automation.definition.conditions) {
      const conditionsMet = evaluateConditions(automation.definition.conditions, context);
      if (!conditionsMet) {
        logger.info(`[AutomationEventBus] Conditions not met for automation ${automation.id}, skipping`);
        return;
      }
    }

    // Insert execution record
    const execId = await automationExecutionRepository.insert({
      automationId: automation.id,
      eventType: event.type,
      eventPayload: event.payload,
      triggeredBy: event.userId,
      recursionDepth: event.recursionDepth ?? 0,
    });

    // Initialize AI outputs container for ai_generate → template chaining
    if (!context._aiOutputs) context._aiOutputs = {};

    // Execute actions in order
    const actions = [...automation.definition.actions].sort((a, b) => a.runOrder - b.runOrder);
    let actionsExecuted = 0;
    let actionsFailed = 0;
    const results: Record<string, any>[] = [];
    let lastError: string | null = null;

    for (const action of actions) {
      try {
        const resolvedParams = resolveTemplate(action.params, context);
        await executeAction(action.type, resolvedParams, context, event);
        actionsExecuted++;
        results.push({ actionId: action.id, type: action.type, status: 'success' });
      } catch (err: any) {
        actionsFailed++;
        lastError = err.message || String(err);
        results.push({ actionId: action.id, type: action.type, status: 'failed', error: lastError });
        logger.error(`[AutomationEventBus] Action ${action.type} failed for automation ${automation.id}:`, lastError);
        if (action.haltOnFailure) break;
      }
    }

    const durationMs = Date.now() - startTime;
    const status = actionsFailed > 0 ? (actionsExecuted > 0 ? 'completed' : 'failed') : 'completed';

    await automationExecutionRepository.complete(execId, {
      status: status as 'completed' | 'failed',
      actionsExecuted,
      actionsFailed,
      result: { actions: results },
      errorMessage: lastError || undefined,
      durationMs,
    });

    await automationRepository.updateStats(automation.id, { lastError });

    if (automation.cooldownSeconds > 0) {
      await automationCooldownRepository.upsert(automation.id, cooldownKey);
    }

    logger.info(`[AutomationEventBus] Automation ${automation.id} executed: ${actionsExecuted} OK, ${actionsFailed} failed, ${durationMs}ms`);
  }

  async dryRun(automation: AutomationRule, event: AutomationEvent): Promise<{
    conditionsMet: boolean;
    conditionTrace?: import('./types').ConditionTraceNode;
    actionsWouldRun: { type: string; resolvedParams: Record<string, any> }[];
  }> {
    let context: AutomationContext;
    try {
      context = await buildContext(event);
    } catch {
      context = { event, entity: event.payload };
    }

    let conditionsMet = true;
    let conditionTrace: import('./types').ConditionTraceNode | undefined;

    if (automation.definition.conditions) {
      const traceResult = evaluateConditionsWithTrace(automation.definition.conditions, context);
      conditionsMet = traceResult.passed;
      conditionTrace = traceResult;
    }

    const actions = [...automation.definition.actions].sort((a, b) => a.runOrder - b.runOrder);
    const actionsWouldRun = conditionsMet
      ? actions.map(a => ({ type: a.type, resolvedParams: resolveTemplate(a.params, context) }))
      : [];

    return { conditionsMet, conditionTrace, actionsWouldRun };
  }
}

export const automationEventBus = new AutomationEventBus();
