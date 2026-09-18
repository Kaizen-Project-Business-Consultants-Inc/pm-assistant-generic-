/**
 * Give every existing account owner the resource record they should have had at signup.
 *
 * Invitees have always received one; owners never did, so the person paying for the
 * account is the only member of their own team who cannot be assigned to a task and is
 * missing from workload, capacity and resource reports.
 *
 * Idempotent and conservative: skips an org whose owner already has a resource, and
 * skips any org that is not provisioned. Run it as often as you like.
 *
 *   node dist/server/scripts/backfillOwnerResources.js [--dry-run]
 */
import { databaseService } from '../database/connection';
import { runWithTenantContext } from '../middleware/requestContext';

const DRY_RUN = process.argv.includes('--dry-run');

interface OwnerRow {
  org_id: string;
  db_name: string;
  org_name: string;
  user_id: string;
  email: string;
  full_name: string | null;
  username: string;
  role: string;
}

async function run() {
  const owners = await databaseService.queryControlPlane(
    `SELECT o.id AS org_id, o.db_name, o.name AS org_name,
            u.id AS user_id, u.email, u.full_name, u.username, u.role
       FROM organizations o
       JOIN users u ON u.id = o.owner_user_id
      WHERE o.is_provisioned = 1 AND o.is_active = 1 AND u.is_active = 1`,
  ) as OwnerRow[];

  console.log(`[backfill] ${owners.length} provisioned org(s) with an active owner${DRY_RUN ? ' (DRY RUN)' : ''}`);

  let created = 0;
  let linked = 0;
  let skipped = 0;

  for (const o of owners) {
    try {
      await runWithTenantContext(o.db_name, o.org_id, async () => {
        const existing = await databaseService.query(
          'SELECT id, user_id FROM resources WHERE user_id = ? OR LOWER(email) = LOWER(?) LIMIT 1',
          [o.user_id, o.email],
        ) as Array<{ id: string; user_id: string | null }>;

        if (existing.length > 0) {
          const row = existing[0];
          if (row.user_id) {
            console.log(`  = ${o.email} (${o.org_name}): already has a resource`);
            skipped++;
            return;
          }
          // A resource with their email exists but was never linked — link it.
          console.log(`  ~ ${o.email} (${o.org_name}): linking existing resource ${row.id}`);
          if (!DRY_RUN) {
            await databaseService.query('UPDATE resources SET user_id = ? WHERE id = ?', [o.user_id, row.id]);
          }
          linked++;
          return;
        }

        console.log(`  + ${o.email} (${o.org_name}): creating resource`);
        if (!DRY_RUN) {
          const { resourceService } = await import('../services/ResourceService');
          await resourceService.createResource({
            name: o.full_name || o.username || o.email.split('@')[0],
            role: o.role,
            email: o.email,
            capacityHoursPerWeek: 40,
            skills: [],
            isActive: true,
            costRateHourly: null,
            overtimeRateHourly: null,
            resourceGroup: null,
            userId: o.user_id,
            calendarTemplateId: null,
          } as any);
        }
        created++;
      });
    } catch (err) {
      console.error(`  ! ${o.email} (${o.org_name}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`[backfill] ${created} created, ${linked} linked, ${skipped} already had one${DRY_RUN ? ' (nothing written)' : ''}`);
}

run()
  .catch((err) => {
    console.error('[backfill] FAILED', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await databaseService.close();
  });
