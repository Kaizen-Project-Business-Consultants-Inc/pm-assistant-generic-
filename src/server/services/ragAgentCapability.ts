import { z } from 'zod';
import { agentRegistry } from './AgentRegistryService';
import { ragService } from './RagService';

// --- RAG Context Agent ---
agentRegistry.register({
  id: 'rag-context-v1',
  capability: 'knowledge.search',
  version: '1.0.0',
  description: 'Searches project knowledge base using semantic similarity (RAG)',
  inputSchema: z.object({
    query: z.string(),
    documentType: z.enum(['lesson', 'meeting', 'knowledge_base']).optional(),
    topK: z.number().optional(),
  }),
  outputSchema: z.object({
    results: z.any(),
    contextString: z.string(),
  }),
  permissions: ['agent:knowledge'],
  timeoutMs: 30000,
  // Meeting notes only from the project it runs for (2026-10-03: it searched every project's
  // meetings); with no project, no meetings at all. Lessons and the knowledge base are company-wide.
  handler: async (input: { query: string; documentType?: 'lesson' | 'meeting' | 'knowledge_base'; topK?: number }, context?: { projectId?: string | null }) => {
    const readableProjectIds = new Set<string>(context?.projectId ? [context.projectId] : []);
    const results = await ragService.search(input.query, {
      documentType: input.documentType,
      topK: input.topK,
      readableProjectIds,
    });
    const contextString = ragService.contextFrom(results);
    return { results, contextString };
  },
});
