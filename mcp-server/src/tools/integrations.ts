import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getApiClientFromExtra, jsonResult } from '../api-client.js';

export function registerIntegrationTools(server: McpServer) {
  server.tool('list-integrations', 'List configured integrations', {}, async (_args, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get('/integrations'))
  );

  server.tool('create-integration', 'Create a new integration', {
    type: z.string().describe('Integration type (e.g. jira, github, slack)'),
    name: z.string().describe('Integration name'),
    config: z.record(z.unknown()).describe('Integration configuration'),
  }, async (params, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post('/integrations', params))
  );

  server.tool('sync-integration', 'Trigger a sync for an integration', {
    integrationId: z.string().describe('Integration ID'),
  }, async ({ integrationId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post(`/integrations/${integrationId}/sync`))
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
    const result = await getApiClientFromExtra(extra).get('/integrations');
    const integrations = result.integrations || [];
    const slackIntegrations = integrations.filter((i: any) => i.provider === 'slack' && i.isActive);
    return { content: [{ type: 'text' as const, text: JSON.stringify(slackIntegrations, null, 2) }] };
  });
}
