import fs from 'fs';
import path from 'path';
import { databaseService } from './connection';
import logger from '../utils/logger';
import { ALREADY_APPLIED_ERROR_CODES } from './migrationRunner';

const TENANT_MIGRATIONS_DIR = path.join(__dirname, 'tenant-migrations');

export async function runTenantMigrations(dbName: string): Promise<number> {
  if (!fs.existsSync(TENANT_MIGRATIONS_DIR)) {
    logger.warn('[tenant-migration] No tenant-migrations directory found');
    return 0;
  }

  const pool = databaseService.getPool();
  if (!pool) throw new Error('Database pool not initialized');

  const conn = await pool.getConnection();
  try {
    await conn.query(`USE \`${dbName}\``);

    // Ensure _migrations tracking table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get already-applied
    const [appliedRows] = await conn.query('SELECT name FROM _migrations ORDER BY name') as any;
    const appliedSet = new Set((appliedRows as any[]).map((r: any) => r.name));

    // Read and sort tenant migration files
    const files = fs.readdirSync(TENANT_MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql') && !f.endsWith('.down.sql'))
      .sort();

    let ranCount = 0;
    const alreadyPresent: string[] = [];
    for (const file of files) {
      if (appliedSet.has(file)) continue;

      const filePath = path.join(TENANT_MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf-8').trim();
      if (!sql) continue;

      logger.info(`[tenant-migration] Running ${file} on ${dbName}`);

      const statements = sql
        .split(/;\s*$/m)
        .map(s => s.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n').trim())
        .filter(s => s.length > 0);

      await conn.beginTransaction();
      try {
        for (const stmt of statements) {
          await conn.query(stmt);
        }
        await conn.query('INSERT IGNORE INTO _migrations (name) VALUES (?)', [file]);
        await conn.commit();
        logger.info(`[tenant-migration] Applied ${file} on ${dbName} (${statements.length} statements)`);
        ranCount++;
      } catch (error) {
        await conn.rollback();

        if (ALREADY_APPLIED_ERROR_CODES.has((error as { code?: string })?.code ?? '')) {
          // The change is already in this tenant's database, just not recorded. Record
          // it and carry on. Refusing to continue over a bookkeeping gap is far more
          // damaging: because this threw, the tenant stopped at the first such file and
          // every LATER migration was skipped too. Seven staging tenants sat frozen
          // seven migrations behind for weeks, missing columns the app expects.
          logger.warn(
            `[tenant-migration] ALREADY PRESENT ${file} on ${dbName} — ${(error as Error).message}. Recording and continuing.`,
          );
          try {
            await conn.query('INSERT IGNORE INTO _migrations (name) VALUES (?)', [file]);
            alreadyPresent.push(file);
            continue;
          } catch (recordErr) {
            logger.error(`[tenant-migration] Could not record ${file} on ${dbName}`, {
              error: recordErr instanceof Error ? recordErr.message : String(recordErr),
            });
          }
        }

        // Log the actual reason. This used to log the error object, which serialised to
        // {"name":"Error"} — no message, no SQL, no code — which is why nobody ever
        // diagnosed why these tenants were stuck.
        logger.error(`[tenant-migration] FAILED ${file} on ${dbName}`, {
          message: error instanceof Error ? error.message : String(error),
          code: (error as { code?: string })?.code,
          sqlState: (error as { sqlState?: string })?.sqlState,
        });
        throw error;
      }
    }

    if (alreadyPresent.length > 0) {
      logger.warn(
        `[tenant-migration] ${dbName}: ${alreadyPresent.length} migration(s) were already present and have been recorded: ${alreadyPresent.join(', ')}`,
      );
    }

    if (ranCount === 0 && alreadyPresent.length === 0) {
      logger.info(`[tenant-migration] ${dbName}: all migrations applied`);
    } else {
      logger.info(`[tenant-migration] ${dbName}: ${ranCount} migration(s) applied`);
    }

    return ranCount;
  } finally {
    conn.release();
  }
}

export async function runAllTenantMigrations(): Promise<void> {
  // Import here to avoid circular dependency
  const { organizationService } = await import('../services/OrganizationService');
  const orgs = await organizationService.getAllActiveProvisioned();

  if (orgs.length === 0) {
    logger.info('[tenant-migration] No provisioned tenants — skipping');
    return;
  }

  logger.info(`[tenant-migration] Running migrations for ${orgs.length} tenant(s)`);

  for (const org of orgs) {
    try {
      await runTenantMigrations(org.dbName);
    } catch (error) {
      logger.error(`[tenant-migration] Failed for tenant ${org.slug}`, { error, dbName: org.dbName });
      // Continue with other tenants — don't let one failure block all
    }
  }
}
