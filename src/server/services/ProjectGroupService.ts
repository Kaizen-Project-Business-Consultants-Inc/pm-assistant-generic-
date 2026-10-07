import { projectGroupRepository, type ProjectGroup } from '../database/ProjectGroupRepository';
import { projectService } from './ProjectService';
import { databaseService } from '../database/connection';

class ProjectGroupService {
  async getGroups(): Promise<ProjectGroup[]> {
    return projectGroupRepository.findAll();
  }

  async createGroup(data: { name: string; color?: string; icon?: string }, userId: string): Promise<ProjectGroup> {
    const existing = await projectGroupRepository.findByName(data.name);
    if (existing) throw new Error('A group with this name already exists');
    return projectGroupRepository.create({ ...data, createdBy: userId });
  }

  async updateGroup(id: string, data: { name?: string; color?: string; icon?: string }): Promise<ProjectGroup> {
    const group = await projectGroupRepository.findById(id);
    if (!group) throw new Error('Group not found');
    if (data.name && data.name !== group.name) {
      const dup = await projectGroupRepository.findByName(data.name);
      if (dup) throw new Error('A group with this name already exists');
    }
    return projectGroupRepository.update(id, data);
  }

  async deleteGroup(id: string): Promise<void> {
    const group = await projectGroupRepository.findById(id);
    if (!group) throw new Error('Group not found');
    // its projects lose their client: drop them from the project cache too
    const affected = await databaseService.query<{ id: string }>('SELECT id FROM projects WHERE group_id = ?', [id]);
    await projectGroupRepository.delete(id);
    await Promise.all(affected.map(p => projectService.invalidateCache(p.id)));
  }

  async reorderGroups(orderedIds: string[]): Promise<void> {
    return projectGroupRepository.reorder(orderedIds);
  }

  async assignProject(projectId: string, groupId: string): Promise<void> {
    const group = await projectGroupRepository.findById(groupId);
    if (!group) throw new Error('Group not found');
    await projectGroupRepository.assignProject(projectId, groupId);
    // the project is cached for 5 minutes: drop it so its client shows at once (2026-10-07)
    await projectService.invalidateCache(projectId);
  }

  async unassignProject(projectId: string): Promise<void> {
    await projectGroupRepository.unassignProject(projectId);
    await projectService.invalidateCache(projectId);
  }
}

export const projectGroupService = new ProjectGroupService();
