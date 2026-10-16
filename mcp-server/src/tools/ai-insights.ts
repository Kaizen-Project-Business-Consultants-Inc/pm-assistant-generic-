import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getApiClientFromExtra, jsonResult } from '../api-client.js';

export function registerAIInsightTools(server: McpServer) {
  server.tool('get-project-health', 'Get AI health score for a project', {
    projectId: z.string().describe('Project ID'),
  }, async ({ projectId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get(`/predictions/project/${projectId}/health`))
  );

  server.tool('get-project-risks', 'Get AI risk assessment for a project', {
    projectId: z.string().describe('Project ID'),
  }, async ({ projectId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get(`/predictions/project/${projectId}/risks`))
  );

  server.tool('get-budget-forecast', 'Get AI budget forecast for a project', {
    projectId: z.string().describe('Project ID'),
  }, async ({ projectId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get(`/predictions/project/${projectId}/budget`))
  );

  server.tool('get-alerts', 'Get proactive alerts across all projects', {}, async (_args, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get('/alerts'))
  );

  server.tool('get-analytics-summary', 'Get portfolio-level analytics summary', {}, async (_args, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get('/analytics/summary'))
  );

  server.tool('get-portfolio-overview', 'Get full portfolio overview across all projects', {}, async (_args, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get('/portfolio'))
  );

  server.tool('natural-language-query', 'Ask a question about your projects in natural language', {
    query: z.string().describe('Your question (e.g. "Which projects are behind schedule?")'),
  }, async ({ query }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post('/nl-query', { query }))
  );

  server.tool('get-predictions-dashboard', 'Get portfolio predictions dashboard', {}, async (_args, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get('/predictions/dashboard'))
  );

  server.tool('run-monte-carlo', 'Run Monte Carlo simulation for schedule risk', {
    scheduleId: z.string().describe('Schedule ID'),
    iterations: z.number().int().min(100).max(100000).optional().describe('Number of iterations, 100–100,000 (default 10,000)'),
  }, async ({ scheduleId, ...params }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post(`/monte-carlo/${scheduleId}/simulate`, params))
  );

  server.tool('get-evm-forecast', 'Get Earned Value Management forecast', {
    projectId: z.string().describe('Project ID'),
  }, async ({ projectId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get(`/evm-forecast/${projectId}`))
  );

  server.tool('get-spend-to-date', 'Get cumulative project spending: actual cost, earned value, planned value, and budget variance', {
    projectId: z.string().describe('Project ID'),
  }, async ({ projectId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get(`/predictions/project/${projectId}/budget`))
  );

  server.tool('get-burn-rate', 'Get project burn rate (daily and monthly spending rate) with EVM cost performance metrics', {
    projectId: z.string().describe('Project ID'),
  }, async ({ projectId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get(`/evm-forecast/${projectId}`))
  );

  server.tool('suggest-risk-mitigations', 'Suggest risk mitigation strategies based on historical lessons learned and AI analysis', {
    riskDescription: z.string().describe('Description of the risk to mitigate'),
    projectType: z.string().describe('Type of project (e.g. "construction", "software", "infrastructure")'),
  }, async ({ riskDescription, projectType }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post('/lessons-learned/mitigations', { riskDescription, projectType }))
  );

  server.tool('get-meeting-summary', 'Analyze a meeting transcript to extract summary, action items, decisions, and task suggestions', {
    transcript: z.string().describe('Full meeting transcript text'),
    projectId: z.string().describe('Project ID to associate the analysis with'),
    scheduleId: z.string().describe("The project's schedule ID (for suggested tasks)"),
  }, async ({ transcript, projectId, scheduleId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post('/meeting-intelligence/analyze', { transcript, projectId, scheduleId }))
  );

  server.tool('get-daily-briefing', 'Get your daily briefing: overdue tasks, pending decisions, risk escalations, project health, budget alerts, and upcoming milestones', {}, async (_args, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get('/briefing/daily'))
  );

  server.tool('get-standup-summary', 'Get AI-generated daily standup summary for a project: completions, status changes, new tasks, new risks, and blockers from the previous day', {
    projectId: z.string().describe('Project ID'),
    refresh: z.boolean().optional().describe('Force regenerate cached summary'),
  }, async ({ projectId, refresh }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get(`/standup/project/${projectId}${refresh ? '?refresh=true' : ''}`))
  );

  server.tool('ai-estimate-task', 'Estimate task duration using historical data and AI reasoning. Returns estimated days, confidence score, and explanation.', {
    taskName: z.string().describe('Name of the task to estimate'),
    taskDescription: z.string().optional().describe('Optional description for better estimation accuracy'),
    projectId: z.string().describe('Project ID (used to gather historical task data)'),
    scheduleId: z.string().optional().describe('Schedule ID for additional context'),
  }, async ({ taskName, taskDescription, projectId, scheduleId }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post('/ai/estimate-task', { taskName, taskDescription, projectId, scheduleId }))
  );
}
