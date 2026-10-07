import { databaseService } from '../../database/connection';
import { getTenantContext } from '../../middleware/requestContext';

/**
 * Who gets a project's nightly alert: its PM (or creator) if that login still exists and is in
 * this company; otherwise the company owner. A project whose PM's account was removed used to
 * make the alert fail (the notification must point at an existing login — found on staging
 * 2026-10-07: "a foreign key constraint fails"). null = nobody to tell.
 */
export async function alertRecipient(project: { projectManagerId?: string | null; createdBy?: string | null }): Promise<string | null> {
  const orgId = getTenantContext()?.orgId ?? null;
  const candidates = [project.projectManagerId, project.createdBy].filter((x): x is string => !!x);
  if (candidates.length) {
    const rows = await databaseService.queryControlPlane<{ id: string }>(
      `SELECT id FROM users WHERE id IN (${candidates.map(() => '?').join(',')}) AND is_active = 1
         ${orgId ? 'AND organization_id = ?' : ''}`,
      [...candidates, ...(orgId ? [orgId] : [])],
    );
    const found = new Set(rows.map(r => r.id));
    const pick = candidates.find(c => found.has(c));
    if (pick) return pick;
  }
  if (!orgId) return null;
  // the owner — only if that login exists too (an old company's owner can be gone as well)
  const owner = await databaseService.queryControlPlane<{ id: string }>(
    `SELECT u.id FROM organizations o JOIN users u ON u.id = o.owner_user_id AND u.is_active = 1
      WHERE o.id = ? LIMIT 1`, [orgId]);
  return owner[0]?.id ?? null;
}
