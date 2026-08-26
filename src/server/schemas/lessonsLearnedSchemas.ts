import { z } from 'zod';

// ---------------------------------------------------------------------------
// Lesson Learned
// ---------------------------------------------------------------------------

export const LESSON_STATUSES = ['draft', 'reviewed', 'approved', 'archived'] as const;
export const LESSON_SOURCE_TYPES = ['manual', 'ai_extracted', 'agent', 'seeded'] as const;
export const LESSON_CATEGORIES = [
  'schedule', 'budget', 'resource', 'risk', 'technical',
  'communication', 'stakeholder', 'quality',
] as const;

export const LessonLearnedSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  projectType: z.string(),
  category: z.enum(LESSON_CATEGORIES),
  title: z.string(),
  description: z.string(),
  impact: z.enum(['positive', 'negative', 'neutral']),
  recommendation: z.string(),
  confidence: z.number().min(0).max(100),
  status: z.enum(LESSON_STATUSES).default('approved'),
  createdBy: z.number().nullable().optional(),
  sourceType: z.enum(LESSON_SOURCE_TYPES).default('manual'),
  tags: z.array(z.string()).nullable().optional(),
  appliedCount: z.number().default(0),
  effectivenessRating: z.number().min(0).max(100).nullable().optional(),
  createdAt: z.string(),
});

export type LessonLearned = z.infer<typeof LessonLearnedSchema>;

// ---------------------------------------------------------------------------
// Pattern (cross-project recurring insight)
// ---------------------------------------------------------------------------

export const PatternSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  frequency: z.number(), // how many projects exhibit this pattern
  projectTypes: z.array(z.string()),
  category: z.string(),
  recommendation: z.string(),
  confidence: z.number().min(0).max(100),
  detectedAt: z.string().optional(),
});

export type Pattern = z.infer<typeof PatternSchema>;

// ---------------------------------------------------------------------------
// Mitigation Suggestion
// ---------------------------------------------------------------------------

export const MitigationSuggestionSchema = z.object({
  lessonId: z.string().optional(),
  source: z.string(), // project name the lesson came from
  relevance: z.number().min(0).max(100),
  suggestion: z.string(),
  historicalOutcome: z.string().optional(),
});

export type MitigationSuggestion = z.infer<typeof MitigationSuggestionSchema>;

// ---------------------------------------------------------------------------
// Knowledge Base Overview (aggregated view)
// ---------------------------------------------------------------------------

export const KnowledgeBaseOverviewSchema = z.object({
  totalLessons: z.number(),
  byCategory: z.record(z.string(), z.number()),
  byProjectType: z.record(z.string(), z.number()),
  byImpact: z.record(z.string(), z.number()),
  recentLessons: z.array(LessonLearnedSchema),
  patterns: z.array(PatternSchema),
});

export type KnowledgeBaseOverview = z.infer<typeof KnowledgeBaseOverviewSchema>;

// ---------------------------------------------------------------------------
// AI Schemas — used with claudeService.completeWithJsonSchema
// ---------------------------------------------------------------------------

export const LessonsExtractionAISchema = z.object({
  lessons: z.array(
    z.object({
      category: z.enum(LESSON_CATEGORIES),
      title: z.string(),
      description: z.string(),
      impact: z.enum(['positive', 'negative', 'neutral']),
      recommendation: z.string(),
      confidence: z.number().min(0).max(100),
    }),
  ),
});

export type LessonsExtractionAI = z.infer<typeof LessonsExtractionAISchema>;

export const PatternDetectionAISchema = z.object({
  patterns: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      frequency: z.number(),
      projectTypes: z.array(z.string()),
      category: z.string(),
      recommendation: z.string(),
      confidence: z.number().min(0).max(100),
    }),
  ),
});

export type PatternDetectionAI = z.infer<typeof PatternDetectionAISchema>;

export const MitigationAISchema = z.object({
  suggestions: z.array(
    z.object({
      suggestion: z.string(),
      relevance: z.number().min(0).max(100),
      historicalOutcome: z.string().optional(),
    }),
  ),
});

export type MitigationAI = z.infer<typeof MitigationAISchema>;
