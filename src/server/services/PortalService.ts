import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { portalRepository, PortalLink, PortalComment } from '../database/PortalRepository';

export type { PortalLink, PortalComment } from '../database/PortalRepository';

/** Strip HTML tags from user-supplied strings to prevent stored XSS. */
function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, '').trim();
}

class PortalService {
  async createLink(
    projectId: string,
    permissions: Record<string, boolean>,
    createdBy: string,
    label?: string,
    expiresAt?: string,
  ): Promise<PortalLink> {
    const id = uuidv4();
    const token = crypto.randomBytes(32).toString('hex');
    return portalRepository.insertLink(id, projectId, token, label || null, permissions, expiresAt || null, createdBy);
  }

  async getLinks(projectId: string): Promise<PortalLink[]> {
    return portalRepository.findLinksByProject(projectId);
  }

  async getLinkById(id: string): Promise<PortalLink | null> {
    return portalRepository.findLinkById(id);
  }

  async updateLink(id: string, data: { label?: string; permissions?: Record<string, boolean>; isActive?: boolean; expiresAt?: string | null }): Promise<PortalLink> {
    const sets: string[] = [];
    const params: any[] = [];
    if (data.label !== undefined) { sets.push('label = ?'); params.push(data.label); }
    if (data.permissions !== undefined) { sets.push('permissions = ?'); params.push(JSON.stringify(data.permissions)); }
    if (data.isActive !== undefined) { sets.push('is_active = ?'); params.push(data.isActive); }
    if (data.expiresAt !== undefined) { sets.push('expires_at = ?'); params.push(data.expiresAt); }
    await portalRepository.updateLink(id, sets, params);
    return (await portalRepository.findLinkById(id))!;
  }

  async deactivateLink(id: string): Promise<void> {
    return portalRepository.deactivateLink(id);
  }

  async deleteLink(id: string): Promise<void> {
    return portalRepository.deleteLink(id);
  }

  async validateToken(token: string): Promise<(PortalLink & { projectName: string; projectStatus: string }) | null> {
    return portalRepository.validateToken(token);
  }

  async getPortalView(token: string): Promise<{
    project: {
      id: string; name: string; status: string; description: string | null;
      budgetAllocated: number; budgetSpent: number;
      startDate: string | null; endDate: string | null;
      progressPercentage: number;
    };
    taskStats: { total: number; completed: number; inProgress: number; notStarted: number };
    timeline: { startDate: string | null; endDate: string | null };
    permissions: Record<string, boolean>;
    comments: PortalComment[];
    milestones: { id: string; name: string; status: string; endDate: string | null }[];
    recentActivity: { id: string; name: string; completedAt: string }[];
  } | null> {
    const link = await this.validateToken(token);
    if (!link) return null;

    const projectId = link.projectId;
    const permissions = link.permissions;

    const projectRow = await portalRepository.getProjectInfo(projectId);
    if (!projectRow) return null;

    const statRows = await portalRepository.getTaskStats(projectId);
    const taskStats = { total: 0, completed: 0, inProgress: 0, notStarted: 0 };
    for (const r of statRows) {
      const cnt = Number(r.count);
      taskStats.total += cnt;
      if (r.status === 'completed' || r.status === 'done') taskStats.completed += cnt;
      else if (r.status === 'in_progress' || r.status === 'in-progress') taskStats.inProgress += cnt;
      else taskStats.notStarted += cnt;
    }

    const progressPercentage = taskStats.total > 0
      ? Math.round((taskStats.completed / taskStats.total) * 100)
      : 0;

    const timelineRow = await portalRepository.getTimeline(projectId);
    const timeline = {
      startDate: timelineRow.min_start || null,
      endDate: timelineRow.max_end || null,
    };

    // Server-side permission enforcement: only query data the token is allowed to see
    const [comments, milestones, recentActivity] = await Promise.all([
      permissions.canComment ? portalRepository.findCommentsByLink(link.id) : Promise.resolve([]),
      permissions.canViewGantt ? portalRepository.getMilestones(projectId) : Promise.resolve([]),
      permissions.canViewReports ? portalRepository.getRecentCompletions(projectId) : Promise.resolve([]),
    ]);

    const project = {
      id: projectRow.id,
      name: projectRow.name,
      status: projectRow.status,
      description: projectRow.description,
      budgetAllocated: permissions.canViewBudget ? (Number(projectRow.budget_allocated) || 0) : 0,
      budgetSpent: permissions.canViewBudget ? (Number(projectRow.budget_spent) || 0) : 0,
      startDate: projectRow.start_date || timeline.startDate,
      endDate: projectRow.end_date || timeline.endDate,
      updatedAt: projectRow.updated_at,
      progressPercentage,
    };

    return { project, taskStats, timeline, permissions, comments, milestones, recentActivity };
  }

  async addComment(
    portalLinkId: string,
    projectId: string,
    entityType: string,
    entityId: string,
    authorName: string,
    content: string,
  ): Promise<PortalComment> {
    const id = uuidv4();
    const safeName = stripHtml(authorName);
    const safeContent = stripHtml(content);
    if (!safeName || !safeContent) throw new Error('Author name and content are required');
    return portalRepository.insertComment(id, portalLinkId, projectId, entityType, entityId, safeName, safeContent);
  }

  async getComments(projectId: string, entityType?: string, entityId?: string, limit = 100): Promise<PortalComment[]> {
    return portalRepository.findComments(projectId, entityType, entityId, limit);
  }
}

export const portalService = new PortalService();
