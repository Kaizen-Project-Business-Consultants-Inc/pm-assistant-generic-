import { databaseService } from '../database/connection';
import { projectMemberRepository } from '../database/ProjectMemberRepository';
import { resourceRepository } from '../database/ResourceRepository';
import type { Resource } from './ResourceService';

/**
 * A project's team (user 2026-10-14, U8): people picked from the project's client's resource pool
 * or from "My resources". Someone picked who can sign in becomes a project member (viewer), so
 * they see this project — and only the projects whose team they are on. One client's people are
 * never offered on another client's project.
 */
export class TeamPoolError extends Error {}

interface TeamPerson {
  id: string;
  name: string;
  role: string;
  clientId: string | null;
  isGeneric: boolean;
  canSignIn: boolean;
  capacityHoursPerWeek: number;
  roleOnProject?: string | null;
}

const person = (r: Resource, roleOnProject?: string | null): TeamPerson => ({
  id: r.id,
  name: r.name,
  role: r.role,
  clientId: r.clientId ?? null,
  isGeneric: !!r.isGeneric,
  canSignIn: !!r.userId,
  capacityHoursPerWeek: r.capacityHoursPerWeek,
  ...(roleOnProject !== undefined ? { roleOnProject } : {}),
});

interface TeamRow { project_id: string; resource_id: string; granted_view: number }

class ProjectTeamService {
  private async clientOf(projectId: string): Promise<{ id: string | null; name: string | null }> {
    const rows = await databaseService.query<{ group_id: string | null; name: string | null }>(
      `SELECT p.group_id, g.name FROM projects p LEFT JOIN project_groups g ON g.id = p.group_id WHERE p.id = ?`, [projectId]);
    if (!rows[0]) throw new TeamPoolError('That project no longer exists.');
    return { id: rows[0].group_id ?? null, name: rows[0].name ?? null };
  }

  /** The team, and who can be added: the client's pool (if the project has a client) and My resources */
  async pools(projectId: string): Promise<{ client: { id: string | null; name: string | null }; team: TeamPerson[]; clientPool: TeamPerson[]; mine: TeamPerson[] }> {
    const client = await this.clientOf(projectId);
    const teamRows = await databaseService.query<{ resource_id: string; role_on_project: string | null }>(
      'SELECT resource_id, role_on_project FROM project_team WHERE project_id = ?', [projectId]);
    const onTeam = new Map(teamRows.map(r => [r.resource_id, r.role_on_project]));
    const poolRows = await databaseService.query<any>(
      `SELECT id FROM resources WHERE is_active = 1 AND (client_id IS NULL${client.id ? ' OR client_id = ?' : ''}) ORDER BY name LIMIT 1000`,
      client.id ? [client.id] : []);
    const ids = [...new Set([...poolRows.map((r: any) => r.id as string), ...onTeam.keys()])];
    const people = ids.length ? await resourceRepository.findByIds(ids) : [];
    const team = people.filter(p => onTeam.has(p.id)).map(p => person(p, onTeam.get(p.id) ?? null));
    // generic roles hold unstaffed work: never on a team (add() refuses them too)
    const free = people.filter(p => !onTeam.has(p.id) && p.isActive && !p.isGeneric);
    return {
      client,
      team,
      clientPool: client.id ? free.filter(p => p.clientId === client.id).map(p => person(p)) : [],
      mine: free.filter(p => !p.clientId).map(p => person(p)),
    };
  }

