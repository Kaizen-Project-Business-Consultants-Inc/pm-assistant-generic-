import { z } from 'zod';

// ---------------------------------------------------------------------------
// Meeting Action Item
// ---------------------------------------------------------------------------

export const MeetingActionItemSchema = z.object({
  description: z.string(),
  assignee: z.string().describe('Name of the person assigned'),
  dueDate: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
});

export type MeetingActionItem = z.infer<typeof MeetingActionItemSchema>;

// ---------------------------------------------------------------------------
// Meeting Decision
// ---------------------------------------------------------------------------

export const MeetingDecisionSchema = z.object({
  decision: z.string(),
  rationale: z.string().optional(),
  madeBy: z.string().optional(),
});

export type MeetingDecision = z.infer<typeof MeetingDecisionSchema>;

// ---------------------------------------------------------------------------
// Meeting Risk
// ---------------------------------------------------------------------------

export const MeetingRiskSchema = z.object({
  description: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  mitigation: z.string().optional(),
});

export type MeetingRisk = z.infer<typeof MeetingRiskSchema>;

// ---------------------------------------------------------------------------
// Meeting Task Update
// ---------------------------------------------------------------------------

export const MeetingTaskUpdateSchema = z.object({
  type: z.enum(['create', 'update_status', 'reschedule']),
  taskName: z.string(),
  existingTaskId: z.string().optional(),
  newStatus: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
  newStartDate: z.string().optional(),
  newEndDate: z.string().optional(),
  assignee: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  description: z.string().optional(),
});

export type MeetingTaskUpdate = z.infer<typeof MeetingTaskUpdateSchema>;

// ---------------------------------------------------------------------------
// AI Response Schema (what the LLM returns)
// ---------------------------------------------------------------------------

export const MeetingAIResponseSchema = z.object({
  summary: z.string(),
  actionItems: z.array(MeetingActionItemSchema),
  decisions: z.array(MeetingDecisionSchema),
  risks: z.array(MeetingRiskSchema),
  taskUpdates: z.array(MeetingTaskUpdateSchema),
});

export type MeetingAIResponse = z.infer<typeof MeetingAIResponseSchema>;

// ---------------------------------------------------------------------------
// Full Meeting Analysis (stored record)
// ---------------------------------------------------------------------------

export const MeetingAnalysisSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  scheduleId: z.string(),
  transcript: z.string(),
  summary: z.string(),
  actionItems: z.array(MeetingActionItemSchema),
  decisions: z.array(MeetingDecisionSchema),
  risks: z.array(MeetingRiskSchema),
  taskUpdates: z.array(MeetingTaskUpdateSchema),
  appliedItems: z.array(z.number()),
  createdAt: z.string(),
});

export type MeetingAnalysis = z.infer<typeof MeetingAnalysisSchema>;

// ---------------------------------------------------------------------------
// Request Schemas
// ---------------------------------------------------------------------------

export const AnalyzeRequestSchema = z.object({
  transcript: z.string().min(10, 'Transcript must be at least 10 characters'),
  projectId: z.string(),
  scheduleId: z.string(),
  meetingId: z.string().optional(),
});

export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

export const ApplyRequestSchema = z.object({
  selectedItems: z.array(z.number()),
});

export type ApplyRequest = z.infer<typeof ApplyRequestSchema>;
