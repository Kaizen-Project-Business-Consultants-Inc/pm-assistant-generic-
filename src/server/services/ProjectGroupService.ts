import { projectGroupRepository, type ProjectGroup } from '../database/ProjectGroupRepository';

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
    return projectGroupRepository.delete(id);
  }

  async reorderGroups(orderedIds: string[]): Promise<void> {
    return projectGroupRepository.reorder(orderedIds);
  }

  async assignProject(projectId: string, groupId: string): Promise<void> {
    const group = await projectGroupRepository.findById(groupId);
    if (!group) throw new Error('Group not found');
    return projectGroupRepository.assignProject(projectId, groupId);
  }

  async unassignProject(projectId: string): Promise<void> {
    return projectGroupRepository.unassignProject(projectId);
  }
}

export const projectGroupService = new ProjectGroupService();
