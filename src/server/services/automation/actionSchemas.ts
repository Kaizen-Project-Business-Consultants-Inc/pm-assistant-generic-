import { z } from 'zod';

export const actionParamSchemas: Record<string, z.ZodType<any>> = {
  create_task: z.object({
    title: z.string().min(1),
    scheduleId: z.string(),
    assignedTo: z.string().optional(),
    priority: z.string().optional(),
    status: z.string().optional(),
    description: z.string().optional(),
  }),
  notify: z.object({
    recipients: z.union([z.string(), z.array(z.string())]),
    messageTemplate: z.string().min(1),
    title: z.string().optional(),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    linkType: z.string().optional(),
    linkId: z.string().optional(),
  }),
  send_email: z.object({
    to: z.union([z.string(), z.array(z.string())]),
    subject: z.string().min(1),
    body: z.string().min(1),
  }),
  add_risk: z.object({
    title: z.string().min(1),
    type: z.enum(['risk', 'issue', 'action', 'decision', 'assumption', 'dependency']).optional(),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    description: z.string().optional(),
    category: z.string().optional(),
  }),
  change_status: z.object({
    newStatus: z.string().min(1),
  }),
  update_field: z.object({
    field: z.string().min(1),
    value: z.any(),
  }),
  add_comment: z.object({
    messageTemplate: z.string().min(1),
  }),
  escalate: z.object({
    recipients: z.union([z.string(), z.array(z.string())]),
    messageTemplate: z.string().min(1),
    title: z.string().optional(),
  }),
  call_webhook: z.object({
    url: z.string().url(),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH']).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.any().optional(),
  }),
  log_audit: z.object({
    messageTemplate: z.string().min(1),
    action: z.string().optional(),
  }),
};
