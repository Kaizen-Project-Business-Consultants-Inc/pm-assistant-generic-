import { FastifyInstance } from 'fastify';

// Core
import { authRoutes } from './routes/core/auth';
import { projectRoutes } from './routes/core/projects';
import { userRoutes } from './routes/core/users';
import { projectMemberRoutes } from './routes/core/projectMembers';
import { notificationRoutes } from './routes/core/notifications';
import { searchRoutes } from './routes/core/search';
import { orgRoutes } from './routes/core/org';
import { websocketRoutes } from './routes/core/websocket';
import { exportRoutes } from './routes/core/exports';
import { bulkRoutes } from './routes/core/bulk';
import { feedbackRoutes } from './routes/core/feedback';
import { inviteRoutes } from './routes/core/invites';
import { seatRoutes } from './routes/core/seats';
import { pricingRoutes } from './routes/core/pricing';
import { projectGroupRoutes } from './routes/core/projectGroups';

// Scheduling
import { scheduleRoutes } from './routes/scheduling/schedules';
import { burndownRoutes } from './routes/scheduling/burndown';
import { networkDiagramRoutes } from './routes/scheduling/networkDiagram';
import { monteCarloRoutes } from './routes/scheduling/monteCarlo';
import { evmForecastRoutes } from './routes/scheduling/evmForecast';
import { autoRescheduleRoutes } from './routes/scheduling/autoReschedule';
import { resourceLevelingRoutes } from './routes/scheduling/resourceLeveling';
import { taskPrioritizationRoutes } from './routes/scheduling/taskPrioritization';
import { importRoutes } from './routes/scheduling/import';
import { calendarRoutes } from './routes/scheduling/calendars';

// AI
import { aiChatRoutes } from './routes/ai/aiChat';
import { aiReportRoutes } from './routes/ai/aiReports';
import { aiSchedulingRoutes } from './routes/ai/aiScheduling';
import { nlQueryRoutes } from './routes/ai/nlQuery';
import { predictionRoutes } from './routes/ai/predictions';
import { learningRoutes } from './routes/ai/learning';
import { intelligenceRoutes } from './routes/ai/intelligence';
import { ragRoutes } from './routes/ai/rag';
import { aiBudgetRoutes } from './routes/ai/aiBudget';
import { narrativeRoutes } from './routes/ai/narratives';
import { accessibilityRoutes } from './routes/ai/accessibility';
import { aiTaskEstimationRoutes } from './routes/ai/aiTaskEstimation';

// Resources
import { resourceRoutes } from './routes/resources/resources';
import { resourceOptimizerRoutes } from './routes/resources/resourceOptimizer';
import { timeEntryRoutes } from './routes/resources/timeEntries';
import { expenseRoutes } from './routes/resources/expenses';
import { customFieldRoutes } from './routes/resources/customFields';
import { availabilityRoutes } from './routes/resources/availability';
import { calendarTemplateRoutes } from './routes/resources/calendarTemplates';
import { resourceRequestRoutes } from './routes/resources/resourceRequests';

// Collaboration
import { approvalWorkflowRoutes } from './routes/collaboration/approvalWorkflows';
import { workflowRoutes } from './routes/collaboration/workflows';
import { portalRoutes } from './routes/collaboration/portal';
import { sprintRoutes } from './routes/collaboration/sprints';
import { templateRoutes } from './routes/collaboration/templates';
import { fileAttachmentRoutes } from './routes/collaboration/fileAttachments';
import { meetingIntelligenceRoutes } from './routes/collaboration/meetingIntelligence';
import { meetingRoutes } from './routes/collaboration/meetings';
import { meetingActionItemRoutes } from './routes/collaboration/meetingActionItems';
import { lessonsLearnedRoutes } from './routes/collaboration/lessonsLearned';
import { intakeFormRoutes } from './routes/collaboration/intakeForms';
import { riskRoutes } from './routes/collaboration/risks';
import { goalRoutes } from './routes/goals';

