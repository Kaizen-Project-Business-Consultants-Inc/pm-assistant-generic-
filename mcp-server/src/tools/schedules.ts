import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getApiClientFromExtra, jsonResult } from '../api-client.js';

export function registerScheduleTools(server: McpServer) {
  server.tool('list-schedules', 'List schedules for a project', {
    projectId: z.string().describe('Project ID'),
  }, async ({ projectId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get(`/schedules/project/${projectId}`))
  );

  server.tool('create-schedule', 'Create a new schedule', {
    projectId: z.string().describe('Project ID'),
    name: z.string().describe('Schedule name'),
    description: z.string().optional().describe('Description'),
    startDate: z.string().describe('Start date (YYYY-MM-DD)'),
    endDate: z.string().describe('End date (YYYY-MM-DD)'),
  }, async (params, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post('/schedules', params))
  );

  server.tool('update-schedule', 'Update a schedule', {
    scheduleId: z.string().describe('Schedule ID'),
    name: z.string().optional().describe('Schedule name'),
    description: z.string().optional().describe('Description'),
    startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    endDate: z.string().optional().describe('End date (YYYY-MM-DD)'),
  }, async ({ scheduleId, ...data }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).put(`/schedules/${scheduleId}`, data))
  );

  server.tool('delete-schedule', 'Delete a schedule', {
    scheduleId: z.string().describe('Schedule ID'),
  }, async ({ scheduleId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).delete(`/schedules/${scheduleId}`))
  );

  server.tool('get-critical-path', 'Get critical path analysis for a schedule', {
    scheduleId: z.string().describe('Schedule ID'),
  }, async ({ scheduleId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get(`/schedules/${scheduleId}/critical-path`))
  );

  server.tool('list-baselines', 'List baselines for a schedule', {
    scheduleId: z.string().describe('Schedule ID'),
  }, async ({ scheduleId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get(`/schedules/${scheduleId}/baselines`))
  );

  server.tool('remove-dependency', 'Remove a single dependency between two tasks', {
    scheduleId: z.string().describe('Schedule ID'),
    taskId: z.string().describe('The task to remove the dependency from'),
    predecessorId: z.string().describe('The predecessor task to unlink'),
  }, async ({ scheduleId, taskId, predecessorId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).delete(`/schedules/${scheduleId}/tasks/${taskId}/dependencies/${predecessorId}`))
  );

  server.tool('clear-all-dependencies', 'Remove ALL dependencies in a schedule (bulk operation)', {
    scheduleId: z.string().describe('Schedule ID'),
  }, async ({ scheduleId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).delete(`/schedules/${scheduleId}/dependencies`))
  );
}
