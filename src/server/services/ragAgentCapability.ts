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
  handler: async (input: { query: string; documentType?: 'lesson' | 'meeting' | 'knowledge_base'; topK?: number }) => {
    const results = await ragService.search(input.query, {
      documentType: input.documentType,
      topK: input.topK,
    });
    const contextString = await ragService.buildContextString(input.query, input.topK);
    return { results, contextString };
  },
});