// Reporting
import { reportBuilderRoutes } from './routes/reporting/reportBuilder';
import { analyticsSummaryRoutes } from './routes/reporting/analyticsSummary';
import { portfolioRoutes } from './routes/reporting/portfolio';
import { reportScheduleRoutes } from './routes/reporting/reportSchedules';
import { dashboardDataRoutes } from './routes/reporting/dashboardData';
import { briefingRoutes } from './routes/reporting/briefing';
import { statusReportRoutes } from './routes/reporting/statusReports';
import { strategicRiskScanRoutes } from './routes/reporting/strategicRiskScan';
import { raidReportRoutes } from './routes/reporting/raidReports';
import { standupRoutes } from './routes/reporting/standup';
import { instantReportRoutes } from './routes/reporting/instantReports';

// Agent
import { agentRoutes } from './routes/agent/agent';
import { agentActivityLogRoutes } from './routes/agent/agentActivityLog';
import { alertRoutes } from './routes/agent/alerts';
import { policyRoutes } from './routes/agent/policies';
import { proposalRoutes } from './routes/agent/proposals';
import { agentHealthRoutes } from './routes/agent/agentHealth';
import { killSwitchRoutes } from './routes/agent/killSwitch';
import { autonomyRoutes } from './routes/agent/autonomy';
import { agentMemoryRoutes } from './routes/agent/memory';

// My Work
import { myWorkRoutes } from './routes/myWork';

// Integrations
import { integrationRoutes } from './routes/integrations/integrations';
import { webhookRoutes } from './routes/integrations/webhooks';
import { apiKeyRoutes } from './routes/integrations/apiKeys';
import { stripeRoutes } from './routes/integrations/stripe';
import { slackRoutes } from './routes/integrations/slack';
import { mcpProxyRoutes } from './routes/integrations/mcpProxy';

// Admin
import { adminRoutes } from './routes/admin/admin';
import { waitlistRoutes } from './routes/admin/waitlist';
import { auditTrailRoutes } from './routes/admin/auditTrail';
import { metricsRoutes } from './routes/admin/metrics';
import { logsRoutes } from './routes/admin/logs';
import { deadLetterRoutes } from './routes/admin/deadLetter';
import { tenantAdminRoutes } from './routes/admin/tenants';
import { operationsRoutes } from './routes/admin/operations';
import { revenueRoutes } from './routes/admin/revenue';
import { mcpAnalyticsRoutes } from './routes/admin/mcpAnalytics';
import { knowledgeBaseRoutes } from './routes/admin/knowledgeBase';

