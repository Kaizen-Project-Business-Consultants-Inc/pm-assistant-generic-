import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getApiClientFromExtra, jsonResult } from '../api-client.js';

export function registerRaidTools(server: McpServer) {
  server.tool('list-raid-items', 'List RAID items (risks, issues, actions, decisions) for a project', {
    projectId: z.string().describe('Project ID'),
    type: z.enum(['risk', 'issue', 'action', 'decision']).optional().describe('Filter by RAID type'),
    status: z.string().optional().describe('Filter by status (open, closed, mitigated, resolved, in_progress, completed, etc.)'),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Filter by severity'),
    category: z.string().optional().describe('Filter by category (schedule, budget, resource, technical, regulatory, stakeholder, weather, dependency, other)'),
  }, async ({ projectId, ...filters }, extra) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined) params.set(k, v);
    }
    const qs = params.toString();
    return jsonResult(await getApiClientFromExtra(extra).get(`/projects/${projectId}/risks${qs ? `?${qs}` : ''}`));
  });

  server.tool('get-raid-stats', 'Get RAID summary statistics for a project (counts by type, severity, status)', {
    projectId: z.string().describe('Project ID'),
  }, async ({ projectId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get(`/projects/${projectId}/risks/stats`))
  );

  server.tool('create-raid-item', 'Create a RAID item (risk, issue, action, or decision)', {
    projectId: z.string().describe('Project ID'),
    type: z.enum(['risk', 'issue', 'action', 'decision']).describe('RAID type'),
    title: z.string().describe('Title'),
    description: z.string().optional().describe('Description'),
    category: z.enum(['schedule', 'budget', 'resource', 'technical', 'regulatory', 'stakeholder', 'weather', 'dependency', 'other']).optional().describe('Category'),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Severity'),
    probability: z.number().min(1).max(5).optional().describe('Probability (1-5)'),
    impact: z.number().min(1).max(5).optional().describe('Impact (1-5)'),
    mitigationPlan: z.string().optional().describe('Mitigation plan'),
    responsePlan: z.string().optional().describe('Response plan'),
    triggerCondition: z.string().optional().describe('Trigger condition'),
    ownerId: z.string().optional().describe('Owner user ID'),
    ownerResourceId: z.string().optional().describe('Owner resource ID — use this instead of ownerId for a resource with no login account (e.g. an external subcontractor)'),
    dueDate: z.string().optional().describe('Due date (for actions, YYYY-MM-DD)'),
    actionType: z.enum(['preventive', 'corrective', 'improvement']).optional().describe('Action type (for actions)'),
    rationale: z.string().optional().describe('Rationale (for decisions)'),
    rootCause: z.string().optional().describe('Root cause (for issues)'),
    workaround: z.string().optional().describe('Workaround (for issues)'),
  }, async ({ projectId, ...data }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post(`/projects/${projectId}/risks`, data))
  );

  server.tool('update-raid-item', 'Update a RAID item', {
    projectId: z.string().describe('Project ID'),
    raidItemId: z.string().describe('RAID item ID'),
    title: z.string().optional().describe('Title'),
    description: z.string().optional().describe('Description'),
    status: z.string().optional().describe('Status (open, monitoring, mitigating, mitigated, closed, resolved, in_progress, completed, pending_decision, decided, deferred)'),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Severity'),
    probability: z.number().min(1).max(5).optional().describe('Probability (1-5)'),
    impact: z.number().min(1).max(5).optional().describe('Impact (1-5)'),
    mitigationPlan: z.string().optional().describe('Mitigation plan'),
    responsePlan: z.string().optional().describe('Response plan'),
    ownerId: z.string().optional().describe('Owner user ID'),
    ownerResourceId: z.string().optional().describe('Owner resource ID — use this instead of ownerId for a resource with no login account (e.g. an external subcontractor)'),
  }, async ({ projectId, raidItemId, ...data }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).put(`/projects/${projectId}/risks/${raidItemId}`, data))
  );

  server.tool('ai-scan-risks', 'AI-powered scan to detect risks for a project', {
    projectId: z.string().describe('Project ID'),
  }, async ({ projectId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post(`/projects/${projectId}/risks/ai-scan`, {}))
  );
}
