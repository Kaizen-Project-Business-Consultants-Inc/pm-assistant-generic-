import { claudeService } from './claudeService';
import { projectService } from './ProjectService';
import { scheduleService } from './ScheduleService';
import { resourceService } from './ResourceService';
import { insightAssemblyService } from './agents/InsightAssemblyService';
import { sanitizeForPrompt } from '../utils/promptSanitizer';

type UserRole = 'admin' | 'executive' | 'project_manager' | 'team_member' | 'scrum_master' | 'finance_officer' | 'risk_manager' | 'pmo' | 'ba' | 'qa' | 'tester' | 'devops' | 'claude_sme' | 'viewer';

export class NarrativeService {
  async generateProjectNarrative(projectId: string, role: UserRole): Promise<string> {
    const project = await projectService.findById(projectId);
    if (!project) return 'Project not found.';

    if (!claudeService.isAvailable()) {
      return this.generateFallbackProjectNarrative(project, role);
    }

    const insights = await insightAssemblyService.assembleForProject(projectId);
    const schedules = await scheduleService.findByProjectId(projectId);
    const allTasks = await scheduleService.findTasksByScheduleIds(schedules.map(s => s.id));
    const totalTasks = allTasks.length;
    const completedTasks = allTasks.filter(t => t.status === 'completed').length;

    // Fetch resource workload summary
    let resourceSummary = '';
    try {
      const workload = await resourceService.computeWorkload(projectId);
      if (workload.length > 0) {
        const overAlloc = workload.filter(w => w.isOverAllocated).length;
        const avgUtil = Math.round(workload.reduce((s, w) => s + w.averageUtilization, 0) / workload.length);
        resourceSummary = `\nResources: ${workload.length} assigned, ${overAlloc} over-allocated, ${avgUtil}% avg utilization`;
      }
    } catch {
      // Non-critical
    }

    const roleFocus = this.getRoleFocus(role);
    const projectName = sanitizeForPrompt(project.name);

    const prompt = `Generate a brief (2-3 sentence) plain-language summary of project "${projectName}" for a ${role.replace('_', ' ')}.

Project status: ${project.status}
Tasks: ${completedTasks}/${totalTasks} complete
Budget: $${project.budgetSpent || 0} of $${project.budgetAllocated || 0} spent
Health: ${insights.overallHealth}
Agent findings: ${insights.agentFindings.map(f => `${f.agent}: ${f.finding}`).join('; ') || 'None'}${resourceSummary}

Focus on: ${roleFocus}
Write in plain language, no markdown. Be concise and actionable.`;

    try {
      const result = await claudeService.complete({
        feature: 'narrative',
        tier: 'light', // routine job: the cheaper model
        systemPrompt: 'You are a project intelligence assistant. Generate brief, role-appropriate narrative summaries. No markdown formatting.',
        userMessage: prompt,
        maxTokens: 300,
        temperature: 0.4,
      });
      return result.content.trim();
    } catch {
      return this.generateFallbackProjectNarrative(project, role);
    }
  }

  async generatePortfolioNarrative(role: UserRole, asker?: { userId: string; role: string }): Promise<string> {
    // The asker's projects only (all of them for admin/PMO/executive) — it used every project
    const allProjects = asker ? await projectService.findAccessible(asker) : await projectService.findAll();
    // The sample project never counts in the portfolio
    const activeProjects = allProjects.filter(p => !p.isDemo && (p.status === 'active' || p.status === 'planning'));

    if (!claudeService.isAvailable()) {
      return this.generateFallbackPortfolioNarrative(activeProjects, role);
    }

    const roleFocus = this.getRoleFocus(role);
    const projectSummaries = activeProjects.slice(0, 10).map(p => {
      const pctSpent = p.budgetAllocated ? Math.round(((p.budgetSpent || 0) / p.budgetAllocated) * 100) : 0;
      return `- ${sanitizeForPrompt(p.name)}: status=${p.status}, budget ${pctSpent}% spent`;
    }).join('\n');

    const prompt = `Generate a brief (2-3 sentence) portfolio summary for a ${role.replace('_', ' ')}.

Active projects (${activeProjects.length}):
${projectSummaries}

Focus on: ${roleFocus}
Write in plain language, no markdown. Be concise and actionable.`;

    try {
      const result = await claudeService.complete({
        feature: 'narrative',
        tier: 'light', // routine job: the cheaper model
        systemPrompt: 'You are a project intelligence assistant. Generate brief, role-appropriate portfolio summaries. No markdown formatting.',
        userMessage: prompt,
        maxTokens: 300,
        temperature: 0.4,
      });
      return result.content.trim();
    } catch {
      return this.generateFallbackPortfolioNarrative(activeProjects, role);
    }
  }

  private getRoleFocus(role: UserRole): string {
    switch (role) {
      case 'finance_officer': return 'budget utilization, cost variances, and financial risks';
      case 'scrum_master': return 'sprint progress, velocity trends, and team blockers';
      case 'executive': return 'high-level status, strategic risks, and portfolio health';
      case 'admin': return 'system health, resource allocation, and cross-project dependencies';
      case 'project_manager': return 'schedule adherence, task completion, resource capacity and bottlenecks, and immediate risks';
      case 'pmo': return 'portfolio health, resource capacity and bottlenecks, cross-project dependencies, and governance';
      case 'team_member': return 'upcoming deadlines, assigned work, and blockers';
      default: return 'overall project health and key action items';
    }
  }

  private generateFallbackProjectNarrative(project: any, role: UserRole): string {
    const budgetPct = project.budgetAllocated
      ? Math.round(((project.budgetSpent || 0) / project.budgetAllocated) * 100)
      : 0;
    return `${project.name} is currently ${project.status}. Budget utilization is at ${budgetPct}%.`;
  }

  private generateFallbackPortfolioNarrative(projects: any[], role: UserRole): string {
    return `You have ${projects.length} active project(s) in your portfolio.`;
  }
}

export const narrativeService = new NarrativeService();
