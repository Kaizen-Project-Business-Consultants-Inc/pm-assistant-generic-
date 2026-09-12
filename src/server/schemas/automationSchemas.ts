import { z } from 'zod';

const conditionRuleSchema: z.ZodType<any> = z.object({
  field: z.string().min(1),
  operator: z.enum([
    'equals', 'not_equals', 'greater_than', 'less_than', 'greater_equal', 'less_equal',
    'contains', 'not_contains', 'in', 'not_in', 'before', 'after', 'is_empty', 'is_not_empty',
  ]),
  value: z.any().optional(),
});

const conditionGroupSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    logic: z.enum(['and', 'or']),
    conditions: z.array(z.union([conditionRuleSchema, conditionGroupSchema])),
  }),
);

const automationActionSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    'create_task', 'notify', 'send_email', 'add_risk', 'change_status',
    'update_field', 'add_comment', 'escalate', 'call_webhook', 'log_audit', 'auto_assign', 'ai_generate', 'apply_lesson', 'extract_lesson',
  ]),
  params: z.record(z.string(), z.any()),
  runOrder: z.number().int().min(0),
  haltOnFailure: z.boolean().optional(),
});

const automationDefinitionSchema = z.object({
  conditions: conditionGroupSchema.optional(),
  actions: z.array(automationActionSchema).min(0),
});

const scheduleConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('interval'), intervalMinutes: z.number().int().min(1).max(1440) }),
  z.object({ type: z.literal('daily'), time: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:mm') }),
  z.object({ type: z.literal('weekly'), dayOfWeek: z.number().int().min(0).max(6), time: z.string().regex(/^\d{2}:\d{2}$/) }),
  z.object({ type: z.literal('monthly'), dayOfMonth: z.number().int().min(1).max(31), time: z.string().regex(/^\d{2}:\d{2}$/) }),
  z.object({ type: z.literal('cron'), expression: z.string().min(9).max(100) }),
]);

export const createAutomationSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  triggerEventType: z.string().min(1),
  triggerEntityType: z.string().optional(),
  scope: z.enum(['project', 'portfolio']).optional().default('project'),
  definition: automationDefinitionSchema,
  scheduleConfig: scheduleConfigSchema.nullable().optional(),
  timezone: z.string().max(50).optional(),
  maxRunsPerDay: z.number().int().min(1).max(1000).optional(),
  cooldownSeconds: z.number().int().min(0).max(86400).optional(),
});

export const updateAutomationSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  triggerEventType: z.string().min(1).optional(),
  triggerEntityType: z.string().optional(),
  scope: z.enum(['project', 'portfolio']).optional(),
  definition: automationDefinitionSchema.optional(),
  scheduleConfig: scheduleConfigSchema.nullable().optional(),
  timezone: z.string().max(50).optional(),
  maxRunsPerDay: z.number().int().min(1).max(1000).optional(),
  cooldownSeconds: z.number().int().min(0).max(86400).optional(),
});

export const testAutomationSchema = z.object({
  eventPayload: z.record(z.string(), z.any()).optional(),
  entityId: z.string().optional(),
});
