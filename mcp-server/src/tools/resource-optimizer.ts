import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getApiClientFromExtra, jsonResult } from '../api-client.js';

export function registerResourceOptimizerTools(server: McpServer) {
  server.tool('forecast-resource-bottlenecks', 'Predict resource bottlenecks and capacity forecast for a project', {
    projectId: z.string().describe('Project ID'),
    weeksAhead: z.number().optional().describe('Weeks to forecast (default 8, max 52)'),
  }, async ({ projectId, weeksAhead }, extra) => {
    const qs = weeksAhead ? `?weeksAhead=${weeksAhead}` : '';
    return jsonResult(await getApiClientFromExtra(extra).get(`/resource-optimizer/${projectId}/forecast${qs}`));
  });

  server.tool('find-skill-match', 'Find the best-matched resources for a task based on skills and availability', {
    taskId: z.string().describe('Task ID'),
    scheduleId: z.string().describe('Schedule ID'),
  }, async (params, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post('/resource-optimizer/skill-match', params))
  );
}
