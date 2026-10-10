import type { FastifyReply, FastifyRequest } from 'fastify';
import { userService } from '../services/UserService';
import { organizationService } from '../services/OrganizationService';
import { rateLimiter } from '../middleware/rateLimiter';
import { orgSubscriptionAllowsMembers, type OrgBilling } from './memberSubscription';

/**
 * The free trial needs no card, so its email must not work as a mail relay (2026-10-10): up to 5
 * people per email and 5 emails a day for the whole trial company, shared by everything that mails
 * report, minutes or automation content — routes (`trialEmailAllowance`) and mail sent later without
 * a request (`checkBackgroundSend`: scheduled reports, automation emails). Paid plans keep each
 * route's own limit.
 */
export const TRIAL_EMAIL = { recipients: 5, perDay: 5 } as const;
const DAY_MS = 24 * 60 * 60_000;

const TOO_MANY_PEOPLE = `On the free trial you can email up to ${TRIAL_EMAIL.recipients} people at a time. Choose a plan to send to more.`;
const TOO_MANY_EMAILS = `On the free trial you can send up to ${TRIAL_EMAIL.perDay} emails a day. Choose a plan to send more.`;

type Person = { role: string; subscriptionTier: string };

/** The trial company's key (its id, or the person's own id without one), or null when not on the trial */
function trialAccount(userId: string, user: Person, org: { id: string; subscriptionTier: string } | null): string | null {
  if (user.role === 'admin') return null;
  // a viewer's own record keeps the default 'trial' plan: judge a viewer by the company (as the AI plan check does)
  const tier = user.role === 'viewer' ? org?.subscriptionTier : user.subscriptionTier;
  return tier === 'trial' ? (org?.id ?? userId) : null;
}

/** Is this person on the free trial? Returns the trial company's key, or null. Admins never are. */
export async function trialAccountOf(userId: string): Promise<string | null> {
  const [user, org] = await Promise.all([userService.findById(userId), organizationService.findByUserId(userId)]);
  return user ? trialAccount(userId, user, org) : null;
}

const takeTrialEmail = (account: string) => rateLimiter.check(`trial-email:${account}`, TRIAL_EMAIL.perDay, DAY_MS);

/**
 * preHandler for routes that mail content. `field` names the recipient list in the body; `sends:
 * false` (editing a schedule) only checks the list. Report generate routes wrap it in
 * `whenSendingEmail`.
 */
export function trialEmailAllowance(field = 'recipients', sends = true) {
  return async function trialEmailAllowanceHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
    if (request.user!.role === 'admin') return;
    const account = await trialAccountOf(request.user!.userId);
    if (!account) return;
    const list = (request.body as Record<string, unknown> | undefined)?.[field];
    if (Array.isArray(list) && list.length > TRIAL_EMAIL.recipients) {
      return reply.status(400).send({ error: 'Trial email limit', message: TOO_MANY_PEOPLE });
    }
    if (!sends) return;
    const rl = takeTrialEmail(account);
    if (!rl.allowed) {
      reply.header('Retry-After', String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))));
      return reply.status(429).send({ error: 'Trial email limit', message: TOO_MANY_EMAILS });
    }
  };
}

type BackgroundSendCheck = { ok: true } | { ok: false; stop: boolean; reason: string };

/**
 * For mail sent later on someone's behalf (a scheduled report, an automation email): may the
 * person who set it up still send? `stop` = their plan has ended, so pause it (an abandoned trial
 * must not keep mailing, and keep spending AI, for ever); otherwise it is the trial allowance and
 * it can try again next time.
 */
export async function checkBackgroundSend(userId: string, recipients: number): Promise<BackgroundSendCheck> {
  const [user, org] = await Promise.all([userService.findById(userId), organizationService.findByUserId(userId)]);
  if (!user) return { ok: false, stop: true, reason: 'The person who set this up no longer has an account.' };
  if (user.role === 'admin') return { ok: true };
  const active = orgSubscriptionAllowsMembers(user as unknown as OrgBilling) || (!!org && orgSubscriptionAllowsMembers(org));
  if (!active) return { ok: false, stop: true, reason: 'Paused: the plan of the person who set this up has ended.' };
  const account = trialAccount(userId, user, org);
  if (!account) return { ok: true };
  if (recipients > TRIAL_EMAIL.recipients) return { ok: false, stop: false, reason: TOO_MANY_PEOPLE };
  if (!takeTrialEmail(account).allowed) return { ok: false, stop: false, reason: TOO_MANY_EMAILS };
  return { ok: true };
}
