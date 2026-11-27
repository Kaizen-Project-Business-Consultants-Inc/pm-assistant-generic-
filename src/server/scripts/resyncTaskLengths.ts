/**
 * One-time clean-up for "one Duration" (user decision 2026-11-27): every task's stored length is set
 * to the working days its own dates cover, using its project's calendar. Headings, milestones and
 * tasks without both dates are left alone; saved baselines are not touched.
 *
 * Safe to re-run: a task already equal to its dates is left untouched.
 *
 *   node dist/server/scripts/resyncTaskLengths.js [--dry-run]
 */
import { databaseService } from '../database/connection';
import { runWithTenantContext } from '../middleware/requestContext';
import { resyncTaskLengths } from '../services/TaskLengthResyncService';

const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
  const orgs = await databaseService.queryControlPlane(
    `SELECT id, db_name, name FROM organizations WHERE is_provisioned = 1 AND is_active = 1`,
  ) as Array<{ id: string; db_name: string; name: string }>;
  console.log(`[task-lengths] ${orgs.length} provisioned compan${orgs.length === 1 ? 'y' : 'ies'}${DRY_RUN ? ' (DRY RUN — nothing is changed)' : ''}`);

  let total = 0;
  for (const org of orgs) {
    try {
      // eslint-disable-next-line no-await-in-loop -- one company at a time: each switches the tenant database
      await runWithTenantContext(org.db_name, org.id, async () => {
        const r = await resyncTaskLengths(DRY_RUN);
        total += r.changed;
        if (r.changed > 0) console.log(`  ${org.name}: ${r.changed} of ${r.checked} task(s)`, r.examples);
        // every changed task with its old and new value (id, old, new): keep this output to be able to reverse the change
        if (!DRY_RUN) for (const line of r.log) console.log(`LOG\t${org.name}\t${line}`);
      });
    } catch (err: any) {
      console.error(`  ! ${org.name}: ${err?.message}`);
    }
  }
  console.log(`[task-lengths] ${DRY_RUN ? 'would change' : 'changed'} ${total} task(s)`);
}

run().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
