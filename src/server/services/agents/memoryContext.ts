import { agentMemoryService, AgentMemory } from '../AgentMemoryService';
import { skillRegistryService } from '../context/SkillRegistryService';

export interface MemoryContext {
  reflections: Array<{ action: string; decision: string; reasoning: string; outcome: string; timestamp: string }>;
  projectMemories: Array<{ key: string; value: unknown; updatedAt: string }>;
  crossAgentInsights: Array<{ agentId: string; key: string; value: unknown; updatedAt: string }>;
  skillCatalog?: string;
}

/**
 * Fetches relevant agent memories to include as context in reasoning prompts.
 * Called by ReasoningEngine generators before generating insights.
 */
export async function getMemoryContext(agentId: string, projectId: string): Promise<MemoryContext> {
  const [reflections, projectMemories, allProjectMemories] = await Promise.all([
    agentMemoryService.getReflections(agentId, projectId, 5),
    agentMemoryService.recall(agentId, 'project', projectId),
    getProjectMemoriesFromAllAgents(projectId),
  ]);

  return {
    reflections: reflections.map(formatReflection),
    projectMemories: projectMemories.map(m => ({
      key: m.keyName,
      value: m.value,
      updatedAt: m.updatedAt,
    })),
    crossAgentInsights: allProjectMemories
      .filter(m => m.agentId !== agentId)
      .slice(0, 10)
      .map(m => ({
        agentId: m.agentId,
        key: m.keyName,
        value: m.value,
        updatedAt: m.updatedAt,
      })),
  };
}

function formatReflection(mem: AgentMemory) {
  const val = mem.value as any;
  return {
    action: val?.action || '',
    decision: val?.decision || '',
    reasoning: val?.reasoning || '',
    outcome: val?.outcome || '',
    timestamp: val?.timestamp || mem.updatedAt,
  };
}

async function getProjectMemoriesFromAllAgents(projectId: string): Promise<AgentMemory[]> {
  // Query all project-type memories for this project regardless of agent
  const { databaseService } = await import('../../database/connection');
  const rows = await databaseService.query<any>(
    `SELECT * FROM agent_memory
     WHERE memory_type = 'project' AND entity_id = ?
     AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY updated_at DESC
     LIMIT 20`,
    [projectId],
  );
  return rows.map((row: any) => ({
    id: row.id,
    agentId: row.agent_id,
    memoryType: row.memory_type,
    entityId: row.entity_id,
    keyName: row.key_name,
    value: typeof row.value === 'string' ? JSON.parse(row.value) : row.value,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Formats memory context into a string suitable for inclusion in Claude prompts.
 */
export function formatMemoryContextForPrompt(ctx: MemoryContext): string {
  const parts: string[] = [];

  if (ctx.reflections.length > 0) {
    parts.push('## Past Reflections (from your previous analyses of this project)');
    for (const r of ctx.reflections) {
      parts.push(`- [${r.timestamp}] Action: ${r.action} | Decision: ${r.decision} | Outcome: ${r.outcome}`);
    }
  }

  if (ctx.crossAgentInsights.length > 0) {
    parts.push('\n## Insights from Other Agents');
    for (const ins of ctx.crossAgentInsights) {
      const summary = typeof ins.value === 'object' && ins.value !== null
        ? JSON.stringify(ins.value).slice(0, 200)
        : String(ins.value).slice(0, 200);
      parts.push(`- [${ins.agentId}] ${ins.key}: ${summary}`);
    }
  }

  if (ctx.skillCatalog) {
    parts.push('\n' + ctx.skillCatalog);
  }

  return parts.length > 0 ? parts.join('\n') : '';
}

/**
 * Enhanced memory context that includes skill catalog front-matter.
 */
export async function getMemoryContextWithSkills(
  agentId: string,
  projectId: string,
  userRole: string,
): Promise<MemoryContext & { skillCatalog: string }> {
  const [baseCtx, skills] = await Promise.all([
    getMemoryContext(agentId, projectId),
    skillRegistryService.getSkillsForRole(userRole).catch(() => []),
  ]);

  const skillCatalog = skillRegistryService.formatSkillCatalogForPrompt(skills);

  return { ...baseCtx, skillCatalog };
}
