import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getApiClientFromExtra, jsonResult } from '../api-client.js';

export function registerLessonsLearnedTools(server: McpServer) {
  server.tool('list-lessons', 'List lessons learned across all projects', {
    limit: z.number().optional().describe('Max results (default 20)'),
    offset: z.number().optional().describe('Offset for pagination'),
  }, async ({ limit, offset }, extra) => {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set('limit', String(limit));
    if (offset !== undefined) params.set('offset', String(offset));
    const qs = params.toString();
    return jsonResult(await getApiClientFromExtra(extra).get(`/lessons-learned${qs ? `?${qs}` : ''}`));
  });

  server.tool('get-knowledge-base', 'Get aggregated knowledge base overview of all lessons learned', {}, async (_args, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get('/lessons-learned/knowledge-base'))
  );

  server.tool('find-relevant-lessons', 'Find lessons relevant to a project type or category', {
    projectType: z.string().optional().describe('Project type (it, web_design, web_application, app_development, construction, infrastructure, roads, other)'),
    category: z.string().optional().describe('Category (schedule, budget, quality, stakeholder, risk, communication, resource, technical)'),
  }, async ({ projectType, category }, extra) => {
    const params = new URLSearchParams();
    if (projectType) params.set('projectType', projectType);
    if (category) params.set('category', category);
    const qs = params.toString();
    return jsonResult(await getApiClientFromExtra(extra).get(`/lessons-learned/relevant${qs ? `?${qs}` : ''}`));
  });

  server.tool('extract-lessons', 'AI-extract lessons learned from a completed or in-progress project', {
    projectId: z.string().describe('Project ID to extract lessons from'),
  }, async ({ projectId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post(`/lessons-learned/extract/${projectId}`, {}))
  );

  server.tool('detect-patterns', 'Detect cross-project patterns from lessons learned', {}, async (_args, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post('/lessons-learned/patterns', {}))
  );

  server.tool('find-similar-lessons', 'Find semantically similar lessons using RAG search', {
    query: z.string().describe('Search query to find similar lessons'),
    topK: z.number().optional().describe('Number of results (default 5)'),
  }, async (params, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post('/lessons-learned/similar', params))
  );

  server.tool('add-lesson', 'Manually add a lesson learned', {
    projectId: z.string().describe('Project ID'),
    projectName: z.string().optional().describe('Project name'),
    projectType: z.string().optional().describe('Project type'),
    category: z.enum(['schedule', 'budget', 'quality', 'stakeholder', 'risk', 'communication', 'resource', 'technical']).describe('Category'),
    title: z.string().describe('Lesson title'),
    description: z.string().describe('What happened'),
    impact: z.enum(['positive', 'negative', 'neutral']).optional().describe('Impact type'),
    recommendation: z.string().describe('Recommendation for future projects'),
  }, async (params, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post('/lessons-learned', params))
  );
}
