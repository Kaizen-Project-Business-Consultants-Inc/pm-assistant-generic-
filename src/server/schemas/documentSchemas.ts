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

// Coerce items that may come as strings or objects with a text/description field
const coerceToTextObject = z.preprocess((val: unknown) => {
  if (typeof val === 'string') return { text: val };
  if (val && typeof val === 'object' && !('text' in (val as any))) {
    const o = val as Record<string, unknown>;
    // Model may use 'description', 'content', 'title', or 'name' instead of 'text'
    const text = o.description || o.content || o.title || o.name || o.decision || o.issue || o.risk || o.action || '';
    return { ...o, text: String(text) };
  }
  return val;
}, z.object({ text: z.string() }).passthrough());

// Coerce dates that may come as objects {date: "...", context: "..."}
const coerceDateString = z.preprocess((val: unknown) => {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object') {
    const o = val as Record<string, unknown>;
    return String(o.date || o.value || o.text || JSON.stringify(val));
  }
  return String(val);
}, z.string());

export const DocumentAIResponseSchema = z.object({
  document_type: z.preprocess((val) => {
    // Normalize common model variations to our enum values
    const s = String(val).toLowerCase().replace(/[- ]/g, '_');
    if (s.includes('requirement')) return 'requirements';
    if (s.includes('design') || s.includes('architecture')) return 'design';
    if (s.includes('meeting') || s.includes('minute')) return 'meeting_minutes';
    if (s.includes('risk')) return 'risk_log';
    if (s.includes('issue')) return 'issue_log';
    if (s.includes('financ') || s.includes('budget')) return 'financial';
    if (s.includes('governance')) return 'governance';
    if (s.includes('decision')) return 'decision_log';
    if (s.includes('contract')) return 'contract';
    if (s.includes('proposal')) return 'proposal';
    if (DOCUMENT_TYPES.includes(s as any)) return s;
    return 'misc';
  }, z.enum(DOCUMENT_TYPES)),
  project_phase: z.preprocess((val) => {
    const s = String(val).toLowerCase().replace(/[- ]/g, '_');
    if (PROJECT_PHASES.includes(s as any)) return s;
    return 'unknown';
  }, z.enum(PROJECT_PHASES)),
  tags: z.array(z.string()).max(20).default([]),
  summary: z.string().max(2000).default(''),
  key_points: z.array(z.string()).max(20).default([]),
  decisions: z.array(coerceToTextObject).max(30).default([]),
  risks: z.array(coerceToTextObject).max(30).default([]),
  issues: z.array(coerceToTextObject).max(30).default([]),
  actions: z.array(coerceToTextObject).max(30).default([]),
  dates_mentioned: z.array(coerceDateString).max(30).default([]),
  related_entities: z.object({
    tasks: z.array(z.object({ id: z.string(), name: z.string(), reason: z.string() })).optional().default([]),
    risks: z.array(z.object({ id: z.string(), name: z.string(), reason: z.string() })).optional().default([]),
    milestones: z.array(z.object({ id: z.string(), name: z.string(), reason: z.string() })).optional().default([]),
  }).default({ tasks: [], risks: [], milestones: [] }),
  confidence: z.number().min(0).max(1).default(0.5),
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
