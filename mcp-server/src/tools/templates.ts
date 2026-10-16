import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getApiClientFromExtra, jsonResult } from '../api-client.js';

export function registerTemplateTools(server: McpServer) {
  server.tool('list-templates', 'List project templates', {}, async (_args, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get('/templates'))
  );

  // Field names follow POST /templates/apply (createFromTemplateSchema): it used to send `name`
  // and no start date, so every call was refused with 400 (found 2026-10-15)
  server.tool('apply-template', 'Create a project from a template, with its tasks, starter RAID items and placeholder roles', {
    templateId: z.string().describe('Template ID (from list-templates)'),
    projectName: z.string().describe('New project name'),
    startDate: z.string().describe('Start date (YYYY-MM-DD)'),
    clientId: z.string().optional().describe('The client the project is for (a project group id)'),
    methodology: z.enum(['waterfall', 'agile', 'hybrid']).optional().describe('Defaults to waterfall'),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().describe('Defaults to medium'),
    budget: z.number().positive().optional().describe('Budget in the company currency'),
  }, async (params, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post('/templates/apply', params))
  );

  server.tool('list-workflows', 'List automation workflow rules', {}, async (_args, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get('/workflows'))
  );

  // Field names follow POST /workflows (createDefinitionSchema): a workflow is a graph of nodes
  // (the first is its trigger) joined by edges between node positions
  server.tool('create-workflow', 'Create an automation workflow rule', {
    name: z.string().describe('Workflow name'),
    description: z.string().optional(),
    projectId: z.string().optional().describe('Limit it to one project (leave out for all projects)'),
    nodes: z.array(z.object({
      nodeType: z.enum(['trigger', 'condition', 'action', 'approval', 'delay', 'agent']),
      name: z.string(),
      config: z.record(z.unknown()).describe(
        'A trigger: { "triggerType": "status_change" | "task_created" | "assignment_change" | "date_passed" | "progress_threshold" | "priority_change" | "dependency_change" | "manual", plus e.g. "toStatus": "completed" }. '
        + 'An action: { "actionType": "update_field" (with "field", "value") | "send_notification" (with "title", "message") | "log_activity" (with "message") | "invoke_agent" (with "capabilityId") }. '
        + 'A condition: { "field", "operator": "equals" | "not_equals" | "greater_than" | "less_than" | "contains", "value" }.'),
    })).min(1).describe('The steps; the first is usually the trigger'),
    edges: z.array(z.object({
      sourceIndex: z.number().int().min(0).describe('Position of the step it comes from in nodes'),
      targetIndex: z.number().int().min(0).describe('Position of the step it leads to in nodes'),
    })).describe('How the steps connect'),
  }, async (params, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post('/workflows', params))
  );
}
