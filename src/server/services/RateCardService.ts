import { v4 as uuidv4 } from 'uuid';
import { databaseService } from '../database/connection';

/**
 * Rate card: hourly cost rates by role, each starting on a date. One card per company
 * (it lives in the company's own database). A resource with `useRateCard` is costed at
 * its role's rate in force on the day worked; everyone else keeps their own rate.
 * Overtime: the card's overtime rate, else 1.5 × the hourly rate (same as own rates).
 */
export interface RateCardEntry {
  id: string;
  role: string;
  hourlyRate: number;
  overtimeRate: number | null;
  effectiveFrom: string; // YYYY-MM-DD
}

export interface RateInput {
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
}

export class RateCardError extends Error {}

/** Roles match without regard to case or surrounding spaces ("developer " = "Developer") */
export const roleKey = (role: string | null | undefined) => (role ?? '').trim().toLowerCase();

const toEntry = (r: any): RateCardEntry => ({
  id: r.id,
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
 */
export function ratesOn(resource: RatedResource, day: string, card: RateCardEntry[]): Rates {
  if (resource.useRateCard) {
    const key = roleKey(resource.role);
    let best: RateCardEntry | null = null;
    for (const e of card) {
      if (roleKey(e.role) !== key || e.effectiveFrom > day) continue;
      if (!best || e.effectiveFrom > best.effectiveFrom) best = e;
    }
    if (best) return { standard: best.hourlyRate, overtime: best.overtimeRate ?? best.hourlyRate * 1.5 };
  }
  const standard = resource.costRateHourly;
  return { standard, overtime: resource.overtimeRateHourly ?? (standard != null ? standard * 1.5 : null) };
}

export class RateCardService {
  async list(): Promise<RateCardEntry[]> {
    const rows = await databaseService.query('SELECT * FROM rate_card ORDER BY role, effective_from');
    return rows.map(toEntry);
  }

  /** The card, or an empty one if the company's database doesn't have it yet (reports must never fail on this) */
  async listSafe(): Promise<RateCardEntry[]> {
    return this.list().catch(() => []);
  }

  async create(input: RateInput, userId: string): Promise<RateCardEntry> {
    const role = input.role.trim();
    await this.assertFree(role, input.effectiveFrom, null);
    const id = uuidv4();
    await databaseService.query(
      'INSERT INTO rate_card (id, role, hourly_rate, overtime_rate, effective_from, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [id, role, input.hourlyRate, input.overtimeRate ?? null, input.effectiveFrom, userId],
    );
    return (await this.find(id))!;
  }

  async update(id: string, input: RateInput): Promise<RateCardEntry | null> {
    if (!(await this.find(id))) return null;
    const role = input.role.trim();
    await this.assertFree(role, input.effectiveFrom, id);
    await databaseService.query(
      'UPDATE rate_card SET role = ?, hourly_rate = ?, overtime_rate = ?, effective_from = ? WHERE id = ?',
      [role, input.hourlyRate, input.overtimeRate ?? null, input.effectiveFrom, id],
    );
    return this.find(id);
  }

  async remove(id: string): Promise<boolean> {
    const result: any = await databaseService.query('DELETE FROM rate_card WHERE id = ?', [id]);
    return (result?.affectedRows ?? 0) > 0;
  }

  private async find(id: string): Promise<RateCardEntry | null> {
    const rows = await databaseService.query('SELECT * FROM rate_card WHERE id = ?', [id]);
    return rows[0] ? toEntry(rows[0]) : null;
  }

  private async assertFree(role: string, from: string, exceptId: string | null) {
    const clash = (await this.list()).find(e => e.id !== exceptId && roleKey(e.role) === roleKey(role) && e.effectiveFrom === from);
    if (clash) throw new RateCardError(`${clash.role} already has a rate starting ${from}. Change that one instead.`);
  }
}

export const rateCardService = new RateCardService();
