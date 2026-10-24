import { aiBudgetRepository } from '../database/AIBudgetRepository';
import { tokenTopUpRepository } from '../database/TokenTopUpRepository';
import { organizationRepository } from '../database/OrganizationRepository';
import { planTierFor } from '../utils/planTier';
import { planInForce, companyPlan, orgSubscriptionAllowsMembers } from '../utils/memberSubscription';
import { config, getTierBudget } from '../config';
import { pricingConfigService } from './PricingConfigService';
import { notificationService } from './NotificationService';
import { deadLetterService } from './DeadLetterService';
import { UPGRADE_REQUIRED_MESSAGE, PLAN_ENDED_MESSAGE } from '../middleware/requireTier';

export class AIBudgetExceededError extends Error {
  public statusCode = 429;
  public code = 'AI_BUDGET_EXCEEDED';
  public resetDate: string;

  constructor(public used: number, public budget: number, public needed = 0) {
    super(needed > 0 && used < budget
      ? `Not enough AI tokens left this month for this request: it needs about ${needed} and ${budget - used} are left`
      : `AI token budget exceeded: used ${used} of ${budget} tokens this month`);
    this.name = 'AIBudgetExceededError';
    // First day of next month
    const now = new Date();
    this.resetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().substring(0, 10);
  }
}

/**
 * The person's plan doesn't include AI: 403 UPGRADE_REQUIRED, which opens the app's upgrade
 * window. A subclass of the budget error (so code that stops on "no AI for you" stops on it too)
 * with its own name and code, so it is never answered as "budget reached".
 */
export class AIPlanRequiredError extends AIBudgetExceededError {
  public statusCode = 403;
  public code = 'UPGRADE_REQUIRED';
  constructor(planEnded = false) {
    super(0, 0);
    this.message = planEnded ? PLAN_ENDED_MESSAGE : UPGRADE_REQUIRED_MESSAGE;
    this.name = 'AIPlanRequiredError';
  }
}

/**
 * The reply for an AI refusal made before any call — plan without AI (403 UPGRADE_REQUIRED),
 * budget used up (429), the whole account's monthly cap (503, a neutral message) — or null for
 * any other error. Routes use this instead of testing the error's name (audit 2026-10-10:
 * name checks answered a plan refusal as "budget reached"). `budgetMessage` replaces the
 * message of a plain budget refusal only.
 */
export function aiRefusalReply(
  err: unknown,
  budgetMessage?: string,
): { status: number; body: { error: string; message: string; code: string; resetDate?: string } } | null {
  if (!(err instanceof AIBudgetExceededError)) return null;
  const plainBudget = err.code === 'AI_BUDGET_EXCEEDED';
  const message = plainBudget && budgetMessage ? budgetMessage : err.message;
  return {
    status: err.statusCode,
    body: { error: message, message, code: err.code, ...(plainBudget ? { resetDate: err.resetDate } : {}) },
  };
}

export interface MonthlyUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: number;
  requestCount: number;
  budget: number;
  remaining: number;
  percentUsed: number;
}

/** What a person has used and may use this month, read once at the start of a request */
export interface BudgetSnapshot {
  used: number;
  budget: number;
}

type OrgRow = Awaited<ReturnType<typeof organizationRepository.findByUserId>>;

class AIBudgetService {
  async getMonthlyUsage(userId: string): Promise<MonthlyUsage> {
    return this.usageFor(userId, await organizationRepository.findByUserId(userId));
  }

  /** Usage and budget; `org` and `knownTier` are passed in when the caller already read them */
  private async usageFor(userId: string, org: OrgRow, knownTier?: string): Promise<MonthlyUsage> {
    // A per-seat organisation pools its usage
    const row = org && org.billingModel === 'per_seat'
      ? await aiBudgetRepository.getOrgMonthlyUsage(await organizationRepository.getUserIdsInOrg(org.id))
      : await aiBudgetRepository.getMonthlyUsage(userId);
    const totalInput = Number(row.total_input);
    const totalOutput = Number(row.total_output);

    const totalTokens = totalInput + totalOutput;
    const budget = await this.getBudget(userId, org, knownTier);
    const remaining = Math.max(0, budget - totalTokens);

    return {
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalTokens,
      totalCost: Number(row.total_cost),
      requestCount: Number(row.request_count),
      budget,
      remaining,
      percentUsed: budget > 0 ? Math.round((totalTokens / budget) * 100) : 0,
    };
  }

