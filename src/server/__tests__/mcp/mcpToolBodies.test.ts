import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
// the MCP server's own copy of zod (its tool shapes are made with it)
import { z as mcpZ } from '../../../../mcp-server/node_modules/zod';

/**
 * Guard (2026-10-16): the Claude connection's tools (mcp-server/src/tools) must send what the app's
 * routes accept. A sweep found 13 tools refused with 400 on every call, or quietly dropping a
 * field — e.g. apply-template sent `name` where the route wants `projectName`. Each tool here is
 * run with sample input; the body it would send is parsed by the route's own schema.
 */
const sent: Array<{ method: string; path: string; body: unknown }> = [];
vi.mock('../../../../mcp-server/src/api-client.js', () => ({
  getApiClientFromExtra: () => ({
    get: async (path: string) => { sent.push({ method: 'get', path, body: undefined }); return {}; },
    post: async (path: string, body?: unknown) => { sent.push({ method: 'post', path, body }); return {}; },
    put: async (path: string, body?: unknown) => { sent.push({ method: 'put', path, body }); return {}; },
    delete: async (path: string) => { sent.push({ method: 'delete', path, body: undefined }); return {}; },
  }),
  jsonResult: (x: unknown) => x,
}));

import { registerTemplateTools } from '../../../../mcp-server/src/tools/templates';
import { registerApprovalTools } from '../../../../mcp-server/src/tools/approvals';
import { registerAIInsightTools } from '../../../../mcp-server/src/tools/ai-insights';
import { registerCustomFieldTools } from '../../../../mcp-server/src/tools/custom-fields';
import { registerIntakeTools } from '../../../../mcp-server/src/tools/intake';
import { registerIntegrationTools } from '../../../../mcp-server/src/tools/integrations';
import { registerTaskTools } from '../../../../mcp-server/src/tools/tasks';
import { registerTimeTrackingTools } from '../../../../mcp-server/src/tools/time-tracking';

import { createFromTemplateSchema } from '../../schemas/templateSchemas';
import { createChangeRequestSchema, submitForApprovalSchema, actOnStepSchema } from '../../routes/collaboration/approvalWorkflows';
import { AnalyzeRequestSchema } from '../../schemas/meetingSchemas';
import { MonteCarloConfigSchema } from '../../schemas/monteCarloSchemas';
import { bulkValuesSchema } from '../../routes/resources/customFields';
import { reviewSubmissionSchema, submitFormSchema } from '../../routes/collaboration/intakeForms';
import { createIntegrationSchema, syncIntegrationSchema } from '../../routes/integrations/integrations';
import { bulkStatusSchema } from '../../routes/core/bulk';
import { createTimeEntrySchema } from '../../routes/resources/timeEntries';
import { createDefinitionSchema } from '../../routes/collaboration/workflows';

type Tool = { shape: Record<string, unknown>; handler: (args: any, extra: any) => Promise<unknown> };
const tools = new Map<string, Tool>();
const fakeServer = { tool: (name: string, _d: string, shape: Record<string, unknown>, handler: Tool['handler']) => { tools.set(name, { shape, handler }); } } as any;
for (const register of [registerTemplateTools, registerApprovalTools, registerAIInsightTools, registerCustomFieldTools, registerIntakeTools,
  registerIntegrationTools, registerTaskTools, registerTimeTrackingTools]) register(fakeServer);

