import { claudeService } from './claudeService';
import { scheduleService, Task } from './ScheduleService';
import { resourceService, Resource } from './ResourceService';
import { config } from '../config';
import logger from '../utils/logger';
import { sanitizeForPrompt } from '../utils/promptSanitizer';
import { meetingAnalysisRepository } from '../database/MeetingAnalysisRepository';
import { ragService } from './RagService';
import {
  MeetingAnalysis,
  MeetingAIResponse,
  MeetingAIResponseSchema,
  MeetingTaskUpdate,
} from '../schemas/meetingSchemas';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJson(val: any): any {
  if (typeof val === 'string') return JSON.parse(val);
  return val ?? [];
}

function rowToMeetingAnalysis(row: any): MeetingAnalysis {
  return {
    id: row.id,
    projectId: row.project_id,
    scheduleId: row.schedule_id,
    transcript: row.transcript,
    summary: row.summary,
    actionItems: parseJson(row.action_items),
    decisions: parseJson(row.decisions),
    risks: parseJson(row.risks),
    taskUpdates: parseJson(row.task_updates),
    appliedItems: parseJson(row.applied_items),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

// ---------------------------------------------------------------------------
// MeetingIntelligenceService
// ---------------------------------------------------------------------------

export class MeetingIntelligenceService {
  // -------------------------------------------------------------------------
  // Persist an analysis to DB and index for RAG
  // -------------------------------------------------------------------------

  private async persistAnalysis(analysis: MeetingAnalysis): Promise<void> {
    await meetingAnalysisRepository.upsert(
      analysis.id,
      analysis.projectId,
      analysis.scheduleId,
      analysis.transcript,
      analysis.summary,
      JSON.stringify(analysis.actionItems),
      JSON.stringify(analysis.decisions),
      JSON.stringify(analysis.risks),
      JSON.stringify(analysis.taskUpdates),
      JSON.stringify(analysis.appliedItems),
      analysis.createdAt,
    );

    // Fire-and-forget RAG indexing
    ragService.indexMeeting(analysis).catch((err) => {
      logger.error(`[RAG] Failed to index meeting ${analysis.id}:`, (err as Error).message);
    });
  }

  // -------------------------------------------------------------------------
  // Analyze a meeting transcript
  // -------------------------------------------------------------------------

  async analyzeTranscript(
    transcript: string,
    projectId: string,
    scheduleId: string,
    userId?: string,
    meetingId?: string,
  ): Promise<MeetingAnalysis> {
    // 1. Gather context: existing tasks
    const existingTasks = await scheduleService.findTasksByScheduleId(scheduleId);
    const schedule = await scheduleService.findById(scheduleId);

    // 2. Gather resources for assignee matching
    const resources = await resourceService.findAllResources();

    // 3. Build context strings
    const taskContext = existingTasks
      .map(
        (t) =>
          `- [${t.id}] "${t.name}" (status: ${t.status}, priority: ${t.priority}, assignee: ${t.assignedTo || 'unassigned'})`,
      )
      .join('\n');

    const resourceContext = resources
      .map((r) => `- ${r.name} (${r.role}, skills: ${r.skills.join(', ')})`)
      .join('\n');

    let aiResponse: MeetingAIResponse;

    if (config.AI_ENABLED && claudeService.isAvailable()) {
      // 4. Call Claude for analysis
      const systemPrompt = `You are an expert project management meeting analyst. Your role is to analyze meeting transcripts and extract structured, actionable information for a project management system.

You must identify:
1. A concise summary of the meeting (2-4 sentences).
2. Action items with assignees, due dates, and priorities.
3. Key decisions made during the meeting.
4. Risks or concerns raised.
5. Task updates that should be applied to the project schedule — these can be:
   - "create": A brand new task that should be added to the schedule.
   - "update_status": An existing task whose status changed (e.g., marked complete, started, etc.).
   - "reschedule": An existing task that needs new dates.

When matching task updates to existing tasks, use the existingTaskId field with the task ID from the context below. For new tasks, leave existingTaskId empty.

When assigning people, use the exact names from the resource list below when possible.

Respond in valid JSON matching the requested schema.`;

      const userMessage = `## Meeting Transcript
<user-data field="transcript">
${sanitizeForPrompt(transcript)}
</user-data>

## Existing Tasks in Schedule${schedule ? ` "${sanitizeForPrompt(schedule.name)}"` : ''}
${taskContext || '(No existing tasks)'}

## Available Team Resources
${resourceContext || '(No resources listed)'}

Analyze this meeting transcript and extract all actionable information.`;

      const result = await claudeService.completeWithJsonSchema<MeetingAIResponse>({
        systemPrompt,
        userMessage,
        schema: MeetingAIResponseSchema,
        maxTokens: 4096,
      });

      aiResponse = result.data;
    } else {
      // Fallback: return a mock analysis when AI is unavailable
      aiResponse = this.buildFallbackResponse(transcript);
    }

    // 5. Post-process: match assignee names to known resources (fuzzy)
    aiResponse.actionItems = aiResponse.actionItems.map((item) => ({
      ...item,
      assignee: this.matchAssigneeName(item.assignee, resources),
    }));

    aiResponse.taskUpdates = aiResponse.taskUpdates.map((update) => ({
      ...update,
      assignee: update.assignee
        ? this.matchAssigneeName(update.assignee, resources)
        : update.assignee,
      // Try to match existing task IDs for update/reschedule types
      existingTaskId:
        update.existingTaskId || this.findMatchingTaskId(update, existingTasks),
    }));

    // 6. Store and return
    const analysis: MeetingAnalysis = {
      id: `ma-${Math.random().toString(36).substr(2, 9)}`,
      projectId,
      scheduleId,
      transcript,
      summary: aiResponse.summary,
      actionItems: aiResponse.actionItems,
      decisions: aiResponse.decisions,
      risks: aiResponse.risks,
      taskUpdates: aiResponse.taskUpdates,
      appliedItems: [],
      createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    };

    await this.persistAnalysis(analysis);

    // Link to meeting if provided
    if (meetingId) {
      await meetingAnalysisRepository.updateMeetingId(analysis.id, meetingId).catch(err => {
        logger.error(`Failed to link analysis ${analysis.id} to meeting ${meetingId}:`, (err as Error).message);
      });
    }

    return analysis;
  }

  // -------------------------------------------------------------------------
  // Apply selected task changes from an analysis
  // -------------------------------------------------------------------------

  async applyChanges(
    analysisId: string,
    selectedIndices: number[],
    userId?: string,
  ): Promise<{ applied: number; errors: string[] }> {
    const analysis = await this.getAnalysis(analysisId);
    if (!analysis) {
      return { applied: 0, errors: [`Analysis not found: ${analysisId}`] };
    }

    let applied = 0;
    const errors: string[] = [];

    for (const index of selectedIndices) {
      if (index < 0 || index >= analysis.taskUpdates.length) {
        errors.push(`Invalid task update index: ${index}`);
        continue;
      }

      if (analysis.appliedItems.includes(index)) {
        errors.push(`Task update at index ${index} has already been applied`);
        continue;
      }

      const update = analysis.taskUpdates[index];

      try {
        switch (update.type) {
          case 'create': {
            await scheduleService.createTask({
              scheduleId: analysis.scheduleId,
              name: update.taskName,
              description: update.description,
              status: update.newStatus || 'pending',
              priority: update.priority || 'medium',
              assignedTo: update.assignee,
              startDate: update.newStartDate ? new Date(update.newStartDate) : undefined,
              endDate: update.newEndDate ? new Date(update.newEndDate) : undefined,
              createdBy: userId || 'meeting-intelligence',
            });

            await scheduleService.logActivity(
              'system',
              userId || '1',
              'Meeting Intelligence',
              'created',
              'task',
              undefined,
              update.taskName,
            );

            applied++;
            analysis.appliedItems.push(index);
            break;
          }

          case 'update_status': {
            const taskId = update.existingTaskId;
            if (!taskId) {
              errors.push(
                `Cannot update status for "${update.taskName}": no matching existing task found`,
              );
              continue;
            }

            const existingTask = await scheduleService.findTaskById(taskId);
            if (!existingTask) {
              errors.push(`Task not found: ${taskId} for "${update.taskName}"`);
              continue;
            }

            const updateData: Partial<Task> = {};
            if (update.newStatus) updateData.status = update.newStatus;
            if (update.assignee) updateData.assignedTo = update.assignee;
            if (update.priority) updateData.priority = update.priority;

            await scheduleService.updateTask(taskId, updateData);
            applied++;
            analysis.appliedItems.push(index);
            break;
          }

          case 'reschedule': {
            const rescheduleTaskId = update.existingTaskId;
            if (!rescheduleTaskId) {
              errors.push(
                `Cannot reschedule "${update.taskName}": no matching existing task found`,
              );
              continue;
            }

            const taskToReschedule =
              await scheduleService.findTaskById(rescheduleTaskId);
            if (!taskToReschedule) {
              errors.push(`Task not found: ${rescheduleTaskId} for "${update.taskName}"`);
              continue;
            }

            const rescheduleData: Partial<Task> = {};
            if (update.newStartDate)
              rescheduleData.startDate = update.newStartDate;
            if (update.newEndDate)
              rescheduleData.endDate = update.newEndDate;
            if (update.assignee) rescheduleData.assignedTo = update.assignee;

            await scheduleService.updateTask(rescheduleTaskId, rescheduleData);
            applied++;
            analysis.appliedItems.push(index);
            break;
          }

          default:
            errors.push(`Unknown update type for "${update.taskName}"`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to apply "${update.taskName}": ${message}`);
      }
    }

    // Persist updated appliedItems back to DB
    await meetingAnalysisRepository.updateAppliedItems(
      analysisId,
      JSON.stringify(analysis.appliedItems),
    );

    return { applied, errors };
  }

  // -------------------------------------------------------------------------
  // Getters (DB-backed)
  // -------------------------------------------------------------------------

  async getAnalysis(id: string): Promise<MeetingAnalysis | null> {
    const row = await meetingAnalysisRepository.findById(id);
    if (!row) return null;
    return rowToMeetingAnalysis(row);
  }

  getProjectHistory(projectId: string): Promise<MeetingAnalysis[]> {
    return this.getProjectHistoryAsync(projectId);
  }

  async getProjectHistoryAsync(projectId: string): Promise<MeetingAnalysis[]> {
    const rows = await meetingAnalysisRepository.findByProject(projectId);
    return rows.map(rowToMeetingAnalysis);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private matchAssigneeName(name: string, resources: Resource[]): string {
    if (!name) return name;

    const lower = name.toLowerCase().trim();

    const exact = resources.find(
      (r) => r.name.toLowerCase() === lower,
    );
    if (exact) return exact.name;

    const partial = resources.find(
      (r) =>
        r.name.toLowerCase().includes(lower) ||
        lower.includes(r.name.toLowerCase()),
    );
    if (partial) return partial.name;

    const byPart = resources.find((r) => {
      const parts = r.name.toLowerCase().split(/\s+/);
      return parts.some((part) => part === lower || lower.includes(part));
    });
    if (byPart) return byPart.name;

    return name;
  }

  private findMatchingTaskId(
    update: MeetingTaskUpdate,
    existingTasks: Task[],
  ): string | undefined {
    if (update.type === 'create') return undefined;

    const updateName = update.taskName.toLowerCase().trim();

    const exact = existingTasks.find(
      (t) => t.name.toLowerCase() === updateName,
    );
    if (exact) return exact.id;

    const partial = existingTasks.find(
      (t) =>
        t.name.toLowerCase().includes(updateName) ||
        updateName.includes(t.name.toLowerCase()),
    );
    if (partial) return partial.id;

    return undefined;
  }

  private buildFallbackResponse(transcript: string): MeetingAIResponse {
    return {
      summary:
        'AI analysis is currently unavailable. Please review the transcript manually and extract action items, decisions, and task updates.',
      actionItems: [],
      decisions: [],
      risks: [],
      taskUpdates: [],
    };
  }
}

export const meetingIntelligenceService = new MeetingIntelligenceService();
