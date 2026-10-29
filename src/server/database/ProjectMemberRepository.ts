import { BaseRepository } from './BaseRepository';
import { databaseService } from './connection';
import { v4 as uuidv4 } from 'uuid';
import { forgetReadableProjects } from '../middleware/requestContext';

export interface ProjectMemberRow {
  id: string;
  project_id: string;
  user_id: string;
  user_name: string;
  email: string;
  role: string;
  added_at: string;
}

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  userName: string;
  email: string;
  role: 'owner' | 'manager' | 'editor' | 'viewer';
  addedAt: string;
  /** Set only on the stand-in membership of someone covering for the Owner (project_cover): not a stored row */
  acting?: boolean;
  /** The Owner being covered */
  coveringFor?: string;
  coverId?: string;
  /** Last day of the cover, 'YYYY-MM-DD' */
  coverUntil?: string;
}

function rowToMember(row: any): ProjectMember {
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    userName: row.user_name,
    email: row.email,
    role: row.role,
    addedAt: String(row.added_at),
  };
}

export class ProjectMemberRepository extends BaseRepository<ProjectMember> {
  constructor() {
    super('project_members', rowToMember);
  }

  async findByProjectId(projectId: string): Promise<ProjectMember[]> {
    const rows = await this.queryRaw(
      'SELECT * FROM project_members WHERE project_id = ? ORDER BY added_at',
      [projectId],
    );
    return this.mapRows(rows);
  }

  async findByUserId(userId: string): Promise<ProjectMember[]> {
    const rows = await this.queryRaw(
      'SELECT * FROM project_members WHERE user_id = ? ORDER BY added_at',
      [userId],
    );
    return this.mapRows(rows);
  }

  async findMembership(projectId: string, userId: string): Promise<ProjectMember | undefined> {
    const rows = await this.queryRaw(
      'SELECT * FROM project_members WHERE project_id = ? AND user_id = ?',
      [projectId, userId],
    );
    return rows.length > 0 ? rowToMember(rows[0]) : undefined;
  }

  async hasAccess(projectId: string, userId: string): Promise<boolean> {
    const rows = await this.queryRaw(
      'SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1',
      [projectId, userId],
    );
    return rows.length > 0;
  }

  async insert(projectId: string, data: { userId: string; userName: string; email: string; role: string }): Promise<ProjectMember> {
    const id = uuidv4();
    await this.queryRaw(
      'INSERT INTO project_members (id, project_id, user_id, user_name, email, role) VALUES (?, ?, ?, ?, ?, ?)',
      [id, projectId, data.userId, data.userName, data.email, data.role],
    );
    forgetReadableProjects();
    return {
      id,
      projectId,
      userId: data.userId,
      userName: data.userName,
      email: data.email,
      role: data.role as ProjectMember['role'],
      addedAt: new Date().toISOString(),
    };
  }

  async updateRole(memberId: string, role: string): Promise<void> {
    await this.queryRaw(
      'UPDATE project_members SET role = ? WHERE id = ?',
      [role, memberId],
    );
  }

  async hasOwner(projectId: string): Promise<boolean> {
    return (await this.countOwners(projectId)) > 0;
  }

  async countOwners(projectId: string): Promise<number> {
    const rows = await this.queryRaw(
      'SELECT COUNT(*) as cnt FROM project_members WHERE project_id = ? AND role = ?',
      [projectId, 'owner'],
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  async deleteMember(memberId: string): Promise<boolean> {
    const result: any = await this.queryRaw(
      'DELETE FROM project_members WHERE id = ?',
      [memberId],
    );
    forgetReadableProjects();
    return result.affectedRows > 0;
  }

  /** Remove these people's Viewer memberships (only Viewer: a raised role stays) */
  async deleteViewers(pairs: Array<{ projectId: string; userId: string }>): Promise<void> {
    if (pairs.length === 0) return;
    await this.queryRaw(
      `DELETE FROM project_members WHERE role = 'viewer' AND (project_id, user_id) IN (${pairs.map(() => '(?, ?)').join(',')})`,
      pairs.flatMap(p => [p.projectId, p.userId]),
    );
    forgetReadableProjects();
  }

  async findByEmail(projectId: string, email: string): Promise<ProjectMember | undefined> {
    const rows = await this.queryRaw(
      'SELECT * FROM project_members WHERE project_id = ? AND LOWER(email) = LOWER(?)',
      [projectId, email],
    );
    return rows.length > 0 ? rowToMember(rows[0]) : undefined;
  }

  async findUserByEmail(email: string): Promise<{ id: string; fullName: string; email: string } | null> {
    const rows = await databaseService.queryControlPlane(
      'SELECT id, full_name, email FROM users WHERE email = ? LIMIT 1',
      [email],
    );
    if (rows.length === 0) return null;
    return { id: rows[0].id, fullName: rows[0].full_name, email: rows[0].email };
  }
}

export const projectMemberRepository = new ProjectMemberRepository();
