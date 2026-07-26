import { projectRepository } from '../database/ProjectRepository';
import { CachedRepository } from '../database/CachedRepository';
import { projectMemberService } from './ProjectMemberService';
import { userService } from './UserService';
import { auditLedgerService } from './AuditLedgerService';
import { policyEngineService } from './PolicyEngineService';
import logger from '../utils/logger';
import { dagWorkflowService } from './DagWorkflowService';
import { deadLetterService } from './DeadLetterService';

const cachedProject = new CachedRepository<Project>(projectRepository, {
  prefix: 'cache:project',
  ttlSeconds: 300,
});

export interface Project {
  id: string;
  name: string;
  description?: string;
  category?: string;
  projectType: 'it' | 'construction' | 'infrastructure' | 'roads' | 'other';
  methodology: 'waterfall' | 'agile' | 'hybrid';
  status: 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  budgetAllocated?: number;
  budgetSpent: number;
  currency: string;
  location?: string;
  locationLat?: number;
  locationLon?: number;
  startDate?: string;
  endDate?: string;
  projectManagerId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface CreateProjectData {
  name: string;
  description?: string;
  category?: string;
  projectType?: 'it' | 'construction' | 'infrastructure' | 'roads' | 'other';
  methodology?: 'waterfall' | 'agile' | 'hybrid';
  status?: 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  budgetAllocated?: number;
  currency?: string;
  location?: string;
  locationLat?: number;
  locationLon?: number;
  startDate?: Date | string;
  endDate?: Date | string;
  userId: string;
}

export class ProjectService {
  async findById(id: string, userId?: string): Promise<Project | null> {
    if (userId) {
      return projectRepository.findByIdForUser(id, userId);
    }
    return cachedProject.findById(id);
  }

  async findByUserId(userId: string): Promise<Project[]> {
    return projectRepository.findByUserId(userId);
  }

  async countByUser(userId: string): Promise<number> {
    return projectRepository.countByUser(userId);
  }

  async findByUserIdPaginated(userId: string, limit: number, offset: number, includeArchived = false): Promise<{ rows: Project[]; total: number }> {
    return projectRepository.findByUserIdPaginated(userId, limit, offset, includeArchived);
  }

  async findAllPaginated(limit: number, offset: number, includeArchived = false): Promise<{ rows: Project[]; total: number }> {
    return projectRepository.findAllPaginated(limit, offset, includeArchived);
  }

  async findAll(): Promise<Project[]> {
    return projectRepository.findAll();
  }

  async findByName(name: string): Promise<Project | null> {
    return projectRepository.findByName(name);
  }

  async create(data: CreateProjectData): Promise<Project> {
    // Policy check
    const policyResult = await policyEngineService.evaluate('project.create', {
      actorId: data.userId,
      entityType: 'project',
      data: { budget_impact: data.budgetAllocated ?? 0 },
    });
    if (!policyResult.allowed) {
      throw new Error(`Blocked by policy: ${policyResult.matchedPolicies.map(p => p.policyName).join(', ')}`);
    }

    const project = await projectRepository.create(data);

    auditLedgerService.append({
      actorId: data.userId,
      actorType: 'user',
      action: 'project.create',
      entityType: 'project',
      entityId: project.id,
      projectId: project.id,
      payload: { after: project },
      source: 'web',
    }).catch(err => deadLetterService.capture('audit.append', {}, err));

    // Auto-add creator as project owner (fire-and-forget)
    (async () => {
      try {
        const creator = await userService.findById(data.userId);
        await projectMemberService.addMember(project.id, {
          userId: data.userId,
          userName: creator?.fullName || creator?.username || 'Unknown',
          email: creator?.email || '',
          role: 'owner',
        });
      } catch (err) {
        deadLetterService.capture('project.auto-add-owner', { projectId: project.id, userId: data.userId }, err as Error);
      }
    })();

    return project;
  }

  async update(id: string, data: Partial<Omit<Project, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>>, userId?: string): Promise<Project | null> {
    const existing = await this.findById(id, userId);
    if (!existing) return null;

    // Policy check
    if (userId) {
      const policyResult = await policyEngineService.evaluate('project.update', {
        actorId: userId,
        entityType: 'project',
        entityId: id,
        projectId: id,
        data: { budget_impact: data.budgetAllocated ?? existing.budgetAllocated ?? 0, status: data.status },
      });
      if (!policyResult.allowed) {
        throw new Error(`Blocked by policy: ${policyResult.matchedPolicies.map(p => p.policyName).join(', ')}`);
      }
    }

    const updated = await projectRepository.update(id, data as Record<string, any>);
    if (!updated) return existing; // no fields to update

    cachedProject.invalidate(id).catch(() => {});

    auditLedgerService.append({
      actorId: userId || existing.createdBy,
      actorType: 'user',
      action: 'project.update',
      entityType: 'project',
      entityId: id,
      projectId: id,
      payload: { before: existing, after: updated, changes: data },
      source: 'web',
    }).catch(err => deadLetterService.capture('audit.append', {}, err));

    // Fire project-level workflow triggers (non-blocking)
    if ('budgetSpent' in data && data.budgetSpent !== existing.budgetSpent) {
      const budgetAllocated = updated.budgetAllocated ?? 0;
      const utilization = budgetAllocated > 0 ? (updated.budgetSpent / budgetAllocated) * 100 : 0;
      dagWorkflowService.evaluateProjectChange(id, 'budget_update', {
        budgetAllocated, budgetSpent: updated.budgetSpent, utilization,
      }).catch(err => logger.error('[Workflow] evaluateProjectChange error:', err));
    }
    if ('status' in data && data.status !== existing.status) {
      dagWorkflowService.evaluateProjectChange(id, 'project_status_change', {
        oldStatus: existing.status, newStatus: updated.status,
      }).catch(err => logger.error('[Workflow] evaluateProjectChange error:', err));
    }

    return updated;
  }

  async delete(id: string, userId?: string): Promise<boolean> {
    const existing = await this.findById(id, userId);

    // Policy check
    if (userId) {
      const policyResult = await policyEngineService.evaluate('project.delete', {
        actorId: userId,
        entityType: 'project',
        entityId: id,
        projectId: id,
      });
      if (!policyResult.allowed) {
        throw new Error(`Blocked by policy: ${policyResult.matchedPolicies.map(p => p.policyName).join(', ')}`);
      }
    }

    const deleted = userId
      ? await projectRepository.deleteForUser(id, userId)
      : await projectRepository.deleteById(id);

    if (deleted) {
      cachedProject.invalidate(id).catch(() => {});
    }

    if (deleted && existing) {
      auditLedgerService.append({
        actorId: userId || existing.createdBy,
        actorType: 'user',
        action: 'project.delete',
        entityType: 'project',
        entityId: id,
        projectId: id,
        payload: { before: existing },
        source: 'web',
      }).catch(err => deadLetterService.capture('audit.append', {}, err));
    }

    return deleted;
  }

  async archiveProject(id: string): Promise<boolean> {
    const result = await projectRepository.archiveProject(id);
    if (result) cachedProject.invalidate(id).catch(() => {});
    return result;
  }

  async unarchiveProject(id: string): Promise<boolean> {
    const result = await projectRepository.unarchiveProject(id);
    if (result) cachedProject.invalidate(id).catch(() => {});
    return result;
  }
}

export const projectService = new ProjectService();
