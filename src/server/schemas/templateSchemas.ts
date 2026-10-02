import { z } from 'zod';
import { PROJECT_TYPES } from '../constants/projectTypes';

export const templateTaskSchema = z.object({
  refId: z.string(),
  name: z.string(),
  description: z.string().default(''),
  estimatedDays: z.number().min(1),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  parentRefId: z.string().nullable().default(null),
  dependencyRefId: z.string().nullable().default(null),
  dependencyType: z.enum(['FS', 'SS', 'FF', 'SF']).default('FS'),
  /** Working days after the predecessor (FS: after it finishes; SS: after it starts) */
  lagDays: z.number().min(0).optional(),
  /** Further predecessors beyond dependencyRefId (2026-10-02: a task waiting on two others lost one link) */
  moreDependencies: z.array(z.object({
    refId: z.string(),
    dependencyType: z.enum(['FS', 'SS', 'FF', 'SF']).default('FS'),
    lagDays: z.number().default(0),
  })).optional(),
  offsetDays: z.number().default(0),
  skills: z.array(z.string()).default([]),
  isSummary: z.boolean().default(false),
  mandatory: z.boolean().optional(),
  /** A gate or decision point: zero duration, and the schedule review expects it. */
  isMilestone: z.boolean().optional(),
});

export type TemplateTask = z.infer<typeof templateTaskSchema>;

/**
 * A risk, assumption, issue or dependency that a consultant would raise on day one of
 * this kind of engagement.
 *
 * A template that produces only a task list leaves the governance to be remembered. The
 * point of an engagement scaffold is that applying it gives you the plan AND the things
 * you are expected to be managing alongside it.
 */
export const templateRaidSchema = z.object({
  type: z.enum(['risk', 'assumption', 'issue', 'dependency', 'action']),
  title: z.string(),
  description: z.string().default(''),
  /** Risks only. Left undefined for the other types. */
  probability: z.enum(['low', 'medium', 'high']).optional(),
  impact: z.enum(['low', 'medium', 'high']).optional(),
});

export type TemplateRaidItem = z.infer<typeof templateRaidSchema>;

/** How often the client expects a written status report. */
export const templateReportCadenceSchema = z.object({
  frequency: z.enum(['weekly', 'biweekly', 'monthly']),
  /** 1 = Monday … 5 = Friday. Which day the report goes out. */
  dayOfWeek: z.number().min(1).max(7).default(5),
  description: z.string().default(''),
});

export type TemplateReportCadence = z.infer<typeof templateReportCadenceSchema>;

export const projectTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  projectType: z.enum(PROJECT_TYPES),
  category: z.string(),
  isBuiltIn: z.boolean().default(true),
  createdBy: z.string().nullable().default(null),
  estimatedDurationDays: z.number(),
  tasks: z.array(templateTaskSchema),
  tags: z.array(z.string()).default([]),
  usageCount: z.number().default(0),
  defaultMethodology: z.enum(['waterfall', 'agile', 'hybrid']).optional(),
  /**
   * The governance scaffold. Optional, so existing templates keep working unchanged and
   * a plain task-list template stays valid.
   */
  raidItems: z.array(templateRaidSchema).optional(),
  reportCadence: templateReportCadenceSchema.optional(),
});

export type ProjectTemplate = z.infer<typeof projectTemplateSchema>;

export const createFromTemplateSchema = z.object({
  templateId: z.string({ message: 'Choose a template to use (templateId).' }).min(1, 'Choose a template to use (templateId).'),
  projectName: z.string({ message: 'Enter a name for the new project.' }).trim().min(1, 'Enter a name for the new project.'),
  startDate: z.string({ message: 'Enter a start date for the new project.' }).min(1, 'Enter a start date for the new project.'),
  budget: z.number().positive().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  methodology: z.enum(['waterfall', 'agile', 'hybrid']).default('waterfall'),
  location: z.string().optional(),
  selectedTaskRefIds: z.array(z.string()).min(1).optional(),
});

export type CreateFromTemplate = z.infer<typeof createFromTemplateSchema>;

export const saveAsTemplateSchema = z.object({
  projectId: z.string({ message: 'Say which project to save as a template (projectId).' }).min(1, 'Say which project to save as a template (projectId).'),
  templateName: z.string({ message: 'Enter a name for the template.' }).trim().min(1, 'Enter a name for the template.'),
  description: z.string().default(''),
  tags: z.array(z.string()).default([]),
});

export type SaveAsTemplate = z.infer<typeof saveAsTemplateSchema>;
