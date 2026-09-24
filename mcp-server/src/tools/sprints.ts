import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getApiClientFromExtra, jsonResult } from '../api-client.js';

export function registerSprintTools(server: McpServer) {
  server.tool('list-sprints', 'List sprints for a project', {
    projectId: z.string().describe('Project ID'),
  }, async ({ projectId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get(`/sprints/project/${projectId}`))
  );

  server.tool('get-sprint', 'Get sprint details', {
    sprintId: z.string().describe('Sprint ID'),
  }, async ({ sprintId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get(`/sprints/${sprintId}`))
  );

  server.tool('create-sprint', 'Create a new sprint', {
    projectId: z.string().describe('Project ID'),
    scheduleId: z.string().describe("Schedule ID — required by the server, not derived from projectId (a project can have more than one schedule). Use list-schedules or get-project to find it."),
    name: z.string().describe('Sprint name'),
    goal: z.string().optional().describe('Sprint goal'),
    startDate: z.string().describe('Start date (YYYY-MM-DD)'),
    endDate: z.string().describe('End date (YYYY-MM-DD)'),
  }, async (params, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post('/sprints', params))
  );

  server.tool('update-sprint', 'Update a sprint', {
    sprintId: z.string().describe('Sprint ID'),
    name: z.string().optional().describe('Sprint name'),
    goal: z.string().optional().describe('Sprint goal'),
    startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    endDate: z.string().optional().describe('End date (YYYY-MM-DD)'),
  }, async ({ sprintId, ...data }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).put(`/sprints/${sprintId}`, data))
  );

  server.tool('add-task-to-sprint', 'Add a task to a sprint', {
    sprintId: z.string().describe('Sprint ID'),
    taskId: z.string().describe('Task ID to add'),
    storyPoints: z.number().optional().describe('Story points'),
  }, async ({ sprintId, ...data }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post(`/sprints/${sprintId}/tasks`, data))
  );

  server.tool('remove-task-from-sprint', 'Remove a task from a sprint', {
    sprintId: z.string().describe('Sprint ID'),
    taskId: z.string().describe('Task ID to remove'),
  }, async ({ sprintId, taskId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).delete(`/sprints/${sprintId}/tasks/${taskId}`))
  );

  server.tool('start-sprint', 'Start a sprint', {
    sprintId: z.string().describe('Sprint ID'),
  }, async ({ sprintId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post(`/sprints/${sprintId}/start`))
  );

  server.tool('complete-sprint', 'Complete a sprint', {
    sprintId: z.string().describe('Sprint ID'),
  }, async ({ sprintId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post(`/sprints/${sprintId}/complete`))
  );

  server.tool('get-sprint-board', 'Get kanban board view for a sprint', {
    sprintId: z.string().describe('Sprint ID'),
  }, async ({ sprintId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get(`/sprints/${sprintId}/board`))
  );

  server.tool('get-sprint-burndown', 'Get sprint burndown chart data', {
    sprintId: z.string().describe('Sprint ID'),
  }, async ({ sprintId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get(`/sprints/${sprintId}/burndown`))
  );

  server.tool('get-velocity', 'Get velocity history for a project', {
    projectId: z.string().describe('Project ID'),
  }, async ({ projectId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get(`/sprints/velocity/${projectId}`))
  );
}