export async function registerRoutes(fastify: FastifyInstance) {
  // Health check — unauthenticated, for uptime monitors
  fastify.get('/api/v1/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Core
  await fastify.register(authRoutes, { prefix: '/api/v1/auth' });
  await fastify.register(projectRoutes, { prefix: '/api/v1/projects' });
  await fastify.register(userRoutes, { prefix: '/api/v1/users' });
  await fastify.register(projectMemberRoutes, { prefix: '/api/v1/projects' });
  await fastify.register(notificationRoutes, { prefix: '/api/v1/notifications' });
  await fastify.register(searchRoutes, { prefix: '/api/v1/search' });
  await fastify.register(websocketRoutes, { prefix: '/api/v1/ws' });
  await fastify.register(exportRoutes, { prefix: '/api/v1/exports' });
  await fastify.register(bulkRoutes, { prefix: '/api/v1/bulk' });
  await fastify.register(orgRoutes, { prefix: '/api/v1/org' });
  await fastify.register(feedbackRoutes, { prefix: '/api/v1/feedback' });
  await fastify.register(inviteRoutes, { prefix: '/api/v1/invites' });
  await fastify.register(seatRoutes, { prefix: '/api/v1/seats' });
  await fastify.register(pricingRoutes, { prefix: '/api/v1/pricing' });
  await fastify.register(projectGroupRoutes, { prefix: '/api/v1/project-groups' });

  // Scheduling
  await fastify.register(scheduleRoutes, { prefix: '/api/v1/schedules' });
  await fastify.register(burndownRoutes, { prefix: '/api/v1/burndown' });
  await fastify.register(networkDiagramRoutes, { prefix: '/api/v1/network-diagram' });
  await fastify.register(monteCarloRoutes, { prefix: '/api/v1/monte-carlo' });
  await fastify.register(evmForecastRoutes, { prefix: '/api/v1/evm-forecast' });
  await fastify.register(autoRescheduleRoutes, { prefix: '/api/v1/auto-reschedule' });
  await fastify.register(resourceLevelingRoutes, { prefix: '/api/v1/resource-leveling' });
  await fastify.register(taskPrioritizationRoutes, { prefix: '/api/v1/task-prioritization' });
  await fastify.register(importRoutes, { prefix: '/api/v1/schedules' });
  await fastify.register(calendarRoutes);

  // AI
  await fastify.register(aiChatRoutes, { prefix: '/api/v1/ai-chat' });
  await fastify.register(aiReportRoutes, { prefix: '/api/v1/ai-reports' });
  await fastify.register(aiSchedulingRoutes, { prefix: '/api/v1/ai-scheduling' });
  await fastify.register(nlQueryRoutes, { prefix: '/api/v1/nl-query' });
  await fastify.register(predictionRoutes, { prefix: '/api/v1/predictions' });
  await fastify.register(learningRoutes, { prefix: '/api/v1/learning' });
  await fastify.register(intelligenceRoutes, { prefix: '/api/v1/intelligence' });
  await fastify.register(ragRoutes, { prefix: '/api/v1/rag' });
  await fastify.register(aiBudgetRoutes, { prefix: '/api/v1/ai/budget' });
  await fastify.register(narrativeRoutes, { prefix: '/api/v1/narratives' });
  await fastify.register(accessibilityRoutes, { prefix: '/api/v1/accessibility' });
  await fastify.register(aiTaskEstimationRoutes, { prefix: '/api/v1/ai/estimate-task' });

  // Resources
  await fastify.register(resourceRoutes, { prefix: '/api/v1/resources' });
  await fastify.register(availabilityRoutes, { prefix: '/api/v1/resources' });
  await fastify.register(resourceOptimizerRoutes, { prefix: '/api/v1/resource-optimizer' });
  await fastify.register(timeEntryRoutes, { prefix: '/api/v1/time-entries' });
  await fastify.register(expenseRoutes, { prefix: '/api/v1/expenses' });
  await fastify.register(customFieldRoutes, { prefix: '/api/v1/custom-fields' });
  await fastify.register(calendarTemplateRoutes, { prefix: '/api/v1/resources/calendar-templates' });
  await fastify.register(resourceRequestRoutes, { prefix: '/api/v1/resource-requests' });

  // Collaboration
  await fastify.register(approvalWorkflowRoutes, { prefix: '/api/v1/approvals' });
  await fastify.register(workflowRoutes, { prefix: '/api/v1/workflows' });
  await fastify.register(portalRoutes, { prefix: '/api/v1/portal' });
  await fastify.register(sprintRoutes, { prefix: '/api/v1/sprints' });
  await fastify.register(templateRoutes, { prefix: '/api/v1/templates' });
  await fastify.register(fileAttachmentRoutes, { prefix: '/api/v1/attachments' });
  await fastify.register(meetingIntelligenceRoutes, { prefix: '/api/v1/meeting-intelligence' });
  await fastify.register(meetingRoutes, { prefix: '/api/v1/meetings' });
  await fastify.register(meetingActionItemRoutes, { prefix: '/api/v1/meeting-action-items' });
  await fastify.register(lessonsLearnedRoutes, { prefix: '/api/v1/lessons-learned' });
  await fastify.register(intakeFormRoutes, { prefix: '/api/v1/intake' });
  await fastify.register(riskRoutes, { prefix: '/api/v1/projects' });
  await fastify.register(goalRoutes, { prefix: '/api/v1/goals' });

  // Reporting
  await fastify.register(reportBuilderRoutes, { prefix: '/api/v1/report-builder' });
  await fastify.register(analyticsSummaryRoutes, { prefix: '/api/v1/analytics' });
  await fastify.register(portfolioRoutes, { prefix: '/api/v1/portfolio' });
  await fastify.register(reportScheduleRoutes, { prefix: '/api/v1/report-schedules' });
  await fastify.register(dashboardDataRoutes, { prefix: '/api/v1/dashboard' });
  await fastify.register(briefingRoutes, { prefix: '/api/v1/briefing' });
  await fastify.register(statusReportRoutes, { prefix: '/api/v1/status-reports' });
  await fastify.register(strategicRiskScanRoutes, { prefix: '/api/v1/strategic-risk-scan' });
  await fastify.register(raidReportRoutes, { prefix: '/api/v1/raid-reports' });
  await fastify.register(standupRoutes, { prefix: '/api/v1/standup' });
  await fastify.register(instantReportRoutes, { prefix: '/api/v1/instant-reports' });

  // Agent
  await fastify.register(agentRoutes, { prefix: '/api/v1/agent' });
  await fastify.register(agentActivityLogRoutes, { prefix: '/api/v1/agent-log' });
  await fastify.register(alertRoutes, { prefix: '/api/v1/alerts' });
  await fastify.register(policyRoutes, { prefix: '/api/v1/policies' });
  await fastify.register(proposalRoutes, { prefix: '/api/v1/agent/proposals' });
  await fastify.register(agentHealthRoutes, { prefix: '/api/v1/agent' });
  await fastify.register(killSwitchRoutes, { prefix: '/api/v1/agent' });
  await fastify.register(autonomyRoutes, { prefix: '/api/v1/agent/autonomy' });
  await fastify.register(agentMemoryRoutes, { prefix: '/api/v1/agent/memory' });

  // My Work
  await fastify.register(myWorkRoutes, { prefix: '/api/v1/my-work' });

  // Integrations
  await fastify.register(integrationRoutes, { prefix: '/api/v1/integrations' });
  await fastify.register(webhookRoutes, { prefix: '/api/v1/webhooks' });
  await fastify.register(apiKeyRoutes, { prefix: '/api/v1/api-keys' });
  await fastify.register(stripeRoutes, { prefix: '/api/v1/stripe' });
  await fastify.register(slackRoutes, { prefix: '/api/v1/slack' });
  await fastify.register(mcpProxyRoutes, { prefix: '/mcp' });

  // Admin
  await fastify.register(adminRoutes, { prefix: '/api/v1/admin' });
  await fastify.register(waitlistRoutes, { prefix: '/api/v1/waitlist' });
  await fastify.register(auditTrailRoutes, { prefix: '/api/v1/audit' });
  await fastify.register(metricsRoutes, { prefix: '/api/v1/metrics' });
  await fastify.register(logsRoutes, { prefix: '/api/v1/admin/logs' });
  await fastify.register(deadLetterRoutes, { prefix: '/api/v1/admin/dlq' });
  await fastify.register(tenantAdminRoutes, { prefix: '/api/v1/admin/tenants' });
  await fastify.register(operationsRoutes, { prefix: '/api/v1/admin/operations' });
  await fastify.register(revenueRoutes, { prefix: '/api/v1/admin/revenue' });
  await fastify.register(mcpAnalyticsRoutes, { prefix: '/api/v1/admin/mcp-analytics' });
  await fastify.register(knowledgeBaseRoutes, { prefix: '/api/v1/admin/knowledge-base' });

  // Telemetry — lightweight client-side error reporting
  fastify.post('/api/v1/telemetry/404', async (request, reply) => {
    const { path, referrer } = (request.body as { path?: string; referrer?: string | null }) || {};
    if (path) {
      fastify.log.warn({ event: 'client-404', path, referrer: referrer || undefined }, 'Client hit 404 page');
    }
    return reply.status(204).send();
  });
}
