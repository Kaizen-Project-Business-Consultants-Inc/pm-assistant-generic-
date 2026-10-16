import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getApiClientFromExtra, jsonResult } from '../api-client.js';

export function registerIntegrationTools(server: McpServer) {
  server.tool('list-integrations', 'List configured integrations', {}, async (_args, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get('/integrations'))
  );

  server.tool('create-integration', 'Create a new integration', {
    provider: z.string().describe('Integration type (e.g. jira, github, slack)'),
    config: z.record(z.unknown()).describe('Integration configuration'),
    projectId: z.string().optional().describe('Limit it to one project (leave out for all projects)'),
  }, async (params, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post('/integrations', params))
  );

  server.tool('sync-integration', 'Trigger a sync for an integration', {
    integrationId: z.string().describe('Integration ID'),
    direction: z.enum(['push', 'pull']).describe('push = send Kovarti changes out; pull = bring the other system\'s changes in'),
  }, async ({ integrationId, direction }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post(`/integrations/${integrationId}/sync`, { direction }))
  );

  server.tool('send-slack-message', 'Send a message to all Slack channels configured for a project', {
    projectId: z.string().describe('Project ID'),
    text: z.string().describe('Message text to send'),
  }, async (params, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post('/slack/send', params))
  );

  server.tool('test-slack-connection', 'Test Slack webhook connection for a project', {
    projectId: z.string().describe('Project ID'),
  }, async (params, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post('/slack/test', params))
  );

  server.tool('list-slack-channels', 'List active Slack integrations (channels) across all projects', {}, async (_args, extra) => {
    const result = await getApiClientFromExtra(extra).get('/integrations') as { integrations?: any[] };
    const integrations = result.integrations || [];
    const slackIntegrations = integrations.filter((i: any) => i.provider === 'slack' && i.isActive);
    return { content: [{ type: 'text' as const, text: JSON.stringify(slackIntegrations, null, 2) }] };
  });
}
