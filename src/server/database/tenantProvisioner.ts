import { databaseService } from './connection';
import { runTenantMigrations } from './tenantMigrationRunner';
import { organizationRepository } from './OrganizationRepository';
import logger from '../utils/logger';

// Track in-flight repairs to avoid concurrent attempts for the same org
const repairInFlight = new Map<string, Promise<boolean>>();

export async function provisionTenantDatabase(orgId: string): Promise<void> {
  const org = await organizationRepository.findById(orgId);
  if (!org) throw new Error(`Organization ${orgId} not found`);
  if (org.isProvisioned) {
    logger.info(`[provisioner] Tenant ${org.slug} already provisioned — skipping`);
    return;
  }

  const dbName = org.dbName;
  logger.info(`[provisioner] Provisioning tenant database: ${dbName}`);

  const pool = databaseService.getPool();
  if (!pool) throw new Error('Database pool not initialized');

  const conn = await pool.getConnection();
  try {
    // Create the tenant database
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    logger.info(`[provisioner] Created database ${dbName}`);
  } finally {
    conn.release();
  }

  // Run tenant baseline migration
  await runTenantMigrations(dbName);

  // Verify tables actually exist before marking as provisioned
  const verified = await verifyTenantDatabase(dbName);
  if (!verified) {
    throw new Error(`Provisioning verification failed for ${dbName} — tables missing after migration`);
  }

  // Mark as provisioned
  await organizationRepository.update(orgId, { isProvisioned: true });
  logger.info(`[provisioner] Tenant ${org.slug} provisioned successfully`);
}

/**
 * Verify a tenant database has the essential tables.
 * Returns true if the DB looks healthy, false if tables are missing.
 */
export async function verifyTenantDatabase(dbName: string): Promise<boolean> {
  const pool = databaseService.getPool();
  if (!pool) return false;

  const essentialTables = ['projects', 'users', 'schedules', 'tasks', '_migrations'];

  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?`,
      [dbName]
    ) as any;
    const tableNames = new Set((rows as any[]).map((r: any) => r.TABLE_NAME));
    return essentialTables.every(t => tableNames.has(t));
  } catch {
    return false;
  } finally {
    conn.release();
  }
}

/**
 * Auto-repair an unprovisioned tenant database.
 * Called from tenantResolver when isProvisioned is false.
 * Deduplicates concurrent repair attempts for the same org.
 * Returns true if repair succeeded, false otherwise.
 */
export async function repairTenantDatabase(orgId: string): Promise<boolean> {
  // Deduplicate: if a repair is already in flight for this org, wait for it
  const existing = repairInFlight.get(orgId);
  if (existing) return existing;

  const attempt = (async () => {
    try {
      logger.warn(`[provisioner] Auto-repairing tenant for org ${orgId}`);
      await provisionTenantDatabase(orgId);
      return true;
    } catch (err: any) {
      logger.error(`[provisioner] Auto-repair failed for org ${orgId}`, { error: err.message });
      return false;
    } finally {
      repairInFlight.delete(orgId);
    }
  })();

  repairInFlight.set(orgId, attempt);
  return attempt;
}
