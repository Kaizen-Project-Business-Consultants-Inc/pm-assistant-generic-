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

/**
 * What a new account is given on day one.
 *
 * These used to be generic internal-project starters — Software Development, Marketing
 * Campaign, Event Planning — which describe work inside an ordinary company. That is not
 * who this product is for. The buyer is a PM consultant delivering engagements for
 * clients, so the starters are engagement shapes: staged acceptance, gates that usually
 * coincide with payment, and a hypercare period rather than a cliff edge at handover.
 *
 * These are the simple phase-and-task starters shown in onboarding. The richer built-in
 * templates in services/templates/consultingEngagements.ts carry the full scaffold —
 * dependencies, gate milestones, starter RAID items and a report cadence — and are what
 * a consultant should graduate to.
 */
const STARTER_TEMPLATES = [
  {
    name: 'System Implementation Engagement',
    description: 'Implementing a system for a client with staged acceptance: discovery, design sign-off, build, testing, go-live and hypercare.',
    category: 'engagement',
    projectType: 'waterfall',
    defaultDuration: 300,
    phases: JSON.stringify([
      { name: 'Inception', tasks: [{ name: 'Kick-off and governance setup' }, { name: 'Desk review of existing documentation' }, { name: 'Inception report and baselined plan' }, { name: 'Gate 1 — Inception accepted' }] },
      { name: 'Study and design', tasks: [{ name: 'Detailed system study and gap analysis' }, { name: 'Solution design specification' }, { name: 'Design walkthrough and sign-off' }, { name: 'Gate 2 — Design accepted' }] },
      { name: 'Configuration and build', tasks: [{ name: 'Environment setup' }, { name: 'Core configuration' }, { name: 'Integrations' }, { name: 'Data migration preparation and trial run' }] },
      { name: 'Testing', tasks: [{ name: 'Test plan and scripts agreed' }, { name: 'System integration testing' }, { name: 'Defect remediation and regression' }, { name: 'Client user acceptance testing' }, { name: 'Gate 3 — Acceptance testing signed off' }] },
      { name: 'Go-live and transition', tasks: [{ name: 'Training and user manuals' }, { name: 'Production cutover' }, { name: 'Hypercare' }, { name: 'Knowledge transfer and formal closure' }, { name: 'Gate 4 — Engagement closed' }] },
    ]),
  },
  {
    name: 'Discovery and Assessment Engagement',
    description: 'A short diagnostic producing findings and a recommendation. Fixed scope, fixed price.',
    category: 'engagement',
    projectType: 'waterfall',
    defaultDuration: 45,
    phases: JSON.stringify([
      { name: 'Mobilisation', tasks: [{ name: 'Agree scope, access and interviewees' }] },
      { name: 'Evidence gathering', tasks: [{ name: 'Stakeholder interviews' }, { name: 'Document and data review' }] },
      { name: 'Analysis', tasks: [{ name: 'Findings, options and recommendation' }] },
      { name: 'Reporting', tasks: [{ name: 'Draft report and client review' }, { name: 'Final report and presentation' }, { name: 'Gate — Report accepted' }] },
    ]),
  },
  {
    name: 'Process Improvement Engagement',
    description: 'Baseline the current process, design the improved one, pilot it, then embed it with measurement to evidence the benefit.',
    category: 'engagement',
    projectType: 'hybrid',
    defaultDuration: 120,
    phases: JSON.stringify([
      { name: 'Mobilisation', tasks: [{ name: 'Scope confirmation and success measures' }] },
      { name: 'Baseline', tasks: [{ name: 'Process mapping with the people who do the work' }, { name: 'Baseline measurement' }, { name: 'Gate — Baseline agreed' }] },
      { name: 'Design', tasks: [{ name: 'Target process, controls and roles' }] },
      { name: 'Pilot', tasks: [{ name: 'Run the pilot' }, { name: 'Measure against the baseline' }, { name: 'Gate — Pilot accepted' }] },
      { name: 'Roll out and embed', tasks: [{ name: 'Train and document' }, { name: 'Transfer ownership' }, { name: 'Gate — Engagement closed' }] },
    ]),
  },
  {
    name: 'PMO / Project Management Support',
    description: 'You are the PM on the client\'s delivery: establish governance and controls, then run the reporting, risk and change cadence.',
    category: 'engagement',
    projectType: 'waterfall',
    defaultDuration: 180,
    phases: JSON.stringify([
      { name: 'Establish controls', tasks: [{ name: 'Governance and reporting structure' }, { name: 'Integrated plan and baseline' }, { name: 'Risk and issue process stood up' }, { name: 'Gate — Controls established' }] },
      { name: 'Run the delivery cadence', tasks: [{ name: 'Reporting and steering committee cycle' }, { name: 'Risk, issue and change control' }, { name: 'Mid-point health check and re-baseline if needed' }] },
      { name: 'Closure', tasks: [{ name: 'Handover of controls' }, { name: 'Lessons learned' }, { name: 'Gate — Engagement closed' }] },
    ]),
  },
  {
    name: 'Programme of Works',
    description: 'Several related engagements under one programme, with a shared plan and one set of governance.',
    category: 'engagement',
    projectType: 'waterfall',
    defaultDuration: 365,
    phases: JSON.stringify([
      { name: 'Programme setup', tasks: [{ name: 'Programme governance and reporting' }, { name: 'Integrated programme plan' }, { name: 'Benefits and success measures agreed' }] },
      { name: 'Tranche 1', tasks: [{ name: 'Deliver tranche 1' }, { name: 'Tranche 1 acceptance' }] },
      { name: 'Tranche 2', tasks: [{ name: 'Deliver tranche 2' }, { name: 'Tranche 2 acceptance' }] },
      { name: 'Programme closure', tasks: [{ name: 'Benefits realisation review' }, { name: 'Handover and closure' }] },
    ]),
  },
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

  const essentialTables = ['projects', 'schedules', 'tasks', '_migrations'];

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
