import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { parse as csvParse } from 'csv-parse/sync';
import { scheduleService, type CreateTaskData } from '../../services/ScheduleService';
import { resourceService } from '../../services/ResourceService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireFeature } from '../../middleware/requireTier';
import { claudeService } from '../../services/claudeService';
import { config } from '../../config';
import logger from '../../utils/logger';
import { resolveAssigneeResources, assigneeToResourceId } from '../../utils/assigneeResources';
import { scheduleReviewService } from '../../services/ScheduleReviewService';
import { baselineService } from '../../services/BaselineService';
import {
  parsePredecessorTokens,
  resolvePredecessor,
  MAX_PREDECESSORS_PER_ROW,
  type PredecessorLookups,
} from '../../utils/importPredecessors';
import {
  isLegendRow,
  cleanAssignee,
  workingDaySpan,
  decideDurationUnit,
  type DurationSample,
} from '../../utils/importHeuristics';

/** Truthy string test for boolean-ish import columns (yes/y/true/1/x). */
function isTruthyFlag(v: string | undefined | null): boolean {
  if (!v) return false;
  return /^(y|yes|true|1|x|✓|milestone)$/i.test(v.trim());
}

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
  if (mapped === '_skip') return null;
  const key = mapped.trim().toLowerCase().replace(/\s+/g, '_');

  const aliases: Record<string, string> = {
    name: 'name',
    title: 'name',
    task_name: 'name',
    key_activities: 'name',
    key_milestone: 'name',
    milestone: 'name',
    activities: 'name',
    activity: 'name',
    task: '_phase',
    status: 'status',
    priority: 'priority',
    start_date: 'startDate',
    startdate: 'startDate',
    start: 'startDate',
    target_start: 'startDate',
    planned_start: 'startDate',
    planned_start_date: 'startDate',
    finish: 'endDate',
    end_date: 'endDate',
    enddate: 'endDate',
    end: 'endDate',
    target_end: 'endDate',
    planned_end: 'endDate',
    planned_end_date: 'endDate',
    due_date: 'dueDate',
    duedate: 'dueDate',
    due: 'dueDate',
    deadline: 'dueDate',
    resource_names: 'assignedTo',
    assigned_to: 'assignedTo',
    assignedto: 'assignedTo',
    assignee: 'assignedTo',
    owner: 'assignedTo',
    resource: 'assignedTo',
    responsibility: 'assignedTo',
    '%_complete': 'progressPercentage',
    percent_complete: 'progressPercentage',
    complete: 'progressPercentage',
    progress: 'progressPercentage',
    progress_percentage: 'progressPercentage',
    progresspercentage: 'progressPercentage',
    estimated_hours: 'estimatedDurationHours',
    estimated_duration_hours: 'estimatedDurationHours',
    estimateddurationhours: 'estimatedDurationHours',
    duration: 'estimatedDurationHours',
    'duration_(weeks)': 'estimatedDurationHours',
    hours: 'estimatedDurationHours',
    planned_days: 'estimatedDurationHours',
    days: 'estimatedDurationHours',
    description: 'description',
    deliverables: 'description',
    deliverable: 'description',
    notes: 'description',
    details: 'description',
    purpose: 'description',
    milestone_purpose: 'description',
    'milestone_purpose_&_transparency_objectives': 'description',
    actual_start: 'actualStartDate',
    actual_start_date: 'actualStartDate',
    actualstart: 'actualStartDate',
    actual_finish: 'actualEndDate',
    actual_end: 'actualEndDate',
    actual_end_date: 'actualEndDate',
    actual_finish_date: 'actualEndDate',
    actualfinish: 'actualEndDate',
    actualend: 'actualEndDate',
    baseline_start: 'baselineStartDate',
    baseline_start_date: 'baselineStartDate',
    baselinestart: 'baselineStartDate',
    baseline_finish: 'baselineFinishDate',
    baseline_finish_date: 'baselineFinishDate',
    baseline_end: 'baselineFinishDate',
    baselinefinish: 'baselineFinishDate',
    baselineend: 'baselineFinishDate',
    baseline_duration: 'baselineDurationDays',
    baseline_duration_days: 'baselineDurationDays',
    baselineduration: 'baselineDurationDays',
    baseline_cost: 'baselineCost',
    baselinecost: 'baselineCost',
    predecessors: '_predecessors',
    predecessor: '_predecessors',
    depends_on: '_predecessors',
    dependson: '_predecessors',
    dependency: '_predecessors',
    dependencies: '_predecessors',
    is_milestone: '_milestone',
    ismilestone: '_milestone',
    milestone_flag: '_milestone',
    milestone_yn: '_milestone',
    type: '_type',
    task_type: '_type',
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

/**
 * A schedule is imported once. After that it is maintained in the app.
 *
 * Importing into a schedule that already has tasks used to MERGE: rows matching an
 * existing task on name AND start date were rejected one by one, everything else was
 * added. That is the one pairing guaranteed to fail on a revised plan, because a
 * revision is a change of dates — so every moved task arrived as a brand new task and
 * the schedule quietly doubled.
 *
 * Rather than guess which row is which, the second import is refused and the message
 * says what to do instead. A "show me what would change and let me approve it" flow is
 * the better long-term answer, but nobody has needed it yet and a wrong guess silently
 * corrupts a plan.
 */
async function refuseIfAlreadyImported(scheduleId: string, reply: FastifyReply) {
  const existing = await scheduleService.findTasksByScheduleId(scheduleId);
  if (existing.length === 0) return null;
  return reply.status(409).send({
    error: 'Schedule already has tasks',
    message:
      `This schedule already contains ${existing.length} task${existing.length === 1 ? '' : 's'}, ` +
      `so importing again would duplicate them. Edit the schedule here, or archive the project ` +
      `and import the revised plan into a fresh one.`,
    taskCount: existing.length,
  });
}

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

      const alreadyImported = await refuseIfAlreadyImported(scheduleId, reply);
      if (alreadyImported) return alreadyImported;

      // Build dedup set from existing tasks
      const existingTasks = await scheduleService.findTasksByScheduleId(scheduleId);
      const existingKeys = new Set(
        existingTasks.map(t => `${t.name.toLowerCase().trim()}|${t.startDate || ''}`)
      );

      const succeeded: number[] = [];
      const failed: { row: number; error: string }[] = [];
      const skipped: { row: number; name: string; reason: string }[] = [];
      const warnings: string[] = [];

      // Resolve assignee names to resource IDs up front so imported tasks are
      // linked to real resources (creating any that don't exist yet). Cell-ref
      // artefacts (e.g. "DBJ & JV+D9:D27") are cleaned before resolution.
      const importedAssignees = new Set<string>();
      for (const rawRow of records) {
        for (const [header, value] of Object.entries(rawRow)) {
          if (mapColumn(header, columnMap) === 'assignedTo') {
            const cleaned = cleanAssignee(value);
            if (cleaned) importedAssignees.add(cleaned);
          }
        }
      }
      let assigneeIdByName = new Map<string, string>();
      let resourcesCreated = 0;
      if (importedAssignees.size > 0) {
        try {
          const existingResources = await resourceService.findAllResources();
          const resolution = await resolveAssigneeResources(
            importedAssignees,
            existingResources,
            (name) => resourceService.createResource({
              name,
              role: '',
              email: '',
              capacityHoursPerWeek: 40,
              skills: [],
              isActive: true,
              costRateHourly: null,
              overtimeRateHourly: null,
              resourceGroup: null,
              userId: null,
              calendarTemplateId: null,
            }),
          );
          assigneeIdByName = resolution.idByName;
          resourcesCreated = resolution.created;
        } catch (resErr: any) {
          // Fall back to storing raw names on the tasks
          logger.warn('Failed to auto-create resources during import', { error: resErr.message });
        }
      }

      // Normalise a raw CSV row into a validated, prepared task. Legend/artefact
      // rows are dropped here; unit (hours vs days) is decided across all rows
      // before any task is created.
      interface PreparedRow {
        rowNum: number;
        name: string;
        description?: string;
        status: string;
        priority: string;
        assignedTo: string | null;
        startDate: string | null;
        endDate: string | null;
        dueDate: string | null;
        actualStartDate: string | null;
        actualEndDate: string | null;
        baselineStartDate: string | null;
        baselineFinishDate: string | null;
        baselineDurationDays: number | null;
        baselineCost: number | null;
        progressPercentage: number;
        durationValue: number | null;
        isMilestone: boolean;
        phase?: string;
        predecessors: string | null;
      }

      const prepared: PreparedRow[] = [];
      let sawBaselineColumn = false;
      let sawActualColumn = false;

      // ---- Pass 1: map + validate each row ----
      for (let i = 0; i < records.length; i++) {
        const rawRow = records[i];
        const rowNum = i + 1; // 1-based row number (excluding header)

        try {
          const row: Record<string, string> = {};
          for (const [header, value] of Object.entries(rawRow)) {
            const field = mapColumn(header, columnMap);
            if (field) row[field] = value;
          }

          const name = (row.name || '').trim();
          if (!name) throw new Error('name is required');

          // Drop legend/artefact rows (a lone status word with empty cells).
          const otherValues = Object.entries(row).filter(([k]) => k !== 'name').map(([, v]) => v);
          if (isLegendRow(name, otherValues)) {
            skipped.push({ row: rowNum, name, reason: 'legend or artefact row' });
            continue;
          }

          // Validate and default status (normalize common Gantt labels)
          let status = 'pending';
          if (row.status && row.status.trim() !== '') {
            const s = row.status.trim().toLowerCase().replace(/[\s_-]+/g, '_');
            const statusAliases: Record<string, string> = {
              pending: 'pending', not_started: 'pending', 'not started': 'pending',
              in_progress: 'in_progress', 'in progress': 'in_progress', on_track: 'in_progress', ahead: 'in_progress',
              completed: 'completed', done: 'completed', finished: 'completed',
              cancelled: 'cancelled', canceled: 'cancelled',
              delayed: 'in_progress',
            };
            const mapped = statusAliases[s];
            if (mapped) status = mapped;
            else if (VALID_STATUSES.includes(s)) status = s;
            // If unrecognized, silently default to 'pending' rather than failing
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
          const progressPercentage = row.progressPercentage ? parseFloat(row.progressPercentage) : 0;
          const durationValue = row.estimatedDurationHours ? parseFloat(row.estimatedDurationHours) : null;

          if (row.progressPercentage && isNaN(progressPercentage)) {
            throw new Error(`Invalid progress value "${row.progressPercentage}"`);
          }
          if (row.estimatedDurationHours && durationValue !== null && isNaN(durationValue)) {
            throw new Error(`Invalid duration value "${row.estimatedDurationHours}"`);
          }

          if (row.baselineStartDate || row.baselineFinishDate || row.baselineDurationDays || row.baselineCost) {
            sawBaselineColumn = true;
          }
          if (row.actualStartDate || row.actualEndDate) sawActualColumn = true;

          const isMilestone =
            isTruthyFlag(row._milestone) ||
            row._type?.trim().toLowerCase() === 'milestone' ||
            durationValue === 0;

          prepared.push({
            rowNum,
            name,
            description: row.description || undefined,
            status,
            priority,
            assignedTo: cleanAssignee(row.assignedTo),
            startDate,
            endDate,
            dueDate: toDateStr(row.dueDate),
            actualStartDate: toDateStr(row.actualStartDate),
            actualEndDate: toDateStr(row.actualEndDate),
            baselineStartDate: toDateStr(row.baselineStartDate),
            baselineFinishDate: toDateStr(row.baselineFinishDate),
            baselineDurationDays: row.baselineDurationDays ? parseFloat(row.baselineDurationDays) : null,
            baselineCost: row.baselineCost ? parseFloat(row.baselineCost) : null,
            progressPercentage,
            durationValue,
            isMilestone,
            phase: row._phase?.trim() || undefined,
            predecessors: row._predecessors?.trim() || null,
          });
        } catch (rowErr: any) {
          failed.push({ row: rowNum, error: rowErr.message || 'Unknown error' });
        }
      }

      // ---- Decide hours vs days once, across the whole schedule ----
      const durationUnit = decideDurationUnit(
        prepared.map(p => ({
          span: p.startDate && p.endDate ? workingDaySpan(p.startDate, p.endDate) : null,
          value: p.durationValue,
        }) as DurationSample),
      );
      const durationNote = durationUnit === 'days'
        ? 'Interpreted the duration column as days, not hours.'
        : null;

      // ---- Pass 2: create tasks ----
      const phaseTaskIds = new Map<string, string>(); // phase name → taskId
      const rowNumToTaskId = new Map<string, string>(); // 1-based row number → taskId
      const nameToTaskId = new Map<string, string>();
      for (const t of existingTasks) nameToTaskId.set(t.name.toLowerCase().trim(), t.id);

      for (const p of prepared) {
        try {
          // Phase/group column → create (or reuse) a summary parent task
          let parentTaskId: string | undefined;
          if (p.phase) {
            const phase = p.phase;
            if (!phaseTaskIds.has(phase)) {
              const phaseDedupKey = `${phase.toLowerCase()}|`;
              if (!existingKeys.has(phaseDedupKey)) {
                const phaseTask = await scheduleService.createTask({
                  scheduleId,
                  name: phase,
                  status: 'in_progress' as CreateTaskData['status'],
                  priority: 'medium' as CreateTaskData['priority'],
                  createdBy: userId,
                });
                phaseTaskIds.set(phase, phaseTask.id);
                nameToTaskId.set(phase.toLowerCase(), phaseTask.id);
                existingKeys.add(phaseDedupKey);
              } else {
                const existing = existingTasks.find(t => t.name.toLowerCase().trim() === phase.toLowerCase());
                if (existing) phaseTaskIds.set(phase, existing.id);
              }
            }
            parentTaskId = phaseTaskIds.get(phase);
          }

          const dedupKey = `${p.name.toLowerCase()}|${p.startDate || ''}`;
          if (existingKeys.has(dedupKey)) {
            throw new Error(`Duplicate task: "${p.name}" with start date ${p.startDate || '(none)'} already exists`);
          }

          const estimatedDays = durationUnit === 'days' ? (p.durationValue ?? undefined) : undefined;
          const estimatedDurationHours = durationUnit === 'days' ? undefined : (p.durationValue ?? undefined);

          const created = await scheduleService.createTask({
            scheduleId,
            name: p.name,
            description: p.description,
            status: p.status as CreateTaskData['status'],
            priority: p.priority as CreateTaskData['priority'],
            assignedTo: assigneeToResourceId(p.assignedTo || undefined, assigneeIdByName),
            startDate: p.startDate || undefined,
            endDate: p.endDate || undefined,
            dueDate: p.dueDate || undefined,
            actualStartDate: p.actualStartDate || undefined,
            actualEndDate: p.actualEndDate || undefined,
            baselineStartDate: p.baselineStartDate || undefined,
            baselineFinishDate: p.baselineFinishDate || undefined,
            baselineDurationDays: p.baselineDurationDays ?? undefined,
            baselineCost: p.baselineCost ?? undefined,
            progressPercentage: p.progressPercentage,
            estimatedDays,
            estimatedDurationHours,
            isMilestone: p.isMilestone || undefined,
            parentTaskId,
            createdBy: userId,
          });

          existingKeys.add(dedupKey);
          rowNumToTaskId.set(String(p.rowNum), created.id);
          nameToTaskId.set(p.name.toLowerCase(), created.id);
          succeeded.push(p.rowNum);
        } catch (rowErr: any) {
          failed.push({ row: p.rowNum, error: rowErr.message || 'Unknown error' });
        }
      }

      // ---- Pass 3: resolve predecessors into dependencies ----
      let dependenciesCreated = 0;
      const predLookups: PredecessorLookups = { byRef: rowNumToTaskId, byName: nameToTaskId };
      for (const p of prepared) {
        if (!p.predecessors) continue;
        const selfId = rowNumToTaskId.get(String(p.rowNum));
        if (!selfId) continue;

        const tokens = parsePredecessorTokens(p.predecessors);
        if (tokens.length > MAX_PREDECESSORS_PER_ROW) {
          warnings.push(`Row ${p.rowNum} ("${p.name}") lists ${tokens.length} predecessors; only the first ${MAX_PREDECESSORS_PER_ROW} were applied.`);
        }
        for (const tok of tokens.slice(0, MAX_PREDECESSORS_PER_ROW)) {
          const res = resolvePredecessor(tok, predLookups);
          if (!res) {
            warnings.push(`Row ${p.rowNum} ("${p.name}"): could not resolve predecessor "${tok.raw}".`);
            continue;
          }
          if (res.taskId === selfId) continue; // ignore self-reference
          try {
            await scheduleService.addDependency(selfId, res.taskId, res.type, res.lagDays);
            dependenciesCreated++;
          } catch {
            warnings.push(`Row ${p.rowNum} ("${p.name}"): predecessor "${tok.raw}" was rejected (cycle or duplicate).`);
          }
        }
      }

      // ---- Create an imported baseline when the file carried baseline/actual data ----
      let baselineCreated = false;
      if (succeeded.length > 0 && (sawBaselineColumn || sawActualColumn)) {
        try {
          await baselineService.create(scheduleId, 'Imported baseline', userId);
          baselineCreated = true;
        } catch (blErr: any) {
          logger.warn('Imported baseline creation failed', { scheduleId, error: blErr?.message });
        }
      }

      // Schedule Review runs on what just landed so the summary can show the score.
      // A review failure never fails the import.
      let review: { score: number; band: string; counts: Record<string, number>; topFindings: Array<{ ruleId: string; rule: string; severity: string; message: string; taskIds: string[] }> } | null = null;
      if (succeeded.length > 0) {
        try {
          const r = await scheduleReviewService.run(scheduleId, 'import', userId);
          review = {
            score: r.score,
            band: r.band,
            counts: r.counts,
            topFindings: r.findings.slice(0, 5).map(f => ({ ruleId: f.ruleId, rule: f.rule, severity: f.severity, message: f.message, taskIds: f.taskIds })),
          };
        } catch (reviewErr: any) {
          logger.warn('Schedule review after import failed', { scheduleId, error: reviewErr?.message });
        }
      }

      return {
        succeeded: succeeded.length,
        failed,
        skipped,
        warnings,
        total: records.length,
        resourcesCreated,
        dependenciesCreated,
        baselineCreated,
        durationNote,
        review,
      };
    } catch (error: any) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('CSV import error', { error });
      return reply.status(500).send({ error: 'Failed to import CSV' });
    }
  });

  // POST /suggest-columns — AI-assisted column mapping suggestions
  const suggestColumnsSchema = z.object({
    headers: z.array(z.string()).min(1).max(100),
    unmappedHeaders: z.array(z.string()).min(1).max(100),
    targetFields: z.array(z.string()).min(1).max(20),
  });

  fastify.post('/suggest-columns', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!config.AI_ENABLED || !claudeService.isAvailable()) {
        return { suggestions: {} };
      }

      const body = suggestColumnsSchema.parse(request.body);

      const systemPrompt = `You are a project management data integration expert. Given a list of spreadsheet column headers and a list of target field names, suggest which target field each unmapped header should map to.

Target fields available: ${body.targetFields.join(', ')}

Rules:
1. Only suggest mappings you are confident about.
2. Each target field can only be used once.
3. Return a JSON object where keys are the unmapped header names and values are the suggested target field names.
4. If a header doesn't clearly map to any target field, omit it from the result.
5. Consider common abbreviations, synonyms, and domain variations (e.g., "S Date" → "startDate", "Resp." → "assignedTo").`;

      const userMessage = `All column headers in the spreadsheet: ${body.headers.join(', ')}

Unmapped headers that need suggestions: ${body.unmappedHeaders.join(', ')}

Return a JSON object mapping unmapped headers to target fields.`;

      const result = await claudeService.complete({
        systemPrompt,
        userMessage,
        responseFormat: 'json',
        maxTokens: 512,
        temperature: 0.1,
        userId: request.user!.userId,
      });

      let suggestions: Record<string, string> = {};
      try {
        const cleaned = result.content.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
        const parsed = JSON.parse(cleaned);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          // Validate that values are valid target fields
          for (const [key, val] of Object.entries(parsed)) {
            if (typeof val === 'string' && body.targetFields.includes(val)) {
              suggestions[key] = val;
            }
          }
        }
      } catch {
        // AI returned invalid JSON — return empty suggestions
        logger.warn('AI suggest-columns returned invalid JSON');
      }

      return { suggestions };
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.issues });
      }
      // Graceful fallback — don't fail the import flow because AI is down
      logger.warn('suggest-columns error', { error: error.message });
      return { suggestions: {} };
    }
  });

  // POST /:scheduleId/import-structured — import tasks from structured JSON (used by MSPDI parser)
  const structuredTaskSchema = z.object({
    name: z.string().min(1),
    uid: z.number().optional(), // real MS Project UID, used to resolve predecessors
    wbs: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    duration: z.number().optional(),
    predecessors: z.string().optional(), // "3FS+2d,5SS"
    isMilestone: z.boolean().optional(),
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
      // Predecessor refs may point at a task's real MS Project UID, its WBS code,
      // or its name — build a lookup for each. Falls back to 1-based position when
      // no UID is supplied.
      const byRef = new Map<string, string>();   // uid / row number → taskId
      const byWbs = new Map<string, string>();    // wbs code → taskId
      const nameToTaskId = new Map<string, string>();
      const levelStack: { level: number; taskId: string }[] = [];

      const alreadyImportedStructured = await refuseIfAlreadyImported(scheduleId, reply);
      if (alreadyImportedStructured) return alreadyImportedStructured;

      const existingTasks = await scheduleService.findTasksByScheduleId(scheduleId);
      for (const t of existingTasks) nameToTaskId.set(t.name.toLowerCase().trim(), t.id);

      const succeeded: number[] = [];
      const failed: { row: number; error: string }[] = [];
      const warnings: string[] = [];

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

          const isMilestone = t.isMilestone === true || t.duration === 0;

          const task = await scheduleService.createTask({
            scheduleId,
            name: t.name.trim(),
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            estimatedDays: t.duration || undefined,
            progressPercentage: t.percentComplete || 0,
            isMilestone: isMilestone || undefined,
            parentTaskId,
            createdBy: userId,
          });

          // Key by the real UID when present, else by 1-based position.
          byRef.set(String(t.uid ?? i + 1), task.id);
          if (t.wbs) byWbs.set(t.wbs.trim(), task.id);
          nameToTaskId.set(t.name.trim().toLowerCase(), task.id);
          levelStack.push({ level, taskId: task.id });
          succeeded.push(i + 1);
        } catch (rowErr: any) {
          failed.push({ row: i + 1, error: rowErr.message || 'Unknown error' });
        }
      }

      // Second pass: resolve predecessors (uid, WBS, or name) into dependencies
      let depsCreated = 0;
      const predLookups: PredecessorLookups = { byRef, byWbs, byName: nameToTaskId };
      for (let i = 0; i < body.tasks.length; i++) {
        const t = body.tasks[i];
        if (!t.predecessors) continue;

        const taskId = byRef.get(String(t.uid ?? i + 1));
        if (!taskId) continue;

        const tokens = parsePredecessorTokens(t.predecessors);
        if (tokens.length > MAX_PREDECESSORS_PER_ROW) {
          warnings.push(`Task "${t.name}" lists ${tokens.length} predecessors; only the first ${MAX_PREDECESSORS_PER_ROW} were applied.`);
        }
        for (const tok of tokens.slice(0, MAX_PREDECESSORS_PER_ROW)) {
          const res = resolvePredecessor(tok, predLookups);
          if (!res) {
            warnings.push(`Task "${t.name}": could not resolve predecessor "${tok.raw}".`);
            continue;
          }
          if (res.taskId === taskId) continue; // ignore self-reference
          try {
            await scheduleService.addDependency(taskId, res.taskId, res.type, res.lagDays);
            depsCreated++;
          } catch {
            warnings.push(`Task "${t.name}": predecessor "${tok.raw}" was rejected (cycle or duplicate).`);
          }
        }
      }

      let review: { score: number; band: string; counts: Record<string, number>; topFindings: Array<{ ruleId: string; rule: string; severity: string; message: string; taskIds: string[] }> } | null = null;
      if (succeeded.length > 0) {
        try {
          const r = await scheduleReviewService.run(scheduleId, 'import', userId);
          review = {
            score: r.score,
            band: r.band,
            counts: r.counts,
            topFindings: r.findings.slice(0, 5).map(f => ({ ruleId: f.ruleId, rule: f.rule, severity: f.severity, message: f.message, taskIds: f.taskIds })),
          };
        } catch (reviewErr: any) {
          logger.warn('Schedule review after structured import failed', { scheduleId, error: reviewErr?.message });
        }
      }

      return {
        succeeded: succeeded.length,
        failed,
        warnings,
        total: body.tasks.length,
        dependenciesCreated: depsCreated,
        review,
      };
    } catch (error: any) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Structured import error', { error });
      return reply.status(500).send({ error: 'Failed to import tasks' });
    }
  });

  // POST /:scheduleId/import-document — extract tasks from an unstructured document via AI
  fastify.post('/:scheduleId/import-document', {
    preHandler: [requireScope('write'), requireFeature('ai_assistant')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId } = request.params as { scheduleId: string };
      const schedule = await scheduleService.findById(scheduleId);
      if (!schedule) return reply.status(404).send({ error: 'Schedule not found' });

      if (!config.AI_ENABLED) {
        return reply.status(400).send({ error: 'AI features are not enabled on this server.' });
      }

      const file = await request.file();
      if (!file) return reply.status(400).send({ error: 'No file uploaded' });

      const ext = file.filename.toLowerCase().split('.').pop();
      const allowedExts = ['pdf', 'docx', 'doc', 'txt'];
      if (!ext || !allowedExts.includes(ext)) {
        return reply.status(400).send({ error: `Unsupported file type ".${ext}". Accepted: .pdf, .docx, .txt` });
      }

      const buffer = await file.toBuffer();
      const MAX_DOC_SIZE = 5 * 1024 * 1024; // 5MB
      if (buffer.length > MAX_DOC_SIZE) {
        return reply.status(400).send({ error: 'File too large. Maximum size is 5MB.' });
      }

      // Extract text from document
      let text = '';
      try {
        if (ext === 'pdf') {
          // pdf-parse v1 exports the function directly
          const pdfParse = require('pdf-parse');
          const pdfData = await pdfParse(buffer);
          text = pdfData.text;
        } else if (ext === 'docx' || ext === 'doc') {
          const mammoth = await import('mammoth');
          const result = await mammoth.extractRawText({ buffer });
          text = result.value;
        } else {
          text = buffer.toString('utf-8');
        }
      } catch (parseErr: any) {
        logger.error('Document text extraction failed', { error: parseErr.message, filename: file.filename });
        return reply.status(400).send({ error: `Failed to read document: ${parseErr.message}` });
      }

      if (!text || text.trim().length < 20) {
        return reply.status(400).send({ error: 'Document appears empty or contains too little text to extract tasks.' });
      }

      // Truncate to ~30K chars to stay within AI token limits
      const truncated = text.slice(0, 30000);

      const systemPrompt = `You are a project management expert. Extract project tasks from the given document and return them as a JSON array.

Each task object must have these fields:
- "name": string (task name, concise)
- "wbs": string (work breakdown structure code like "1", "1.1", "1.2", "2", "2.1")
- "startDate": string or null (YYYY-MM-DD format if mentioned)
- "endDate": string or null (YYYY-MM-DD format if mentioned)
- "duration": number or null (estimated duration in working days)
- "isSummary": boolean (true for phase/group headers that contain sub-tasks)
- "predecessors": string or null (comma-separated predecessor WBS codes if dependencies are clear)

Rules:
1. Organize tasks hierarchically using WBS codes. Top-level phases get "1", "2", etc. Sub-tasks get "1.1", "1.2", etc.
2. Mark phase/group headers as isSummary: true.
3. If dates are not explicitly mentioned, set them to null. Do NOT invent dates.
4. If duration is mentioned (e.g., "2 weeks", "3 days"), convert to working days (1 week = 5 days).
5. Extract ALL tasks mentioned in the document. Do not skip any.
6. Keep task names concise but descriptive.
7. Return ONLY the JSON array, no other text. Do not wrap in markdown code blocks.`;

      const userMessage = `Extract all project tasks from this document:\n\n${truncated}`;

      const result = await claudeService.complete({
        systemPrompt,
        userMessage,
        responseFormat: 'json',
        maxTokens: 4096,
        temperature: 0.1,
        userId: request.user!.userId,
      });

      // Parse AI response
      let tasks: any[];
      try {
        const cleaned = result.content.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
        tasks = JSON.parse(cleaned);
        if (!Array.isArray(tasks)) throw new Error('Expected JSON array');
      } catch (jsonErr: any) {
        logger.error('AI returned invalid JSON for document import', { content: result.content.slice(0, 500) });
        return reply.status(422).send({ error: 'AI could not extract structured tasks from this document. Try a document with clearer task listings.' });
      }

      // Validate and normalize each task
      const normalized = tasks.map((t: any, i: number) => ({
        name: String(t.name || `Task ${i + 1}`).slice(0, 200),
        wbs: String(t.wbs || `${i + 1}`),
        startDate: t.startDate || null,
        endDate: t.endDate || null,
        duration: typeof t.duration === 'number' ? t.duration : null,
        isSummary: Boolean(t.isSummary),
        predecessors: t.predecessors || null,
      }));

      return {
        tasks: normalized,
        documentName: file.filename,
        textLength: text.length,
        tokensUsed: result.usage.inputTokens + result.usage.outputTokens,
      };
    } catch (error: any) {
      if (error.constructor?.name === 'AIBudgetExceededError') {
        return reply.status(429).send({ error: 'AI token budget exceeded. Please try again next month or purchase a top-up.' });
      }
      if (error.constructor?.name === 'AICircuitBreakerError') {
        return reply.status(503).send({ error: 'AI service temporarily unavailable. Please try again in a moment.' });
      }
      logger.error('Document import error', { error });
      return reply.status(500).send({ error: 'Failed to extract tasks from document' });
    }
  });
}
