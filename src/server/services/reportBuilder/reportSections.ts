import { z } from 'zod';

/**
 * What one Report Builder section may say — the one rule set for a section a PM builds by hand
 * and one Kovarti drafts from typed words (2026-10-20, mock https://claude.ai/artifact/5UUmYUEJesdXfuhx8V1B5m).
 * Moved here from routes/reporting/reportBuilder.ts so both use it.
 */
export const SECTION_TYPES = ['kpi', 'kpi_card', 'table', 'bar_chart', 'line_chart', 'pie_chart'] as const;
export const DATA_SOURCES = ['projects', 'tasks', 'time_entries', 'budgets', 'resources', 'raid_items', 'meetings', 'action_items'] as const;

export const reportSectionSchema = z.object({
  title: z.string().optional(),
  type: z.enum(SECTION_TYPES),
  dataSource: z.enum(DATA_SOURCES),
  filters: z.object({
    dateRange: z.object({ start: z.string(), end: z.string() }).optional(),
    dateStart: z.string().optional(),
    dateEnd: z.string().optional(),
    projectId: z.string().optional(),
    status: z.string().optional(),
    /** Only what is past its due date and not done (tasks and action items) */
    overdue: z.boolean().optional(),
  }).optional(),
  groupBy: z.string().optional(),
  columns: z.array(z.string()).optional(),
});

export type ReportSectionInput = z.infer<typeof reportSectionSchema>;

/** Most sections a drafted report holds (and a preview runs) */
export const MAX_DRAFT_SECTIONS = 12;

/**
 * Group-by choices per data source: the same values the hand designer offers (ReportDesigner
 * GROUP_BY_OPTIONS), so a drafted section opens there with its grouping selected
 */
export const GROUP_BY_CHOICES: Record<(typeof DATA_SOURCES)[number], string[]> = {
  projects: ['status', 'priority', 'month'],
  tasks: ['project', 'assignee', 'status', 'priority', 'week', 'month'],
  time_entries: ['project', 'resource', 'week', 'month'],
  budgets: ['project', 'status', 'month'],
  resources: ['role', 'resource_group', 'is_active'],
  raid_items: ['type', 'severity', 'status', 'category', 'month'],
  meetings: ['meeting_type', 'status', 'month', 'week'],
  action_items: ['status', 'priority', 'assignee_name', 'source', 'month'],
};