  async add(projectId: string, resourceId: string, roleOnProject: string | null, addedBy: string): Promise<void> {
    const client = await this.clientOf(projectId);
    const resource = await resourceRepository.findById(resourceId);
    if (!resource) throw new TeamPoolError('That person no longer exists.');
    if (resource.isGeneric) throw new TeamPoolError('A generic role holds work nobody has yet — add a real person to the team.');
    if (resource.isActive === false) throw new TeamPoolError(`${resource.name} is no longer active, so they can't join the team.`);
    if (resource.clientId && resource.clientId !== client.id) {
      throw new TeamPoolError("That person is in another client's pool, so they can't join this project.");
    }
    // Someone who can sign in sees the project from now on (as a viewer; the PM can change that)
    const grant = !!resource.userId && !(await projectMemberRepository.findMembership(projectId, resource.userId));
    await databaseService.query(
      `INSERT INTO project_team (project_id, resource_id, role_on_project, added_by, granted_view) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE role_on_project = VALUES(role_on_project), granted_view = granted_view OR VALUES(granted_view)`,
      [projectId, resourceId, roleOnProject, addedBy, grant ? 1 : 0]);
    if (grant) {
      await projectMemberRepository.insert(projectId, { userId: resource.userId!, userName: resource.name, email: resource.email, role: 'viewer' });
    }
  }

  async remove(projectId: string, resourceId: string): Promise<void> {
    const rows = await databaseService.query<TeamRow>(
      'SELECT project_id, resource_id, granted_view FROM project_team WHERE project_id = ? AND resource_id = ?', [projectId, resourceId]);
    // only someone on THIS project's team (a resource id from another project changes nothing)
    if (!rows[0]) throw new TeamPoolError("That person isn't on this project's team.");
    await this.dropRows(rows);
  }

  /** People being deleted: off every team (and the viewing the team gave them) */
  async dropPeople(resourceIds: string[]): Promise<void> {
    if (resourceIds.length === 0) return;
    await this.dropRows(await databaseService.query<TeamRow>(
      `SELECT project_id, resource_id, granted_view FROM project_team WHERE resource_id IN (${resourceIds.map(() => '?').join(',')})`, resourceIds));
  }

  /** A project moved client: people from another client's pool leave its team (U8) */
  async dropOutsidePool(projectId: string): Promise<void> {
    await this.dropRows(await databaseService.query<TeamRow>(
      `SELECT pt.project_id, pt.resource_id, pt.granted_view
         FROM project_team pt JOIN resources r ON r.id = pt.resource_id JOIN projects p ON p.id = pt.project_id
        WHERE pt.project_id = ? AND r.client_id IS NOT NULL AND NOT (r.client_id <=> p.group_id)`, [projectId]));
  }

  /** A person moved to another client's pool: they leave the teams of projects outside it (U8) */
  async dropPersonOutsidePool(resourceId: string): Promise<void> {
    await this.dropRows(await databaseService.query<TeamRow>(
      `SELECT pt.project_id, pt.resource_id, pt.granted_view
         FROM project_team pt JOIN resources r ON r.id = pt.resource_id JOIN projects p ON p.id = pt.project_id
        WHERE pt.resource_id = ? AND r.client_id IS NOT NULL AND NOT (r.client_id <=> p.group_id)`, [resourceId]));
  }

  /**
   * Off the team = no longer sees the project, but only a viewing right the team itself gave
   * (granted_view), never a membership the PM gave them separately or raised above Viewer.
   */
  private async dropRows(rows: TeamRow[]): Promise<void> {
    if (rows.length === 0) return;
    const pairs = rows.map(() => '(?, ?)').join(',');
    await databaseService.query(`DELETE FROM project_team WHERE (project_id, resource_id) IN (${pairs})`,
      rows.flatMap(r => [r.project_id, r.resource_id]));
    const granted = rows.filter(r => Number(r.granted_view));
    if (granted.length === 0) return;
    const people = await resourceRepository.findByIds([...new Set(granted.map(r => r.resource_id))]);
    const loginOf = new Map(people.filter(p => p.userId).map(p => [p.id, p.userId as string]));
    await projectMemberRepository.deleteViewers(granted.filter(r => loginOf.has(r.resource_id))
      .map(r => ({ projectId: r.project_id, userId: loginOf.get(r.resource_id)! })));
  }
}

export const projectTeamService = new ProjectTeamService();
