/**
 * One-time clean-up when working calendars were switched on (user decision 2026-09-29):
 * every task that starts or finishes on a day off (weekend, company or project holiday)
 * moves to working days, keeping its working-day length; tasks that follow move too.
 * Finished tasks and tasks with actual dates never move. Archived projects are skipped.
 * Each plan that changes gets one Schedule History line with Undo.
 *
 * Safe to re-run: a plan with nothing on a day off is left untouched.
 *
 *   node dist/server/scripts/moveTasksOffDaysOff.js [--dry-run]
 */
import { databaseService } from '../database/connection';
import { runWithTenantContext } from '../middleware/requestContext';
import { workingCalendarService } from '../services/WorkingCalendarService';

const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
  const orgs = await databaseService.queryControlPlane(
    `SELECT id, db_name, name FROM organizations WHERE is_provisioned = 1 AND is_active = 1`,
  ) as Array<{ id: string; db_name: string; name: string }>;
  console.log(`[days-off] ${orgs.length} provisioned compan${orgs.length === 1 ? 'y' : 'ies'}${DRY_RUN ? ' (DRY RUN — nothing is changed)' : ''}`);

  let total = 0;
  for (const org of orgs) {
    try {
      await runWithTenantContext(org.db_name, org.id, async () => {
        const projects = await databaseService.query(
          'SELECT id, name FROM projects WHERE archived_at IS NULL',
        ) as Array<{ id: string; name: string }>;
        for (const p of projects) {
          const res = await workingCalendarService.moveTasksOffDaysOff(p.id, { dryRun: DRY_RUN });
          if (res.tasksMoved > 0) {
            total += res.tasksMoved;
            console.log(`  ${org.name} / ${p.name}: ${res.tasksMoved} task(s)${res.finishBefore !== res.finishAfter ? `, latest finish ${res.finishBefore} → ${res.finishAfter}` : ''}`);
            for (const m of res.moves.slice(0, 5)) console.log(`      ${m.name}: ${m.oldStart}..${m.oldEnd} → ${m.newStart}..${m.newEnd}`);
          }
        }
      });
    } catch (err: any) {
      console.error(`  ! ${org.name}: ${err?.message}`);
    }
  }
  console.log(`[days-off] ${DRY_RUN ? 'would move' : 'moved'} ${total} task(s)`);
}

run().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
