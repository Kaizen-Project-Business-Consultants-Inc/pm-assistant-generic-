import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { parse as csvParse } from 'csv-parse/sync';
import { scheduleService, type CreateTaskData } from '../../services/ScheduleService';
import { resourceService } from '../../services/ResourceService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import logger from '../../utils/logger';

const importCsvSchema = z.object({
  csv: z.string().min(1).max(5 * 1024 * 1024),
  columnMap: z.record(z.string(), z.string()).optional(),
});

const MAX_BULK = 100;

/** Fix common UTF-8 mojibake from Windows-1252 encoded files. */
function fixMojibake(text: string): string {
  return text
    .replace(/\u00E2\u0080\u0094/g, '\u2014')  // em dash
    .replace(/\u00E2\u0080\u0093/g, '\u2013')  // en dash
    .replace(/\u00E2\u0080\u0099/g, '\u2019')  // right single quote
    .replace(/\u00E2\u0080\u0098/g, '\u2018')  // left single quote
    .replace(/\u00E2\u0080\u009C/g, '\u201C')  // left double quote
    .replace(/\u00E2\u0080\u009D/g, '\u201D')  // right double quote
    .replace(/\u00E2\u0080\u00A2/g, '\u2022')  // bullet
    .replace(/\u00E2\u0080\u00A6/g, '\u2026')  // ellipsis
    .replace(/\u00C2\u00B7/g, '\u00B7')         // middle dot
    .replace(/\u00C2\u00A0/g, ' ');             // non-breaking space
}

const VALID_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];

/** Normalise a CSV header to a known task field name, applying columnMap overrides first. */
function mapColumn(header: string, columnMap: Record<string, string> | undefined): string | null {
  const mapped = columnMap?.[header] ?? header;
  const key = mapped.trim().toLowerCase().replace(/\s+/g, '_');

  const aliases: Record<string, string> = {
    name: 'name',
    title: 'name',
    task: 'name',
    task_name: 'name',
    key_activities: 'name',
    key_milestone: 'name',
    milestone: 'name',
    activities: 'name',
    activity: 'name',
    status: 'status',
    priority: 'priority',
    start_date: 'startDate',
    startdate: 'startDate',
    start: 'startDate',
    target_start: 'startDate',
    planned_start: 'startDate',
    end_date: 'endDate',
    enddate: 'endDate',
    end: 'endDate',
    target_end: 'endDate',
    planned_end: 'endDate',
    due_date: 'dueDate',
    duedate: 'dueDate',
    due: 'dueDate',
    deadline: 'dueDate',
    assigned_to: 'assignedTo',
    assignedto: 'assignedTo',
    assignee: 'assignedTo',
    owner: 'assignedTo',
    resource: 'assignedTo',
    progress: 'progressPercentage',
    progress_percentage: 'progressPercentage',
    progresspercentage: 'progressPercentage',
    estimated_hours: 'estimatedDurationHours',
    estimated_duration_hours: 'estimatedDurationHours',
    estimateddurationhours: 'estimatedDurationHours',
    duration: 'estimatedDurationHours',
    'duration_(weeks)': 'estimatedDurationHours',
    hours: 'estimatedDurationHours',
    description: 'description',
    deliverables: 'description',
    deliverable: 'description',
    notes: 'description',
    details: 'description',
    purpose: 'description',
    milestone_purpose: 'description',
    'milestone_purpose_&_transparency_objectives': 'description',
    phase: '_phase',
    group: '_phase',
    category: '_phase',
    wbs: '_phase',
    section: '_phase',
  };

  return aliases[key] ?? null;
}

