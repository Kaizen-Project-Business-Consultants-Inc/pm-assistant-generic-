import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getApiClientFromExtra, jsonResult } from '../api-client.js';

export function registerScheduleReviewTools(server: McpServer) {
  server.tool(
    'review-schedule',
    'Run a deterministic Schedule Review and return the health score, band, and findings for a schedule',
    { scheduleId: z.string().describe('Schedule ID') },
    async ({ scheduleId }, extra) =>
      jsonResult(await getApiClientFromExtra(extra).post(`/schedules/${scheduleId}/review`)),
  );

  server.tool(
    'propose-schedule-fixes',
    'Propose structural fixes for a schedule (add dependencies, flag milestones, group into phases, fix durations). Returns proposed fixes for approval; does not apply them.',
    { scheduleId: z.string().describe('Schedule ID') },
    async ({ scheduleId }, extra) =>
      jsonResult(await getApiClientFromExtra(extra).post(`/schedules/${scheduleId}/review/propose`)),
  );
}
