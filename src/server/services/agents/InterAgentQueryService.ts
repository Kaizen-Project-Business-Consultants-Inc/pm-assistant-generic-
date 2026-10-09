import { agentMemoryService, AgentMemory } from '../AgentMemoryService';

export interface AgentInsight {
  agentId: string;
  projectId: string;
  key: string;
  value: unknown;
  updatedAt: string;
}

/**
 * Allows agents to query what other agents concluded during current or recent scans.
 * Uses the agent_memory table (type='project') — no new tables needed.
 */
export class InterAgentQueryService {
  /**
   * Get the latest insight from a specific agent for a specific project.
   */
  async getLatestInsight(agentId: string, projectId: string): Promise<AgentInsight | null> {
    const memories = await agentMemoryService.recall(agentId, 'project', projectId, 'latest_scan');
    if (memories.length === 0) return null;
    const m = memories[0];
    return {
      agentId: m.agentId,
      projectId: m.entityId || projectId,
      key: m.keyName,
      value: m.value,
      updatedAt: m.updatedAt,
    };
  }

  /**
   * Get all latest scan results for a specific project across all agents.
   */
  async getInsightsByProject(projectId: string): Promise<AgentInsight[]> {
    // through the service, so it is never read without a company selected (2026-10-09)
    const memories = await agentMemoryService.recallByEntity('project', projectId, 'latest_scan');
    return memories.map(m => ({
      agentId: m.agentId,
      projectId: m.entityId || projectId,
      key: m.keyName,
      value: m.value,
      updatedAt: m.updatedAt,
    }));
  }

  /**
   * Get insights from a specific agent across all projects.
   */
  async getInsightsByAgent(agentId: string): Promise<AgentInsight[]> {
    const memories = await agentMemoryService.recall(agentId, 'project');
    return memories
      .filter(m => m.keyName === 'latest_scan')
      .map(m => ({
        agentId: m.agentId,
        projectId: m.entityId || '',
        key: m.keyName,
        value: m.value,
        updatedAt: m.updatedAt,
      }));
  }
}

export const interAgentQueryService = new InterAgentQueryService();
