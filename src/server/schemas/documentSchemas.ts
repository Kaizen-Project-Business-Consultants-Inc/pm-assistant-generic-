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

// The model may wrap fields in nested objects or use camelCase.
// This preprocessor flattens common wrapper patterns before Zod validation.
function flattenModelOutput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;

  // If model wrapped everything in a single top-level key like "analysis" or "result", unwrap
  const keys = Object.keys(obj);
  if (keys.length === 1 && typeof obj[keys[0]] === 'object' && obj[keys[0]] !== null) {
    const inner = obj[keys[0]] as Record<string, unknown>;
    // Only unwrap if the inner object looks like our schema (has document_type or summary)
    if ('document_type' in inner || 'documentType' in inner || 'summary' in inner) {
      return flattenModelOutput(inner);
    }
  }

  // Normalize camelCase to snake_case for known fields
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    normalized[snakeKey] = value;
  }

  // Also merge nested "classification" or "extracted_items" sub-objects into flat
  for (const wrapperKey of ['classification', 'extracted_items', 'extraction', 'insights', 'entity_linking']) {
    const sub = normalized[wrapperKey];
    if (sub && typeof sub === 'object' && !Array.isArray(sub)) {
      const subObj = sub as Record<string, unknown>;
      for (const [k, v] of Object.entries(subObj)) {
        const sk = k.replace(/([A-Z])/g, '_$1').toLowerCase();
        if (!(sk in normalized)) normalized[sk] = v;
      }
      delete normalized[wrapperKey];
    }
  }

  return normalized;
}

export const DocumentAIResponseSchema = z.preprocess(flattenModelOutput, z.object({
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
}));

export type DocumentAIResponse = z.infer<typeof DocumentAIResponseSchema>;

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface ProjectDocument {
  id: string;
  projectId: string;
  filename: string;
  originalFilename: string;
  description: string | null;
  contentType: string;
  fileSize: number;
  extractedText: string | null;
  documentType: DocumentType;
  projectPhase: ProjectPhase;
  tags: string[];
  folder: string | null;
  isPinned: boolean;
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
