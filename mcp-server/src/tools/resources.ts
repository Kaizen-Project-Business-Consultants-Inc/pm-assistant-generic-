import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getApiClientFromExtra, jsonResult } from '../api-client.js';

const skillSchema = z.union([
  z.string(),
  z.object({ name: z.string(), level: z.number().min(1).max(5) }),
]);

export function registerResourceTools(server: McpServer) {
  server.tool('list-resources', 'List all resources (optionally filter by group)', {
    group: z.string().optional().describe('Filter by resource group'),
  }, async ({ group }, extra) => {
    const params = group ? `?group=${encodeURIComponent(group)}` : '';
    return jsonResult(await getApiClientFromExtra(extra).get(`/resources${params}`));
  });

  server.tool('create-resource', 'Create a new resource', {
    name: z.string().describe('Resource name'),
    email: z.string().optional().describe('Email address'),
    role: z.string().optional().describe('Role/title'),
    skills: z.array(skillSchema).optional().describe('Skills with optional proficiency (1-5). Plain strings default to level 3'),
    maxHoursPerWeek: z.number().optional().describe('Max hours per week'),
    costRate: z.number().optional().describe('Hourly cost rate'),
    resourceGroup: z.string().optional().describe('Resource group/team (e.g. Engineering, Design, QA)'),
    userId: z.string().optional().describe('Link to a user ID for timesheet integration'),
    calendarTemplateId: z.string().optional().describe('Calendar template ID for working schedule'),
  }, async (params, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post('/resources', params))
  );

  server.tool('update-resource', 'Update a resource', {
    resourceId: z.string().describe('Resource ID'),
    name: z.string().optional().describe('Resource name'),
    email: z.string().optional().describe('Email address'),
    role: z.string().optional().describe('Role/title'),
    skills: z.array(skillSchema).optional().describe('Skills with optional proficiency (1-5)'),
    maxHoursPerWeek: z.number().optional().describe('Max hours per week'),
    costRate: z.number().optional().describe('Hourly cost rate'),
    resourceGroup: z.string().optional().describe('Resource group/team'),
    userId: z.string().optional().describe('Link to a user ID'),
    calendarTemplateId: z.string().optional().describe('Calendar template ID'),
  }, async ({ resourceId, ...data }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).put(`/resources/${resourceId}`, data))
  );

  server.tool('delete-resource', 'Delete a resource', {
    resourceId: z.string().describe('Resource ID'),
  }, async ({ resourceId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).delete(`/resources/${resourceId}`))
  );

  server.tool('get-resource-workload', 'Get resource workload (project-specific or global cross-project)', {
    projectId: z.string().optional().describe('Project ID. Omit for global cross-project workload'),
  }, async ({ projectId }, extra) => {
    const url = projectId ? `/resources/workload/${projectId}` : '/resources/workload';
    return jsonResult(await getApiClientFromExtra(extra).get(url));
  });

  server.tool('get-resource-histogram', 'Get resource histogram for a schedule', {
    scheduleId: z.string().describe('Schedule ID'),
  }, async ({ scheduleId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get(`/resource-leveling/${scheduleId}/histogram`))
  );

  server.tool('set-resource-availability', 'Set availability block for a resource (vacation, holiday, reduced hours)', {
    resourceId: z.string().describe('Resource ID'),
    dateFrom: z.string().describe('Start date (YYYY-MM-DD)'),
    dateTo: z.string().describe('End date (YYYY-MM-DD)'),
    type: z.enum(['vacation', 'holiday', 'unavailable', 'reduced']).describe('Type of availability block'),
    hoursAvailable: z.number().optional().describe('Hours available per day (for reduced type)'),
    note: z.string().optional().describe('Optional note'),
  }, async ({ resourceId, ...data }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post(`/resources/${resourceId}/availability`, data))
  );

  server.tool('get-resource-availability', 'Get availability blocks for a resource', {
    resourceId: z.string().describe('Resource ID'),
    from: z.string().optional().describe('Start date filter (YYYY-MM-DD)'),
    to: z.string().optional().describe('End date filter (YYYY-MM-DD)'),
  }, async ({ resourceId, from, to }, extra) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return jsonResult(await getApiClientFromExtra(extra).get(`/resources/${resourceId}/availability${qs}`));
  });
}
