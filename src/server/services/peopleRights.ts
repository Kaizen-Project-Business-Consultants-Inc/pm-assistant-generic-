import { databaseService } from '../database/connection';
import { getRequestContext } from '../middleware/requestContext';
import { organizationService } from './OrganizationService';
import type { Resource } from './ResourceService';

/**
 * Who may do the risky things to the company's people list (user decision 2026-10-05, "Option B").
 *
 * Project managers keep managing ordinary people: add (including people without a login), edit
 * skills, rates, availability and roles, import. Only the COMPANY OWNER or a PMO may:
 *   - choose or change someone's line manager (the person who approves their timesheets)
 *   - change the email of someone who signs in, or add someone whose email belongs to a login
 *   - delete a person who signs in, or remove their login
 * and nobody may do these to the company owner's own record (only the owner, to themselves).
 *
 * Found by the 2026-10-04 audit: these needed only a 'write' role, so a PM could make themselves
 * a coworker's timesheet approver, or re-point a person's email at a coworker's login.
 * Guard: __tests__/routes/peopleRights.test.ts.
 */
export class PeopleRightsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PeopleRightsError';
  }
}

export const MSG = {
  lineManager: 'Only the company owner or a PMO can choose or change a line manager. Leave it as it is — the owner is set by default and can change it.',
  loginEmail: 'This person signs in to Kovarti, so only the company owner or a PMO can change their email.',
  addLogin: 'That email belongs to someone who signs in to Kovarti. Only the company owner or a PMO can add them to the people list.',
  deleteLogin: 'This person signs in to Kovarti. Only the company owner or a PMO can remove them.',
  removeAccess: "Only the company owner or a PMO can remove someone's login.",
  owner: "The company owner's record can't be changed this way by anyone else.",
};

async function companyOwnerId(): Promise<string | null> {
  const orgId = getRequestContext()?.organizationId;
  if (!orgId) return null;
  const [org] = await databaseService.queryControlPlane<{ owner_user_id: string }>(
    'SELECT owner_user_id FROM organizations WHERE id = ? LIMIT 1', [orgId]);
  return org?.owner_user_id ?? null;
}

/** The company owner or a PMO */
export async function canManageLogins(user: { userId: string; role: string } | undefined): Promise<boolean> {
  if (!user) return false;
  if (user.role === 'pmo') return true;
  return (await companyOwnerId()) === user.userId;
}

/** A login of THIS company with that email (its user id), or null */
async function companyLoginFor(email: string | undefined | null): Promise<string | null> {
  const orgId = getRequestContext()?.organizationId;
  if (!orgId || !email?.trim()) return null;
  const [u] = await databaseService.queryControlPlane<{ id: string }>(
    'SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND organization_id = ? LIMIT 1', [email.trim(), orgId]);
  return u?.id ?? null;
}

type Caller = { userId: string; role: string } | undefined;

/** Adding a person (form or import row) */
export async function checkCreate(caller: Caller, data: { email?: string | null; lineManagerUserId?: string | null; isGeneric?: boolean }): Promise<void> {
  if (await canManageLogins(caller)) return;
  if (data.lineManagerUserId) throw new PeopleRightsError(MSG.lineManager);
  if (!data.isGeneric && await companyLoginFor(data.email)) throw new PeopleRightsError(MSG.addLogin);
}

/** Editing a person */
export async function checkUpdate(caller: Caller, existing: Resource, data: { email?: string | null; lineManagerUserId?: string | null }): Promise<void> {
  const owner = await companyOwnerId();
  const emailChanges = 'email' in data && (data.email ?? '').trim().toLowerCase() !== (existing.email ?? '').trim().toLowerCase();
  const managerChanges = 'lineManagerUserId' in data && (data.lineManagerUserId ?? null) !== (existing.lineManagerUserId ?? null);
  if (!emailChanges && !managerChanges) return;
  // the owner's own record: only the owner
  if (owner && existing.userId === owner && caller?.userId !== owner) throw new PeopleRightsError(MSG.owner);
  if (await canManageLogins(caller)) return;
  if (managerChanges) throw new PeopleRightsError(MSG.lineManager);
  if (emailChanges && (existing.userId || await companyLoginFor(data.email))) throw new PeopleRightsError(MSG.loginEmail);
}

/** Deleting people (one or many), optionally removing their login */
export async function checkDelete(caller: Caller, people: Resource[], removeAccess: boolean): Promise<void> {
  const owner = await companyOwnerId();
  if (owner && people.some(p => p.userId === owner)) throw new PeopleRightsError(MSG.owner);
  if (await canManageLogins(caller)) return;
  if (removeAccess) throw new PeopleRightsError(MSG.removeAccess);
  if (people.some(p => p.userId)) throw new PeopleRightsError(MSG.deleteLogin);
}

/**
 * Remove the login linked to this person: they leave the company and can no longer sign in.
 * Only a login of THIS company, never the owner. (The old code looked the company up on the
 * request user, where it isn't stored, so "remove their login" silently did nothing.)
 */
export async function removeLogin(person: Resource): Promise<boolean> {
  const orgId = getRequestContext()?.organizationId;
  const owner = await companyOwnerId();
  const userId = person.userId ?? await companyLoginFor(person.email);
  if (!orgId || !userId || userId === owner) return false;
  await databaseService.queryControlPlane(
    'UPDATE users SET organization_id = NULL, is_active = 0 WHERE id = ? AND organization_id = ?', [userId, orgId]);
  organizationService.invalidateUserCache(userId);
  return true;
}
