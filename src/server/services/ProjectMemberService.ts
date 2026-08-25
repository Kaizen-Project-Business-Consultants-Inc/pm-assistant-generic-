import { projectMemberRepository, ProjectMember } from '../database/ProjectMemberRepository';
import { databaseService } from '../database/connection';

export type { ProjectMember } from '../database/ProjectMemberRepository';
export type ProjectRole = 'owner' | 'manager' | 'editor' | 'viewer';

const ROLE_HIERARCHY: Record<ProjectRole, number> = {
  owner: 4,
  manager: 3,
  editor: 2,
  viewer: 1,
};

export class ProjectMemberService {
  async findByProjectId(projectId: string): Promise<ProjectMember[]> {
    return projectMemberRepository.findByProjectId(projectId);
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

  async addMember(projectId: string, data: { userId: string; userName: string; email: string; role: ProjectRole }): Promise<ProjectMember> {
    const existing = await this.findMembership(projectId, data.userId);
    if (existing) {
      await projectMemberRepository.updateRole(existing.id, data.role);
      return { ...existing, role: data.role };
    }
    const member = await projectMemberRepository.insert(projectId, data);

    // Fire-and-forget: link any unlinked resource with matching email to this user
    if (data.email) {
      databaseService.query(
        'UPDATE resources SET user_id = ? WHERE LOWER(email) = LOWER(?) AND user_id IS NULL',
        [data.userId, data.email],
      ).catch(() => {});
    }

    return member;
  }

  async updateRole(memberId: string, role: ProjectRole): Promise<ProjectMember | null> {
    const member = await projectMemberRepository.findById(memberId);
    if (!member) return null;
    await projectMemberRepository.updateRole(memberId, role);
    return { ...member, role };
  }

  async removeMember(memberId: string): Promise<boolean> {
    const member = await projectMemberRepository.findById(memberId);
    if (!member) return false;

    if (member.role === 'owner') {
      const ownerCount = await projectMemberRepository.countOwners(member.projectId);
      if (ownerCount <= 1) return false;
    }

    return projectMemberRepository.deleteMember(memberId);
  }

  async findUserByEmail(email: string): Promise<{ id: string; fullName: string; email: string } | null> {
    return projectMemberRepository.findUserByEmail(email);
  }
}

export const projectMemberService = new ProjectMemberService();
