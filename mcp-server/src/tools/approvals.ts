import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getApiClientFromExtra, jsonResult } from '../api-client.js';

export function registerApprovalTools(server: McpServer) {
  server.tool('list-change-requests', 'List change requests for a project', {
    projectId: z.string().describe('Project ID'),
  }, async ({ projectId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get(`/approvals/change-requests/${projectId}`))
  );

  server.tool('create-change-request', 'Create a change request', {
    projectId: z.string().describe('Project ID'),
    title: z.string().describe('Change request title'),
    description: z.string().optional().describe('Description of the change'),
    category: z.enum(['scope', 'schedule', 'budget', 'resource', 'other']).describe('Category'),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).describe('Priority'),
    impactSummary: z.string().optional().describe('Impact assessment summary'),
  }, async ({ projectId, ...data }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post(`/approvals/change-requests/${projectId}`, data))
  );

  server.tool('submit-for-approval', 'Submit a change request for approval', {
    changeRequestId: z.string().describe('Change request ID'),
    workflowId: z.string().describe('The approval workflow to send it through (an approval workflow ID of the project)'),
  }, async ({ changeRequestId, workflowId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post(`/approvals/change-requests/${changeRequestId}/submit`, { workflowId }))
  );

  server.tool('act-on-approval', 'Approve or reject a change request', {
    changeRequestId: z.string().describe('Change request ID'),
    action: z.enum(['approve', 'reject', 'return']).describe('Action to take (return = send back for changes)'),
    comment: z.string().optional().describe('Comment'),
  }, async ({ changeRequestId, ...data }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post(`/approvals/change-requests/${changeRequestId}/action`, data))
  );
}
