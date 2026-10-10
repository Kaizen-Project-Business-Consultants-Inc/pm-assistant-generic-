import type { FastifyRequest } from 'fastify';
import { organizationService } from '../services/OrganizationService';

/**
 * Who sees pay information — the rate card and each person's hourly / overtime rate. Only the
 * people who manage costs: admins, PMO, project managers and the company owner (a consultant is a
 * PM and owns their company). Team members, viewers, executives and guests never do.
 * (One rule for the rate card and the people lists — 2026-10-09 audit M11: the lists showed
 * everyone's rates to every role while the rate card itself was hidden.)
 */
/** The roles that see and set pay rates (plus the company owner). The one list to change. */
export const PAY_RATE_ROLES: readonly string[] = ['admin', 'pmo', 'project_manager'];

export async function maySeePayRates(request: FastifyRequest): Promise<boolean> {
  const user = request.user!;
  if (user.isGuest) return false;
  if (PAY_RATE_ROLES.includes(user.role)) return true;
  const org = await organizationService.findByUserId(user.userId).catch(() => null);
  return !!org && org.ownerUserId === user.userId;
}

type PayFields = { costRateHourly?: number | null; overtimeRateHourly?: number | null };

/** The same rows with the rates blanked (only the rate fields a row has) */
export function withoutPay<T extends PayFields>(rows: T[]): T[] {
  return rows.map((r) => ({
    ...r,
    ...('costRateHourly' in r ? { costRateHourly: null } : {}),
    ...('overtimeRateHourly' in r ? { overtimeRateHourly: null } : {}),
  }));
}

/**
 * The people lists for this caller: rates only for those who manage costs; email addresses only
 * for people in the company (a guest is an outsider and sees names only).
 */
export async function peopleFor<T extends PayFields & { email?: string | null }>(request: FastifyRequest, rows: T[]): Promise<T[]> {
  let out = (await maySeePayRates(request)) ? rows : withoutPay(rows);
  if (request.user?.isGuest) out = out.map((r) => ('email' in r ? { ...r, email: null } : r));
  return out;
}

/** The fields that set a person's pay: their own rates and whether the rate card prices them */
const PAY_INPUT_FIELDS = ['costRateHourly', 'overtimeRateHourly', 'useRateCard'] as const;

/**
 * A save from someone who may not see pay rates: the rate fields are dropped, silently. They see
 * an empty rate box (the server blanks it), so saving the form used to store "no rate" and
 * re-price every plan the person is on (2026-10-10 review). A field you can't see never changes.
 */
export function withoutPayInput<T extends object>(data: T): T {
  const out = { ...data } as Record<string, unknown>;
  for (const f of PAY_INPUT_FIELDS) delete out[f];
  return out as T;
}
