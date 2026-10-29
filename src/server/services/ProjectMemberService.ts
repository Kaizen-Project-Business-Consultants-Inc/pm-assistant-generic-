import { projectMemberRepository, ProjectMember } from '../database/ProjectMemberRepository';
import { databaseService } from '../database/connection';
import { userService } from './UserService';

export type { ProjectMember } from '../database/ProjectMemberRepository';
export type ProjectRole = 'owner' | 'manager' | 'editor' | 'viewer';

// "editor" was removed from the product (Sep 2026) — anyone still holding it is read-only
const ROLE_HIERARCHY: Record<ProjectRole, number> = {
  owner: 4,
  manager: 3,
  editor: 1,
  viewer: 1,
};

export class LastOwnerError extends Error {
  constructor() { super('A project needs at least one Owner. Make someone else Owner first.'); }
}

export class OneOwnerError extends Error {
  constructor() { super('A project has one Owner. To hand the project over, use "Make Owner" (the company owner can do it too).'); }
}

export class ProjectMemberService {
  async findByProjectId(projectId: string): Promise<ProjectMember[]> {
    return projectMemberRepository.findByProjectId(projectId);
  }

  /**
   * The members as the screens list them: userName is the person's CURRENT full name. The stored
   * user_name is a copy taken when they were added — often their email, or a name since changed
   * (U36). Falls back to that copy (people not signed up yet, or with no full name), then the email.
   * One control-plane query for all of them.
   */
  async findByProjectIdWithNames(projectId: string): Promise<ProjectMember[]> {
    const members = await this.findByProjectId(projectId);
    const ids = members.map(m => m.userId).filter(id => id && !id.startsWith('pending_'));
    const names = await userService.fullNames(ids).catch(() => new Map<string, string>());
    return members.map(m => ({ ...m, userName: names.get(m.userId) || m.userName || m.email }));
  }

  async findByUserId(userId: string): Promise<ProjectMember[]> {
    return projectMemberRepository.findByUserId(userId);
  }

  async findMembership(projectId: string, userId: string): Promise<ProjectMember | undefined> {
    return projectMemberRepository.findMembership(projectId, userId);
  }

  async hasAccess(projectId: string, userId: string): Promise<boolean> {
    return projectMemberRepository.hasAccess(projectId, userId);
  }

  async hasRole(projectId: string, userId: string, minRole: ProjectRole): Promise<boolean> {
    const membership = await this.findMembership(projectId, userId);
    if (!membership) return false;
    return ROLE_HIERARCHY[membership.role] >= ROLE_HIERARCHY[minRole];
  }

  /** One Owner per project (2026-10-29): a second one is refused unless the project is being handed over. Projects that already have several keep them. */
  private async refuseSecondOwner(projectId: string, userId: string, role: ProjectRole, handOver?: boolean): Promise<void> {
    if (role !== 'owner' || handOver) return;
    const owners = (await projectMemberRepository.findByProjectId(projectId)).filter(m => m.role === 'owner');
    if (owners.length > 0 && !owners.some(o => o.userId === userId)) throw new OneOwnerError();
  }

  async addMember(projectId: string, data: { userId: string; userName: string; email: string; role: ProjectRole }, opts: { handOver?: boolean } = {}): Promise<ProjectMember> {
    await this.refuseSecondOwner(projectId, data.userId, data.role, opts.handOver);
    const existing = await this.findMembership(projectId, data.userId);
    if (existing) {
      await projectMemberRepository.updateRole(existing.id, data.role);
      return { ...existing, role: data.role };
    }
    const member = await projectMemberRepository.insert(projectId, data);

    // Fire-and-forget: link any unlinked resource with matching email to this user
    // Skip for pending (unregistered) users
    if (data.email && !data.userId.startsWith('pending_')) {
      databaseService.query(
        'UPDATE resources SET user_id = ? WHERE LOWER(email) = LOWER(?) AND user_id IS NULL',
        [data.userId, data.email],
      ).catch(() => {});
    }

    return member;
  }

  async findMemberById(memberId: string): Promise<ProjectMember | null> {
    return (await projectMemberRepository.findById(memberId)) ?? null;
  }

  /** Throws LastOwnerError rather than leave a project with no Owner. */
  async updateRole(memberId: string, role: ProjectRole): Promise<ProjectMember | null> {
    const member = await projectMemberRepository.findById(memberId);
    if (!member) return null;
    await this.refuseSecondOwner(member.projectId, member.userId, role);
    if (member.role === 'owner' && role !== 'owner') {
      const ownerCount = await projectMemberRepository.countOwners(member.projectId);
      if (ownerCount <= 1) throw new LastOwnerError();
    }
    await projectMemberRepository.updateRole(memberId, role);
    return { ...member, role };
  }

  /**
   * Hands the project to a new Owner: they become Owner, every other Owner becomes a Manager (they keep
   * their place on the team). Refuses someone who has not registered yet. Returns who lost the Owner role.
   */
  async reassignOwner(projectId: string, target: { userId: string; userName: string; email: string }): Promise<{ owner: ProjectMember; previousOwners: ProjectMember[] }> {
    if (target.userId.startsWith('pending_')) throw new Error('pending_user');
    const previousOwners = (await projectMemberRepository.findByProjectId(projectId)).filter(m => m.role === 'owner' && m.userId !== target.userId);
    const owner = await this.addMember(projectId, { ...target, role: 'owner' }, { handOver: true });
    for (const o of previousOwners) {
      // eslint-disable-next-line no-await-in-loop -- one Owner, rarely a few on older projects
      await projectMemberRepository.updateRole(o.id, 'manager');
    }
    return { owner, previousOwners };
  }

  async removeMember(memberId: string): Promise<boolean> {
    const member = await projectMemberRepository.findById(memberId);
    if (!member) return false;

    if (member.role === 'owner') {
      const ownerCount = await projectMemberRepository.countOwners(member.projectId);
      if (ownerCount <= 1) return false;
    }

    const deleted = await projectMemberRepository.deleteMember(memberId);
    // Their open screens stop getting the project's live updates now, not at their next reconnect
    // (lazy: the live-update service loads the project repository, which loads this file's peers)
    if (deleted) void import('./WebSocketService').then(({ WebSocketService }) => WebSocketService.recheckProject(member.projectId)).catch(() => {});
    return deleted;
  }

  async findByEmail(projectId: string, email: string): Promise<ProjectMember | undefined> {
    return projectMemberRepository.findByEmail(projectId, email);
  }

  async findUserByEmail(email: string): Promise<{ id: string; fullName: string; email: string } | null> {
    return projectMemberRepository.findUserByEmail(email);
  }
}

export const projectMemberService = new ProjectMemberService();