const CASES: Array<{ tool: string; args: Record<string, unknown>; schema: z.ZodTypeAny }> = [
  { tool: 'apply-template', args: { templateId: 'tpl-it-webapp', projectName: 'New app', startDate: '2026-11-02', clientId: 'c1', methodology: 'hybrid', priority: 'high', budget: 50000 }, schema: createFromTemplateSchema },
  { tool: 'create-change-request', args: { projectId: 'p1', title: 'More scope', description: 'Two more reports', category: 'scope', priority: 'high', impactSummary: '+5 days' }, schema: createChangeRequestSchema },
  { tool: 'submit-for-approval', args: { changeRequestId: 'cr1', workflowId: 'wf1' }, schema: submitForApprovalSchema },
  { tool: 'act-on-approval', args: { changeRequestId: 'cr1', action: 'approve', comment: 'OK' }, schema: actOnStepSchema },
  { tool: 'get-meeting-summary', args: { transcript: 'We agreed to move the go-live.', projectId: 'p1', scheduleId: 's1' }, schema: AnalyzeRequestSchema },
  { tool: 'run-monte-carlo', args: { scheduleId: 's1', iterations: 5000 }, schema: MonteCarloConfigSchema },
  { tool: 'set-custom-field-values', args: { entityType: 'task', entityId: 't1', projectId: 'p1', values: [{ fieldId: 'f1', text: 'Blue' }] }, schema: bulkValuesSchema },
  { tool: 'submit-intake-form', args: { formId: 'form1', data: { title: 'New office' } }, schema: submitFormSchema },
  { tool: 'review-submission', args: { submissionId: 'sub1', status: 'approved', notes: 'Go' }, schema: reviewSubmissionSchema },
  { tool: 'create-integration', args: { provider: 'jira', config: { site: 'acme' }, projectId: 'p1' }, schema: createIntegrationSchema },
  { tool: 'sync-integration', args: { integrationId: 'i1', direction: 'pull' }, schema: syncIntegrationSchema },
  { tool: 'bulk-status-update', args: { scheduleId: 's1', taskIds: ['t1', 't2'], status: 'completed' }, schema: bulkStatusSchema },
  { tool: 'log-time', args: { taskId: 't1', scheduleId: 's1', projectId: 'p1', hours: 3, date: '2026-10-16', description: 'Site visit' }, schema: createTimeEntrySchema },
  { tool: 'create-workflow', args: { name: 'Notify on done', description: 'Tell the PM', projectId: 'p1', nodes: [{ nodeType: 'trigger', name: 'Task done', config: { triggerType: 'status_change', toStatus: 'completed' } }, { nodeType: 'action', name: 'Notify', config: { actionType: 'send_notification', title: 'Done', message: 'A task finished' } }], edges: [{ sourceIndex: 0, targetIndex: 1 }] }, schema: createDefinitionSchema },
];

describe('Claude connection tools send what the app accepts', () => {
  it.each(CASES)('$tool', async ({ tool, args, schema }) => {
    const t = tools.get(tool);
    expect(t, `${tool} is registered`).toBeTruthy();
    expect(() => mcpZ.object(t!.shape as never).parse(args), `${tool} accepts the sample input`).not.toThrow();
    sent.length = 0;
    await t!.handler(args, {});
    const call = sent.find(c => c.method === 'post' || c.method === 'put');
    expect(call, `${tool} sends a body`).toBeTruthy();
    // strict: a field the route doesn't know (a misspelt optional one) is a failure, not dropped quietly
    const parsed = (schema instanceof z.ZodObject ? schema.strict() : schema).safeParse(call!.body ?? {});
    expect(parsed.success ? 'ok' : JSON.stringify(parsed.error.issues), `${tool} → ${call!.path}`).toBe('ok');
  });
});

describe('the guard itself', () => {
  it("catches a renamed optional field (act-on-approval once sent 'comments'; the route reads 'comment')", () => {
    expect(actOnStepSchema.strict().safeParse({ action: 'approve', comments: 'OK' }).success).toBe(false);
    expect(actOnStepSchema.strict().safeParse({ action: 'approve', comment: 'OK' }).success).toBe(true);
  });

  it('a workflow step from the tool is one the engine runs (triggerType / actionType)', async () => {
    const wf = CASES.find(c => c.tool === 'create-workflow')!.args as any;
    expect(wf.nodes[0].config.triggerType).toBeTruthy();
    expect(wf.nodes[1].config.actionType).toBeTruthy();
  });
});