function toDateStr(val: string | undefined | null): string | null {
  if (!val || val.trim() === '') return null;
  const d = new Date(val.trim());
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export async function importRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // POST /:scheduleId/import — bulk import tasks from CSV
  fastify.post('/:scheduleId/import', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId } = request.params as { scheduleId: string };
      const rawBody = importCsvSchema.parse(request.body);
      const csv = fixMojibake(rawBody.csv);
      const columnMap = rawBody.columnMap;

      // Schedule existence check
      const schedule = await scheduleService.findById(scheduleId);
      if (!schedule) {
        return reply.status(404).send({ error: 'Schedule not found' });
      }

      const userId = request.user!.userId;

      let records: Record<string, string>[];
      try {
        records = csvParse(csv, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
          relax_column_count: true,
        });
      } catch (parseErr: any) {
        return reply.status(400).send({ error: `CSV parse error: ${parseErr.message}` });
      }

      if (records.length === 0) {
        return reply.status(400).send({ error: 'CSV contains no data rows' });
      }

      if (records.length > MAX_BULK) {
        return reply.status(400).send({ error: `Too many rows (${records.length}). Maximum is ${MAX_BULK}.` });
      }

      // Build dedup set from existing tasks
      const existingTasks = await scheduleService.findTasksByScheduleId(scheduleId);
      const existingKeys = new Set(
        existingTasks.map(t => `${t.name.toLowerCase().trim()}|${t.startDate || ''}`)
      );

      const succeeded: number[] = [];
      const failed: { row: number; error: string }[] = [];
      const importedAssignees = new Set<string>(); // collect unique assignee names

      // Track phase/group summary tasks so child tasks get parentTaskId
      const phaseTaskIds = new Map<string, string>(); // phase name → taskId

      for (let i = 0; i < records.length; i++) {
        const rawRow = records[i];
        const rowNum = i + 1; // 1-based row number (excluding header)

        try {
          // Map CSV columns to task fields
          const row: Record<string, string> = {};
          for (const [header, value] of Object.entries(rawRow)) {
            const field = mapColumn(header, columnMap);
            if (field) {
              row[field] = value;
            }
          }

          if (!row.name || row.name.trim() === '') {
            throw new Error('name is required');
          }

          // Handle phase/group column → create summary task if new phase
          let parentTaskId: string | undefined;
          const phase = row._phase?.trim();
          if (phase) {
            if (!phaseTaskIds.has(phase)) {
              // Create a summary task for this phase
              const phaseDedupKey = `${phase.toLowerCase()}|`;
              if (!existingKeys.has(phaseDedupKey)) {
                const phaseTask = await scheduleService.createTask({
                  scheduleId,
                  name: phase,
                  status: 'in_progress' as CreateTaskData['status'],
                  priority: 'medium' as CreateTaskData['priority'],
                  createdBy: userId,
                });
                const phaseId = phaseTask.id;
                phaseTaskIds.set(phase, phaseId);
                existingKeys.add(phaseDedupKey);
              } else {
                // Phase task already exists — find its ID
                const existing = existingTasks.find(t => t.name.toLowerCase().trim() === phase.toLowerCase());
                if (existing) phaseTaskIds.set(phase, existing.id);
              }
            }
            parentTaskId = phaseTaskIds.get(phase);
          }

          // Validate and default status
          let status = 'pending';
          if (row.status && row.status.trim() !== '') {
            const s = row.status.trim().toLowerCase();
            if (!VALID_STATUSES.includes(s)) {
              throw new Error(`Invalid status "${row.status}". Must be one of: ${VALID_STATUSES.join(', ')}`);
            }
            status = s;
          }

          // Validate and default priority
          let priority = 'medium';
          if (row.priority && row.priority.trim() !== '') {
            const p = row.priority.trim().toLowerCase();
            if (!VALID_PRIORITIES.includes(p)) {
              throw new Error(`Invalid priority "${row.priority}". Must be one of: ${VALID_PRIORITIES.join(', ')}`);
            }
            priority = p;
          }

          const startDate = toDateStr(row.startDate);
          const endDate = toDateStr(row.endDate);
          const dueDate = toDateStr(row.dueDate);
          const progressPercentage = row.progressPercentage ? parseFloat(row.progressPercentage) : 0;
          const estimatedDurationHours = row.estimatedDurationHours ? parseFloat(row.estimatedDurationHours) : null;

          if (row.progressPercentage && isNaN(progressPercentage)) {
            throw new Error(`Invalid progress value "${row.progressPercentage}"`);
          }
          if (row.estimatedDurationHours && estimatedDurationHours !== null && isNaN(estimatedDurationHours)) {
            throw new Error(`Invalid estimated_hours value "${row.estimatedDurationHours}"`);
          }

          // Duplicate detection
          const dedupKey = `${row.name.trim().toLowerCase()}|${startDate || ''}`;
          if (existingKeys.has(dedupKey)) {
            throw new Error(`Duplicate task: "${row.name.trim()}" with start date ${startDate || '(none)'} already exists`);
          }

          await scheduleService.createTask({
            scheduleId,
            name: row.name.trim(),
            description: row.description || undefined,
            status: status as CreateTaskData['status'],
            priority: priority as CreateTaskData['priority'],
            assignedTo: row.assignedTo || undefined,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            dueDate: dueDate || undefined,
            progressPercentage,
            estimatedDurationHours: estimatedDurationHours ?? undefined,
            parentTaskId,
            createdBy: userId,
          });

          // Add to dedup set to catch intra-batch duplicates
          existingKeys.add(dedupKey);

          // Track assignee for resource auto-creation
          if (row.assignedTo && row.assignedTo.trim()) {
            importedAssignees.add(row.assignedTo.trim());
          }

          succeeded.push(rowNum);
        } catch (rowErr: any) {
          failed.push({ row: rowNum, error: rowErr.message || 'Unknown error' });
        }
      }

      // Auto-create resources for new assignees
      let resourcesCreated = 0;
      if (importedAssignees.size > 0) {
        try {
          const existingResources = await resourceService.findAllResources();
          const existingNames = new Set(existingResources.map(r => r.name.toLowerCase().trim()));

          for (const assignee of importedAssignees) {
            if (!existingNames.has(assignee.toLowerCase().trim())) {
              await resourceService.createResource({
                name: assignee,
                role: '',
                email: '',
                capacityHoursPerWeek: 40,
                skills: [],
                isActive: true,
                costRateHourly: null,
                resourceGroup: null,
                userId: null,
                calendarTemplateId: null,
              });
              existingNames.add(assignee.toLowerCase().trim());
              resourcesCreated++;
            }
          }
        } catch (resErr: any) {
          logger.warn('Failed to auto-create resources during import', { error: resErr.message });
        }
      }

      return {
        succeeded: succeeded.length,
        failed,
        total: records.length,
        resourcesCreated,
      };
    } catch (error: any) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('CSV import error', { error });
      return reply.status(500).send({ error: 'Failed to import CSV' });
    }
  });

  // POST /:scheduleId/import-structured — import tasks from structured JSON (used by MSPDI parser)
  const structuredTaskSchema = z.object({
    name: z.string().min(1),
    wbs: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    duration: z.number().optional(),
    predecessors: z.string().optional(), // "3FS+2d,5SS"
    percentComplete: z.number().min(0).max(100).optional(),
    outlineLevel: z.number().int().min(0).optional(),
  });

  const importStructuredSchema = z.object({
    tasks: z.array(structuredTaskSchema).max(500),
  });

  fastify.post('/:scheduleId/import-structured', { preHandler: [requireScope('write')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId } = request.params as { scheduleId: string };
      const body = importStructuredSchema.parse(request.body);
      const schedule = await scheduleService.findById(scheduleId);
      if (!schedule) return reply.status(404).send({ error: 'Schedule not found' });

      const userId = request.user!.userId;
      const uidToTaskId = new Map<number, string>();
      const levelStack: { level: number; taskId: string }[] = [];

      const succeeded: number[] = [];
      const failed: { row: number; error: string }[] = [];

      for (let i = 0; i < body.tasks.length; i++) {
        const t = body.tasks[i];
        try {
          // Determine parent from outlineLevel
          const level = t.outlineLevel ?? 1;
          let parentTaskId: string | undefined;
          while (levelStack.length > 0 && levelStack[levelStack.length - 1].level >= level) {
            levelStack.pop();
          }
          if (levelStack.length > 0) {
            parentTaskId = levelStack[levelStack.length - 1].taskId;
          }

          // Compute end date from duration if missing
          let endDate = t.endDate ? toDateStr(t.endDate) : null;
          const startDate = t.startDate ? toDateStr(t.startDate) : null;
          if (!endDate && startDate && t.duration) {
            const s = new Date(startDate);
            s.setDate(s.getDate() + t.duration);
            endDate = s.toISOString().slice(0, 10);
          }

          const task = await scheduleService.createTask({
            scheduleId,
            name: t.name.trim(),
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            estimatedDays: t.duration || undefined,
            progressPercentage: t.percentComplete || 0,
            parentTaskId,
            createdBy: userId,
          });

          uidToTaskId.set(i + 1, task.id); // Use 1-based index as UID proxy
          levelStack.push({ level, taskId: task.id });
          succeeded.push(i + 1);
        } catch (rowErr: any) {
          failed.push({ row: i + 1, error: rowErr.message || 'Unknown error' });
        }
      }

      // Second pass: create dependencies
      let depsCreated = 0;
      for (let i = 0; i < body.tasks.length; i++) {
        const t = body.tasks[i];
        if (!t.predecessors) continue;

        const taskId = uidToTaskId.get(i + 1);
        if (!taskId) continue;

        const predParts = t.predecessors.split(',').map(s => s.trim()).filter(Boolean);
        for (const pred of predParts) {
          // Parse "3FS+2d" or "3" or "3SS-1d"
          const m = pred.match(/^(\d+)(FS|FF|SS|SF)?([+-]\d+d)?$/);
          if (!m) continue;

          const predUid = parseInt(m[1]);
          const depType = (m[2] || 'FS') as 'FS' | 'FF' | 'SS' | 'SF';
          const lagDays = m[3] ? parseInt(m[3].replace('d', '')) : 0;

          const depId = uidToTaskId.get(predUid);
          if (!depId) continue;

          try {
            await scheduleService.addDependency(taskId, depId, depType, lagDays);
            depsCreated++;
          } catch {
            // Skip invalid dependencies silently
          }
        }
      }

      return {
        succeeded: succeeded.length,
        failed,
        total: body.tasks.length,
        dependenciesCreated: depsCreated,
      };
    } catch (error: any) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Structured import error', { error });
      return reply.status(500).send({ error: 'Failed to import tasks' });
    }
  });
}
