import { aiBudgetRepository } from '../database/AIBudgetRepository';
import { tokenTopUpRepository } from '../database/TokenTopUpRepository';
import { organizationRepository } from '../database/OrganizationRepository';
import { config, getTierBudget } from '../config';
import { pricingConfigService } from './PricingConfigService';
import { notificationService } from './NotificationService';
import { deadLetterService } from './DeadLetterService';
import { UPGRADE_REQUIRED_MESSAGE } from '../middleware/requireTier';

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
  constructor() {
    super(0, 0);
    this.message = UPGRADE_REQUIRED_MESSAGE;
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
    await this.assertPlanAllowsAI(who, org);
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

  private async assertPlanAllowsAI(who: { role: string; tier: string } | null, org: OrgRow): Promise<void> {
    if (!who || who.role === 'admin') return; // unknown ids fall to the budget check; Kovarti admin isn't on a plan
    const tier = who.role === 'viewer' && org?.subscriptionTier ? org.subscriptionTier : who.tier;
    if (!(await pricingConfigService.isFeatureEnabled(tier, 'ai_assistant'))) {
      throw new AIPlanRequiredError();
    }
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

export const aiBudgetService = new AIBudgetService();
