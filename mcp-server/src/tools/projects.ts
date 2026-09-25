import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getApiClientFromExtra, jsonResult } from '../api-client.js';

export function registerProjectTools(server: McpServer) {
  server.tool('list-projects', 'List all projects', {}, async (_args, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get('/projects'))
  );

  server.tool('get-project', 'Get detailed info about a specific project', {
    projectId: z.string().describe('Project ID'),
  }, async ({ projectId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get(`/projects/${projectId}`))
  );

  server.tool('create-project', 'Create a new project', {
    name: z.string().describe('Project name'),
    description: z.string().optional().describe('Project description'),
    category: z.string().optional().describe('Project category'),
    projectType: z.enum(['it', 'web_design', 'web_application', 'app_development', 'construction', 'infrastructure', 'roads', 'other']).optional().describe('Project type'),
    methodology: z.enum(['waterfall', 'agile', 'hybrid']).optional().describe('Project methodology — controls default view, tab ordering, and readiness steps'),
    status: z.enum(['planning', 'active', 'on_hold', 'completed', 'cancelled']).optional().describe('Project status'),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().describe('Priority level'),
    budgetAllocated: z.number().optional().describe('Budget amount'),
    currency: z.string().optional().describe('Currency code (e.g. USD)'),
    startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    endDate: z.string().optional().describe('End date (YYYY-MM-DD)'),
  }, async (params, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post('/projects', params))
  );

  server.tool('update-project', 'Update an existing project', {
    projectId: z.string().describe('Project ID'),
    name: z.string().optional().describe('Project name'),
    description: z.string().optional().describe('Project description'),
    projectType: z.enum(['it', 'web_design', 'web_application', 'app_development', 'construction', 'infrastructure', 'roads', 'other']).optional().describe('Project type'),
    methodology: z.enum(['waterfall', 'agile', 'hybrid']).optional().describe('Project methodology — controls default view, tab ordering, and readiness steps'),
    status: z.enum(['planning', 'active', 'on_hold', 'completed', 'cancelled']).optional().describe('Project status'),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().describe('Priority level'),
    budgetAllocated: z.number().optional().describe('Budget amount'),
    startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    endDate: z.string().optional().describe('End date (YYYY-MM-DD)'),
  }, async ({ projectId, ...data }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).put(`/projects/${projectId}`, data))
  );

  server.tool('delete-project', 'Delete a project', {
    projectId: z.string().describe('Project ID'),
  }, async ({ projectId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).delete(`/projects/${projectId}`))
  );

  // Team accounts can't delete-project (403 by design — see that tool's route);
  // this is the actual way to remove a project from view for them.
  server.tool('archive-project', 'Archive a project (the way team accounts remove a project, since they cannot delete)', {
    projectId: z.string().describe('Project ID'),
  }, async ({ projectId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post(`/projects/${projectId}/archive`))
  );

  server.tool('unarchive-project', 'Restore an archived project', {
    projectId: z.string().describe('Project ID'),
  }, async ({ projectId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post(`/projects/${projectId}/unarchive`))
  );
}
