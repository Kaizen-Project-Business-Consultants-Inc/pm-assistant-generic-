import { v4 as uuidv4 } from 'uuid';
import { rateCardChanged } from './domainEvents';
import { databaseService } from '../database/connection';

/**
 * Rate card: hourly cost rates by role, each starting on a date. One card per company
 * (it lives in the company's own database). A resource with `useRateCard` is costed at
 * its role's rate in force on the day worked; everyone else keeps their own rate.
 * Overtime: the card's overtime rate, else 1.5 × the hourly rate (same as own rates).
 */
export interface RateCardEntry {
  id: string;
  /** Whose card: a client's id, or '' = My resources (U8) */
  poolId?: string;
  role: string;
  hourlyRate: number;
  overtimeRate: number | null;
  effectiveFrom: string; // YYYY-MM-DD
}

export interface RateInput {
  /** A client's id, or '' / missing = My resources */
  poolId?: string;
  role: string;
  hourlyRate: number;
  overtimeRate?: number | null;
  effectiveFrom: string;
}

export interface Rates { standard: number | null; overtime: number | null }

/** What a resource needs for its rate to be worked out */
export interface RatedResource {
  role: string;
  costRateHourly: number | null;
  overtimeRateHourly: number | null;
  useRateCard?: boolean;
  /** The person's pool: their client's card applies, or My resources' when null (U8) */
  clientId?: string | null;
}

export class RateCardError extends Error {}

/** Roles match without regard to case or surrounding spaces ("developer " = "Developer") */
export const roleKey = (role: string | null | undefined) => (role ?? '').trim().toLowerCase();

const toEntry = (r: any): RateCardEntry => ({
  id: r.id,
  poolId: r.pool_id ?? '',
  role: r.role,
  hourlyRate: Number(r.hourly_rate),
  overtimeRate: r.overtime_rate != null ? Number(r.overtime_rate) : null,
  effectiveFrom: typeof r.effective_from === 'string' ? r.effective_from.slice(0, 10) : ymdLocal(r.effective_from),
});

// mysql2 returns DATE columns as local-midnight Date objects
function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The rates a resource is paid on `day` (YYYY-MM-DD), given the whole card. Pure, so
 * reports can load the card once and ask for any number of resources and weeks.
 * A resource on the card whose role has no rate yet on that day falls back to its own rate.
 * The screen picks the card rate the same way (src/client/src/utils/rateCard.ts cardRateOn) —
 * __tests__/utils/rulesParity.test.ts fails until both match.
 */
/** The card grouped by pool + role, built once per card (ratesOn runs per time entry) */
const cardIndex = new WeakMap<RateCardEntry[], Map<string, RateCardEntry[]>>();
function entriesFor(card: RateCardEntry[], pool: string, key: string): RateCardEntry[] {
  let index = cardIndex.get(card);
  if (!index) {
    index = new Map();
    for (const e of card) {
      const k = `${e.poolId ?? ''}|${roleKey(e.role)}`;
      const list = index.get(k);
      if (list) list.push(e); else index.set(k, [e]);
    }
    cardIndex.set(card, index);
  }
  return index.get(`${pool}|${key}`) ?? [];
}

export function ratesOn(resource: RatedResource, day: string, card: RateCardEntry[]): Rates {
  if (resource.useRateCard) {
    // only the person's own pool's card: a Developer at one client isn't costed at another's rate
    let best: RateCardEntry | null = null;
    for (const e of entriesFor(card, resource.clientId ?? '', roleKey(resource.role))) {
      if (e.effectiveFrom > day) continue;
      if (!best || e.effectiveFrom > best.effectiveFrom) best = e;
    }
    if (best) return { standard: best.hourlyRate, overtime: best.overtimeRate ?? best.hourlyRate * 1.5 };
  }
  const standard = resource.costRateHourly;
  return { standard, overtime: resource.overtimeRateHourly ?? (standard != null ? standard * 1.5 : null) };
}

export class RateCardService {
  /** Every pool's card, or one pool's ('' = My resources) */
  async list(poolId?: string): Promise<RateCardEntry[]> {
    const rows = poolId === undefined
      ? await databaseService.query('SELECT * FROM rate_card ORDER BY role, effective_from')
      : await databaseService.query('SELECT * FROM rate_card WHERE pool_id = ? ORDER BY role, effective_from', [poolId]);
    return rows.map(toEntry);
  }

  /** The card, or an empty one if the company's database doesn't have it yet (reports must never fail on this) */
  async listSafe(): Promise<RateCardEntry[]> {
    return this.list().catch(() => []);
  }

  async create(input: RateInput, userId: string): Promise<RateCardEntry> {
    const role = input.role.trim();
    const poolId = input.poolId ?? '';
    if (poolId && !(await databaseService.query('SELECT id FROM project_groups WHERE id = ?', [poolId]))[0]) {
      throw new RateCardError("That client doesn't exist, so its rate card can't be changed.");
    }
    await this.assertFree(poolId, role, input.effectiveFrom, null);
    const id = uuidv4();
    await databaseService.query(
      'INSERT INTO rate_card (id, pool_id, role, hourly_rate, overtime_rate, effective_from, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, poolId, role, input.hourlyRate, input.overtimeRate ?? null, input.effectiveFrom, userId],
    );
    this.repriceLater();
    return (await this.find(id))!;
  }

  async update(id: string, input: RateInput): Promise<RateCardEntry | null> {
    const existing = await this.find(id);
    if (!existing) return null;
    const role = input.role.trim();
    // a rate stays in its pool
    await this.assertFree(existing.poolId ?? '', role, input.effectiveFrom, id);
    await databaseService.query(
      'UPDATE rate_card SET role = ?, hourly_rate = ?, overtime_rate = ?, effective_from = ? WHERE id = ?',
      [role, input.hourlyRate, input.overtimeRate ?? null, input.effectiveFrom, id],
    );
    this.repriceLater();
    return this.find(id);
  }

  async remove(id: string): Promise<boolean> {
    const result: any = await databaseService.query('DELETE FROM rate_card WHERE id = ?', [id]);
    this.repriceLater();
    return (result?.affectedRows ?? 0) > 0;
  }

  /** Task budgets are planned hours × rate: a rate card change re-prices every plan, in the background */
  private repriceLater(): void {
    rateCardChanged();
  }

  private async find(id: string): Promise<RateCardEntry | null> {
    const rows = await databaseService.query('SELECT * FROM rate_card WHERE id = ?', [id]);
    return rows[0] ? toEntry(rows[0]) : null;
  }

  private async assertFree(poolId: string, role: string, from: string, exceptId: string | null) {
    const clash = (await this.list(poolId)).find(e => e.id !== exceptId && roleKey(e.role) === roleKey(role) && e.effectiveFrom === from);
    if (clash) throw new RateCardError(`${clash.role} already has a rate starting ${from}. Change that one instead.`);
  }
}

export const rateCardService = new RateCardService();
