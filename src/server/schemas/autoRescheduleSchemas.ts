import { z } from 'zod';

// Delayed Task — a task detected as behind schedule
export const DelayedTaskSchema = z.object({
  taskId: z.string(),
  taskName: z.string(),
  expectedEndDate: z.string(),
  currentProgress: z.number().min(0).max(100),
  estimatedEndDate: z.string(),
  delayDays: z.number(),
  isOnCriticalPath: z.boolean(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
});

export type DelayedTask = z.infer<typeof DelayedTaskSchema>;

// A single proposed date change for a task
export const ProposedChangeSchema = z.object({
  taskId: z.string(),
  taskName: z.string(),
  currentStartDate: z.string(),
  currentEndDate: z.string(),
  proposedStartDate: z.string(),
  proposedEndDate: z.string(),
  reason: z.string(),
});

export type ProposedChange = z.infer<typeof ProposedChangeSchema>;

// Full reschedule proposal stored in memory
export const RescheduleProposalSchema = z.object({
  id: z.string(),
  scheduleId: z.string(),
  status: z.enum(['pending', 'accepted', 'rejected', 'modified']),
  delayedTasks: z.array(DelayedTaskSchema),
  proposedChanges: z.array(ProposedChangeSchema),
  rationale: z.string(),
  estimatedImpact: z.object({
    originalEndDate: z.string(),
    proposedEndDate: z.string(),
    daysChange: z.number(),
    criticalPathImpact: z.string(),
  }),
  createdAt: z.string(),
  feedback: z.string().optional(),
});

export type RescheduleProposal = z.infer<typeof RescheduleProposalSchema>;

// AI response schema — what Claude returns when generating a proposal
export const RescheduleAIResponseSchema = z.object({
  proposedChanges: z.array(
    z.object({
      taskId: z.string(),
      taskName: z.string().optional(),
      proposedStartDate: z.string(),
      proposedEndDate: z.string(),
      reason: z.string(),
    }),
  ),
  rationale: z.string(),
  estimatedImpact: z.object({
    proposedEndDate: z.string(),
    daysChange: z.number(),
    criticalPathImpact: z.string(),
  }),
});

export type RescheduleAIResponse = z.infer<typeof RescheduleAIResponseSchema>;