  /**
   * Before an AI request made for a person (claudeService runs it for every entry point; a tool
   * loop runs it once, before its first turn, and checks later turns with `assertFits`).
   * 1. Their plan must include AI ('ai_assistant'). A viewer is judged by their company's plan:
   *    viewers keep the default trial plan on their own record, so their own plan said nothing
   *    about the company's (audit 2026-10-10 M2: route gates let every viewer through).
   * 2. The month's usage plus this request's estimated prompt must fit the budget — "already
   *    over?" alone let a person with 1 token left start a 240k-token question.
   * Returns the usage read, so a tool loop can check its later turns without reading it again.
   */
  async checkBudget(userId: string, estimatedTokens = 0): Promise<BudgetSnapshot> {
    const who = await aiBudgetRepository.getUserRoleAndTier(userId);
    const org = await organizationRepository.findByUserId(userId);
    await this.assertPlanAllowsAI(userId, who, org);
    const usage = await this.usageFor(userId, org, who?.tier);
    this.assertFits(usage.totalTokens, usage.budget, estimatedTokens);

    // Fire a one-time daily warning at 80% usage
    if (usage.percentUsed >= 80 && usage.percentUsed < 100) {
      this.sendBudgetWarning(userId, usage).catch(err => deadLetterService.capture('ai.budget.warning', { userId }, err));
    }
    return { used: usage.totalTokens, budget: usage.budget };
  }

  /** `used` already includes everything this request has spent so far, counted once */
  assertFits(used: number, budget: number, estimatedTokens = 0): void {
    if (used >= budget) throw new AIBudgetExceededError(used, budget);
    if (estimatedTokens > 0 && used + estimatedTokens > budget) {
      throw new AIBudgetExceededError(used, budget, estimatedTokens);
    }
  }

  private async assertPlanAllowsAI(userId: string, who: { role: string; tier: string; status: string; trialEndsAt: string | null } | null, org: OrgRow): Promise<void> {
    if (!who || who.role === 'admin') return; // unknown ids fall to the budget check; Kovarti admin isn't on a plan
    const own = { ownerUserId: null, subscriptionTier: who.tier, subscriptionStatus: who.status, trialEndsAt: who.trialEndsAt };
    // the company's plan — needed for a viewer, or when their own plan has lapsed; on flat billing
    // it is the owner's record, not the organisation row
    let company = null;
    if (org && (who.role === 'viewer' || !orgSubscriptionAllowsMembers(own))) {
      const owner = org.billingModel !== 'per_seat' && org.ownerUserId && org.ownerUserId !== userId
        ? await aiBudgetRepository.getUserRoleAndTier(org.ownerUserId)
        : null;
      company = companyPlan(org, owner && { subscriptionTier: owner.tier, subscriptionStatus: owner.status, trialEndsAt: owner.trialEndsAt });
    }
    const tier = planTierFor(who.role, who.tier, company?.subscriptionTier);
    // an ended trial or cancelled plan has no AI either — the write guard stopped its changes, but
    // AI on screens that only read kept working (2026-10-12)
    if (!planInForce(who.role, userId, own, company)) throw new AIPlanRequiredError(true);
    if (!(await pricingConfigService.isFeatureEnabled(tier, 'ai_assistant'))) throw new AIPlanRequiredError();
  }

  private async sendBudgetWarning(userId: string, usage: MonthlyUsage): Promise<void> {
    const today = new Date().toISOString().substring(0, 10);
    const alreadySent = await aiBudgetRepository.findBudgetWarningToday(userId, today);
    if (alreadySent) return;

    const daysLeft = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() - new Date().getDate();
    await notificationService.create({
      userId,
      type: 'ai_budget_warning',
      severity: 'high',
      title: `AI Budget Warning: ${usage.percentUsed}% Used`,
      message: `You have used ${usage.totalTokens.toLocaleString()} of ${usage.budget.toLocaleString()} tokens this month. ${usage.remaining.toLocaleString()} tokens remaining with ${daysLeft} days left.`,
    });
  }

