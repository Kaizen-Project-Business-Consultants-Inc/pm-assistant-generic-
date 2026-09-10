import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const DOCUMENT_TYPES = [
  'requirements', 'design', 'meeting_minutes', 'risk_log', 'issue_log',
  'financial', 'governance', 'decision_log', 'contract', 'proposal', 'misc',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const PROJECT_PHASES = [
  'initiation', 'planning', 'execution', 'monitoring', 'closure', 'unknown',
] as const;
export type ProjectPhase = (typeof PROJECT_PHASES)[number];

export const PROCESSING_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const;
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

export const ENTITY_LINK_TYPES = ['task', 'risk', 'issue', 'milestone', 'decision'] as const;
export type EntityLinkType = (typeof ENTITY_LINK_TYPES)[number];

// ---------------------------------------------------------------------------
// AI Response Schema (combined classifier + insight engine output)
// ---------------------------------------------------------------------------

export const DocumentAIResponseSchema = z.object({
  document_type: z.enum(DOCUMENT_TYPES),
  project_phase: z.enum(PROJECT_PHASES),
  tags: z.array(z.string()).max(20),
  summary: z.string().max(2000),
  key_points: z.array(z.string()).max(20),
  decisions: z.array(z.object({
    text: z.string(),
    inferred: z.boolean().optional(),
  })).max(30),
  risks: z.array(z.object({
    text: z.string(),
    severity: z.enum(['low', 'medium', 'high']).optional(),
    inferred: z.boolean().optional(),
  })).max(30),
  issues: z.array(z.object({
    text: z.string(),
    inferred: z.boolean().optional(),
  })).max(30),
  actions: z.array(z.object({
    text: z.string(),
    assignee: z.string().optional(),
    due_date: z.string().optional(),
    inferred: z.boolean().optional(),
  })).max(30),
  dates_mentioned: z.array(z.string()).max(30),
  related_entities: z.object({
    tasks: z.array(z.object({ id: z.string(), name: z.string(), reason: z.string() })).optional(),
    risks: z.array(z.object({ id: z.string(), name: z.string(), reason: z.string() })).optional(),
    milestones: z.array(z.object({ id: z.string(), name: z.string(), reason: z.string() })).optional(),
  }),
  confidence: z.number().min(0).max(1),
});

export type DocumentAIResponse = z.infer<typeof DocumentAIResponseSchema>;

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface ProjectDocument {
  id: string;
  projectId: string;
  filename: string;
  originalFilename: string;
  contentType: string;
  fileSize: number;
  extractedText: string | null;
  documentType: DocumentType;
  projectPhase: ProjectPhase;
  tags: string[];
  aiSummary: string | null;
  aiInsights: DocumentAIResponse | null;
  confidence: number;
  processingStatus: ProcessingStatus;
  errorMessage: string | null;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentEntityLink {
  id: string;
  documentId: string;
  entityType: EntityLinkType;
  entityId: string;
  linkReason: string | null;
  createdAt: string;
}
