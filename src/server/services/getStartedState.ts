import { databaseService } from '../database/connection';
import { organizationService } from './OrganizationService';

/**
 * Which steps of the dashboard's Get started card are done (U42/U47/U48, approved mock 2026-10-19):
 * 1 invite your people (company owners on the per-seat Team plan only), 2 create your first project,
 * 3 choose who's on it, 4 build the plan. Read fresh each time the card shows — five small indexed
 * lookups, and the card is only shown until setup is finished.
 */
interface GetStartedState {
  /** Step 1 applies: the company owner on a per-seat (Team) plan */
  canInvite: boolean;
  /** Someone besides you is in the company */
  invited: boolean;
  /** Your oldest project that isn't the sample or archived */
  firstProjectId: string | null;
  /** That project has someone besides you on it */
  projectHasPeople: boolean;
  /** That project's plan has at least one task */
  projectHasTasks: boolean;
}

const NOTHING: GetStartedState = { canInvite: false, invited: false, firstProjectId: null, projectHasPeople: false, projectHasTasks: false };

type Org = NonNullable<Awaited<ReturnType<typeof organizationService.findByUserId>>>;

async function companyStep(org: Org, userId: string): Promise<Pick<GetStartedState, 'canInvite' | 'invited'>> {
  const canInvite = org.ownerUserId === userId && org.billingModel === 'per_seat';
  const [row] = await databaseService.queryControlPlane<{ n: number }>(
    'SELECT COUNT(*) AS n FROM users WHERE organization_id = ? AND id <> ?', [org.id, userId],
  );
  return { canInvite, invited: Number(row?.n ?? 0) > 0 };
}

export async function getStartedState(userId: string): Promise<GetStartedState> {
  // No company (the platform admin, a person between companies): no company database to read
  const org = await organizationService.findByUserId(userId);
  if (!org) return NOTHING;
  const company = await companyStep(org, userId);
  const [project] = await databaseService.query<{ id: string }>(
    `SELECT id FROM projects WHERE created_by = ? AND is_demo = 0 AND archived_at IS NULL
     ORDER BY created_at LIMIT 1`, [userId],
  );
  if (!project) return { ...company, firstProjectId: null, projectHasPeople: false, projectHasTasks: false };

  const [people] = await databaseService.query<{ n: number }>(
    'SELECT COUNT(*) AS n FROM project_members WHERE project_id = ? AND user_id <> ?', [project.id, userId],
  );
  const [tasks] = await databaseService.query<{ n: number }>(
    `SELECT EXISTS(SELECT 1 FROM tasks t JOIN schedules s ON s.id = t.schedule_id WHERE s.project_id = ?) AS n`,
    [project.id],
  );
  return {
    ...company,
    firstProjectId: project.id,
    projectHasPeople: Number(people?.n ?? 0) > 0,
    projectHasTasks: Number(tasks?.n ?? 0) > 0,
  };
}
