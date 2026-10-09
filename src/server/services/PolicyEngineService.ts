import { v4 as uuidv4 } from 'uuid';
import { policyRepository, Policy } from '../database/PolicyRepository';

export type { Policy } from '../database/PolicyRepository';

export interface ConditionExpr {
  field: string;
  op: '>' | '<' | '>=' | '<=' | '==' | '!=' | 'in' | 'not_in' | 'contains';
  value: any;
}

export interface PolicyEvaluation {
  id?: number;
  policyId: string;
  action: string;
  actorId: string;
  entityType?: string;
  entityId?: string;
  matched: boolean;
  enforcementResult: 'allowed' | 'blocked' | 'pending_approval';
  contextSnapshot?: Record<string, any>;
  createdAt?: string;
}

export interface EvaluationResult {
  allowed: boolean;
  enforcement: 'allowed' | 'blocked' | 'pending_approval';
  matchedPolicies: Array<{ policyId: string; policyName: string; enforcement: string }>;
}

export interface EvaluationContext {
  actorId: string;
  actorRole?: string;
  entityType?: string;
  entityId?: string;
  projectId?: string;
  data?: Record<string, any>;
}

function matchesPattern(pattern: string, action: string): boolean {
  if (pattern === '*') return true;
  if (pattern === action) return true;
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2);
    return action.startsWith(prefix + '.') || action === prefix;
  }
  return false;
}

function evaluateCondition(expr: ConditionExpr, data: Record<string, any>): boolean {
  if (!expr.field) return true;
  const fieldValue = data[expr.field];
  if (fieldValue === undefined) return false;
  switch (expr.op) {
    case '>': return Number(fieldValue) > Number(expr.value);
    case '<': return Number(fieldValue) < Number(expr.value);
    case '>=': return Number(fieldValue) >= Number(expr.value);
    case '<=': return Number(fieldValue) <= Number(expr.value);
    case '==': return String(fieldValue) === String(expr.value);
    case '!=': return String(fieldValue) !== String(expr.value);
    case 'in': return Array.isArray(expr.value) && expr.value.includes(fieldValue);
    case 'not_in': return Array.isArray(expr.value) && !expr.value.includes(fieldValue);
    case 'contains': return String(fieldValue).includes(String(expr.value));
    default: return true;
  }
}

export class PolicyEngineService {
  async evaluate(action: string, context: EvaluationContext): Promise<EvaluationResult> {
    const policies = await this.getActivePolicies(context.projectId);
    const matchedPolicies: EvaluationResult['matchedPolicies'] = [];
    let strictestEnforcement: 'allowed' | 'blocked' | 'pending_approval' = 'allowed';
    const enforcementOrder = { allowed: 0, pending_approval: 1, blocked: 2 };
    const evaluations: Parameters<typeof policyRepository.logEvaluations>[0] = [];

    for (const policy of policies) {
      if (!matchesPattern(policy.actionPattern, action)) continue;

      const conditionData = {
        ...context.data,
        actor_role: context.actorRole,
        actor_id: context.actorId,
        entity_type: context.entityType,
        entity_id: context.entityId,
      };

      const conditionMatched = evaluateCondition(policy.conditionExpr as ConditionExpr, conditionData);
      let enforcementResult: PolicyEvaluation['enforcementResult'] = 'allowed';

      if (conditionMatched) {
        switch (policy.enforcement) {
          case 'block': enforcementResult = 'blocked'; break;
          case 'require_approval': enforcementResult = 'pending_approval'; break;
          default: enforcementResult = 'allowed'; break;
        }

        matchedPolicies.push({
          policyId: policy.id, policyName: policy.name, enforcement: policy.enforcement,
        });

        if (enforcementOrder[enforcementResult] > enforcementOrder[strictestEnforcement]) {
          strictestEnforcement = enforcementResult;
        }
      }

      evaluations.push({
        policyId: policy.id, action, actorId: context.actorId, entityType: context.entityType || null,
        entityId: context.entityId || null, matched: conditionMatched,
        enforcementResult: conditionMatched ? enforcementResult : 'allowed', contextSnapshot: conditionData,
      });
    }
    try { await policyRepository.logEvaluations(evaluations); } catch { /* Non-critical */ }

    return { allowed: strictestEnforcement !== 'blocked', enforcement: strictestEnforcement, matchedPolicies };
  }

  private async getActivePolicies(projectId?: string): Promise<Policy[]> {
    try { return await policyRepository.findActive(projectId); } catch { return []; }
  }

  async getProjectPolicies(projectId: string): Promise<Policy[]> {
    try { return await policyRepository.findByProject(projectId); } catch { return []; }
  }

  async getAllPolicies(): Promise<Policy[]> {
    try { return await policyRepository.findAll(); } catch { return []; }
  }

  async getPolicyById(id: string): Promise<Policy | null> {
    try { return await policyRepository.findById(id); } catch { return null; }
  }

  async createPolicy(data: {
    projectId?: string | null; name: string; description?: string;
    actionPattern: string; conditionExpr: ConditionExpr;
    enforcement: Policy['enforcement']; createdBy: string;
  }): Promise<Policy> {
    const id = uuidv4();
    return policyRepository.insert(
      id, data.projectId ?? null, data.name, data.description || null,
      data.actionPattern, data.conditionExpr, data.enforcement, data.createdBy,
    );
  }

  async updatePolicy(id: string, data: {
    name?: string; description?: string; actionPattern?: string;
    conditionExpr?: ConditionExpr; enforcement?: Policy['enforcement']; isActive?: boolean;
  }): Promise<Policy | null> {
    const sets: string[] = [];
    const params: any[] = [];
    if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name); }
    if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description); }
    if (data.actionPattern !== undefined) { sets.push('action_pattern = ?'); params.push(data.actionPattern); }
    if (data.conditionExpr !== undefined) { sets.push('condition_expr = ?'); params.push(JSON.stringify(data.conditionExpr)); }
    if (data.enforcement !== undefined) { sets.push('enforcement = ?'); params.push(data.enforcement); }
    if (data.isActive !== undefined) { sets.push('is_active = ?'); params.push(data.isActive ? 1 : 0); }
    if (sets.length === 0) return this.getPolicyById(id);
    await policyRepository.updateFields(id, sets, params);
    return this.getPolicyById(id);
  }

  async deletePolicy(id: string): Promise<boolean> {
    return policyRepository.deleteById(id);
  }

  async getEvaluationStats(projectId?: string, since?: string): Promise<{
    total: number; allowed: number; blocked: number; pendingApproval: number;
  }> {
    try { return await policyRepository.getEvaluationStats(projectId, since); }
    catch { return { total: 0, allowed: 0, blocked: 0, pendingApproval: 0 }; }
  }
}

export const policyEngineService = new PolicyEngineService();
