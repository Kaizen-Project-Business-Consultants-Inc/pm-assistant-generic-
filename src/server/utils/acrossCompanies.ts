import { config } from '../config';
import { databaseService } from '../database/connection';
import { runWithTenantContext } from '../middleware/requestContext';
import logger from './logger';

/**
 * Run one read-only statement in EVERY company's own database and return each company's rows.
 *
 * For platform-wide admin figures (counts, totals). Company data lives only in each company's
 * database; admin statistics used to read the old copies in the shared database instead and
 * showed stale July numbers (found 2026-09-30). Only aggregate SELECTs belong here — the admin
 * never changes customer data, and never sees customer content through this.
 *
 * A company whose database fails to answer is skipped (and logged), so one broken company
 * can't blank the whole admin page. Single-company installs run it once, as-is.
 */
export async function selectAcrossCompanies<T = any>(sql: string, params: any[] = []): Promise<T[][]> {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error('selectAcrossCompanies only runs SELECT statements');
  if (!config.MULTI_TENANT_ENABLED) return [await databaseService.query<T>(sql, params)];

  const { organizationService } = await import('../services/OrganizationService');
  const orgs = await organizationService.getAllActiveProvisioned();
  const results: T[][] = [];
  for (const org of orgs) {
    try {
      results.push(await runWithTenantContext(org.dbName, org.id, () => databaseService.query<T>(sql, params)));
    } catch (err) {
      logger.warn(`[acrossCompanies] ${org.slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return results;
}

/** Add up numeric columns across companies' single-row results (COUNT/SUM queries) */
export function sumRows(perCompany: Array<Array<Record<string, unknown>>>, columns: string[]): Record<string, number> {
  const total: Record<string, number> = Object.fromEntries(columns.map(c => [c, 0]));
  for (const rows of perCompany) for (const row of rows) for (const c of columns) total[c] += Number(row[c] ?? 0) || 0;
  return total;
}

/** Merge grouped rows across companies: sum numeric columns per group key */
export function mergeGroups(perCompany: Array<Array<Record<string, unknown>>>, key: string, columns: string[]): Array<Record<string, unknown>> {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const rows of perCompany) {
    for (const row of rows) {
      const k = String(row[key]);
      const acc = byKey.get(k) ?? { [key]: row[key], ...Object.fromEntries(columns.map(c => [c, 0])) };
      for (const c of columns) acc[c] = (Number(acc[c]) || 0) + (Number(row[c] ?? 0) || 0);
      byKey.set(k, acc);
    }
  }
  return [...byKey.values()];
}
