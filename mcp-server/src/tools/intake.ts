import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getApiClientFromExtra, jsonResult } from '../api-client.js';

export function registerIntakeTools(server: McpServer) {
  server.tool('list-intake-forms', 'List intake forms', {}, async (_args, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get('/intake/forms'))
  );

  server.tool('submit-intake-form', 'Submit an intake form', {
    formId: z.string().describe('Form ID'),
    data: z.record(z.unknown()).describe('Form field values as key-value pairs'),
  }, async ({ formId, data }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post(`/intake/forms/${formId}/submit`, { values: data }))
  );

  server.tool('list-intake-submissions', 'List intake form submissions', {}, async (_args, extra) =>
    jsonResult(await getApiClientFromExtra(extra).get('/intake/submissions'))
  );

  server.tool('review-submission', 'Review an intake form submission', {
    submissionId: z.string().describe('Submission ID'),
    status: z.enum(['approved', 'rejected', 'under_review']).describe('Review decision'),
    notes: z.string().optional().describe('Review notes'),
  }, async ({ submissionId, ...data }, extra) =>
    jsonResult(await getApiClientFromExtra(extra).post(`/intake/submissions/${submissionId}/review`, data))
  );
}