  private async getBudget(userId: string, org: OrgRow, knownTier?: string): Promise<number> {
    // Per-seat organisation → pooled budget
    if (org && org.billingModel === 'per_seat') {
      // the owner's own number for this company replaces the plan pool (C1)
      if (org.aiAllowanceOverride != null) return org.aiAllowanceOverride;
      const tier = org.subscriptionTier || 'sme';
      let perSeatBudget: number;
      try {
        perSeatBudget = await pricingConfigService.getAIBudget(tier);
      } catch {
        perSeatBudget = config.AI_TIER_BUDGET_SME_PER_SEAT;
      }
      return perSeatBudget * org.seatCount;
    }

    // Priority: per-user override → DB pricing config → env var fallback
    const userBudget = await aiBudgetRepository.getUserBudget(userId);
    const userTier = knownTier ?? await aiBudgetRepository.getUserTier(userId);
    let tierBudget: number;
    try {
      tierBudget = await pricingConfigService.getAIBudget(userTier);
      if (!tierBudget) tierBudget = getTierBudget(userTier);
    } catch {
      tierBudget = getTierBudget(userTier);
    }
    const baseBudget = userBudget ?? tierBudget;

    // Add any purchased top-up tokens
    const topUpTokens = await tokenTopUpRepository.getRemainingTokens(userId);
    return baseBudget + topUpTokens;
  }
}

/** What the admin cost table needs to know about a company's allowance */
interface AllowanceInput { id: string; billingModel: 'flat' | 'per_seat'; seatCount: number; subscriptionTier: string; aiAllowanceOverride: number | null }

/**
 * Each company's monthly AI allowance, for the admin cost table. A per-seat company shares one pool
 * (its own override, else seats x the plan's per-seat number); any other company is its people's
 * individual allowances added up. Purchased top-ups are not included.
 */
export async function allowancesFor(orgs: AllowanceInput[]): Promise<Map<string, { allowance: number; source: 'company' | 'plan' | 'per-person'; planDefault: number }>> {
  const tierBudget = async (tier: string): Promise<number> => {
    try { return (await pricingConfigService.getAIBudget(tier)) || getTierBudget(tier); } catch { return getTierBudget(tier); }
  };
  const result = new Map<string, { allowance: number; source: 'company' | 'plan' | 'per-person'; planDefault: number }>();
  const flat = orgs.filter(o => o.billingModel !== 'per_seat');
  const members = await aiBudgetRepository.getMemberBudgetInputs(flat.map(o => o.id));
  const byOrg = new Map<string, typeof members>();
  for (const m of members) byOrg.set(m.organizationId, [...(byOrg.get(m.organizationId) ?? []), m]);
  // each plan is looked up once, not once per company or person
  const tiers = new Set<string>(orgs.filter(o => o.billingModel === 'per_seat').map(o => o.subscriptionTier || 'sme'));
  for (const m of members) tiers.add(m.tier || 'trial');
  const budgetOf = new Map<string, number>(await Promise.all([...tiers].map(async tier => [tier, await tierBudget(tier)] as [string, number])));
  for (const o of orgs) {
    if (o.billingModel === 'per_seat') {
      const perSeat = budgetOf.get(o.subscriptionTier || 'sme') ?? 0;
      const planDefault = perSeat * o.seatCount;
      result.set(o.id, o.aiAllowanceOverride != null ? { allowance: o.aiAllowanceOverride, source: 'company', planDefault } : { allowance: planDefault, source: 'plan', planDefault });
    } else {
      let sum = 0;
      for (const m of byOrg.get(o.id) ?? []) sum += m.override ?? budgetOf.get(m.tier || 'trial') ?? 0;
      result.set(o.id, { allowance: sum, source: 'per-person', planDefault: sum });
    }
  }
  return result;
}

export const aiBudgetService = new AIBudgetService();
