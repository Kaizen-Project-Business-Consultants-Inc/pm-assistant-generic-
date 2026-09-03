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

  // Seed starter templates
  await seedStarterTemplates(dbName);

  // Mark as provisioned
  await organizationRepository.update(orgId, { isProvisioned: true });
  logger.info(`[provisioner] Tenant ${org.slug} provisioned successfully`);
}

const STARTER_TEMPLATES = [
  { name: 'Software Development', description: 'Standard SDLC with planning, development, testing, and deployment phases', category: 'software', projectType: 'agile', defaultDuration: 90, phases: JSON.stringify([{name:'Planning',tasks:[{name:'Requirements gathering'},{name:'Technical design'},{name:'Sprint planning'}]},{name:'Development',tasks:[{name:'Backend development'},{name:'Frontend development'},{name:'API integration'}]},{name:'Testing',tasks:[{name:'Unit testing'},{name:'Integration testing'},{name:'UAT'}]},{name:'Deployment',tasks:[{name:'Staging deploy'},{name:'Production deploy'},{name:'Post-deploy verification'}]}]) },
  { name: 'Construction Project', description: 'Construction project with design, procurement, build, and handover phases', category: 'construction', projectType: 'waterfall', defaultDuration: 180, phases: JSON.stringify([{name:'Design',tasks:[{name:'Architectural design'},{name:'Engineering plans'},{name:'Permits & approvals'}]},{name:'Procurement',tasks:[{name:'Material sourcing'},{name:'Vendor contracts'},{name:'Equipment rental'}]},{name:'Build',tasks:[{name:'Site preparation'},{name:'Foundation'},{name:'Structure'},{name:'Finishing'}]},{name:'Handover',tasks:[{name:'Inspection'},{name:'Punch list'},{name:'Client handover'}]}]) },
  { name: 'Marketing Campaign', description: 'End-to-end marketing campaign from strategy to execution and analysis', category: 'marketing', projectType: 'hybrid', defaultDuration: 60, phases: JSON.stringify([{name:'Strategy',tasks:[{name:'Market research'},{name:'Campaign brief'},{name:'Budget allocation'}]},{name:'Creative',tasks:[{name:'Content creation'},{name:'Design assets'},{name:'Review & approval'}]},{name:'Execution',tasks:[{name:'Channel setup'},{name:'Launch campaign'},{name:'Monitor performance'}]},{name:'Analysis',tasks:[{name:'Collect metrics'},{name:'ROI analysis'},{name:'Final report'}]}]) },
  { name: 'Product Launch', description: 'Product launch from planning through go-to-market and post-launch review', category: 'product', projectType: 'hybrid', defaultDuration: 120, phases: JSON.stringify([{name:'Planning',tasks:[{name:'Market analysis'},{name:'Pricing strategy'},{name:'Launch timeline'}]},{name:'Preparation',tasks:[{name:'Sales enablement'},{name:'Marketing collateral'},{name:'Partner coordination'}]},{name:'Launch',tasks:[{name:'Press release'},{name:'Launch event'},{name:'Social campaign'}]},{name:'Post-Launch',tasks:[{name:'Customer feedback'},{name:'Performance review'},{name:'Iteration plan'}]}]) },
  { name: 'IT Infrastructure', description: 'Infrastructure upgrade or migration project', category: 'infrastructure', projectType: 'waterfall', defaultDuration: 90, phases: JSON.stringify([{name:'Assessment',tasks:[{name:'Current state audit'},{name:'Requirements analysis'},{name:'Risk assessment'}]},{name:'Design',tasks:[{name:'Architecture design'},{name:'Security review'},{name:'Capacity planning'}]},{name:'Implementation',tasks:[{name:'Environment setup'},{name:'Data migration'},{name:'Configuration'}]},{name:'Cutover',tasks:[{name:'Testing'},{name:'Go-live'},{name:'Monitoring & support'}]}]) },
  { name: 'Event Planning', description: 'Corporate event or conference planning template', category: 'events', projectType: 'hybrid', defaultDuration: 45, phases: JSON.stringify([{name:'Planning',tasks:[{name:'Define objectives'},{name:'Budget planning'},{name:'Venue selection'}]},{name:'Logistics',tasks:[{name:'Vendor coordination'},{name:'Catering'},{name:'AV setup'}]},{name:'Promotion',tasks:[{name:'Invitations'},{name:'Social media'},{name:'Registration'}]},{name:'Execution',tasks:[{name:'Day-of coordination'},{name:'Post-event survey'},{name:'Wrap-up report'}]}]) },
];

/**
 * Seed starter templates into a newly provisioned tenant database.
 * Skips if templates already exist (idempotent).
 */
async function seedStarterTemplates(dbName: string): Promise<void> {
  const pool = databaseService.getPool();
  if (!pool) return;

  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(`SELECT COUNT(*) as cnt FROM \`${dbName}\`.templates`) as any;
    if ((rows as any[])[0]?.cnt > 0) {
      logger.info(`[provisioner] Templates already exist in ${dbName} — skipping seed`);
      return;
    }

    for (const t of STARTER_TEMPLATES) {
      await conn.query(
        `INSERT INTO \`${dbName}\`.templates (id, name, description, category, project_type, default_duration, is_system, phases) VALUES (UUID(), ?, ?, ?, ?, ?, 1, ?)`,
        [t.name, t.description, t.category, t.projectType, t.defaultDuration, t.phases]
      );
    }
    logger.info(`[provisioner] Seeded ${STARTER_TEMPLATES.length} starter templates into ${dbName}`);
  } catch (err: any) {
    // Non-fatal — org works without templates
    logger.warn(`[provisioner] Failed to seed templates into ${dbName}: ${err.message}`);
  } finally {
    conn.release();
  }
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
