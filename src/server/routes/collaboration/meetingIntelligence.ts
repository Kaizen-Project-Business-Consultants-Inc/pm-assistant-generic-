import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireProjectAccess, projectsOfSchedules, checkProjectRole } from '../../middleware/requireProjectAccess';
import { z } from 'zod';
import { meetingIntelligenceService } from '../../services/MeetingIntelligenceService';
import { riskService } from '../../services/RiskService';
import {
  AnalyzeRequestSchema,
  ApplyRequestSchema,
} from '../../schemas/meetingSchemas';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireFeature } from '../../middleware/requireTier';
import { projectMemberService } from '../../services/ProjectMemberService';
import { fileAttachmentService } from '../../services/FileAttachmentService';
import { meetingRepository } from '../../database/MeetingRepository';
import { parseTranscriptFile } from '../../utils/transcriptParser';

/**
 * Meeting intelligence (Sep 2026 rules): analysing a transcript for a project, applying the
 * analysis to the plan, and sending items to RAID are changes to that project — its
 * Manager/Owner only. The schedule must belong to the project.
 */
const analyzePM = requireProjectAccess('manager', {
  resolve: async (req) => {
    const b = req.body as { projectId?: string; scheduleId?: string } | undefined;
    const sched = await projectsOfSchedules([b?.scheduleId]);
    return b?.projectId && sched && sched[0] === b.projectId ? b.projectId : null;
  },
});
const analysisProject = async (req: FastifyRequest) =>
  (await meetingIntelligenceService.getAnalysis((req.params as { analysisId: string }).analysisId))?.projectId ?? null;
const analysisPM = requireProjectAccess('manager', { resolve: analysisProject });
const analysisMember = requireProjectAccess('viewer', { resolve: analysisProject });
/** Sending to RAID: the analysis's project, and the body must name the same project */
const sendToRaidPM = requireProjectAccess('manager', {
  resolve: async (req) => {
    const project = await analysisProject(req);
    const bodyProject = (req.body as any)?.projectId;
    return project && (!bodyProject || bodyProject === project) ? project : null;
  },
});

export async function meetingIntelligenceRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // ---------------------------------------------------------------------------
  // POST /analyze — Analyze a meeting transcript
  // ---------------------------------------------------------------------------

  fastify.post('/analyze', {
    preHandler: [requireScope('write'), analyzePM],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;

      const parsed = AnalyzeRequestSchema.parse(request.body);

      const analysis = await meetingIntelligenceService.analyzeTranscript(
        parsed.transcript,
        parsed.projectId,
        parsed.scheduleId,
        userId,
        parsed.meetingId,
      );

      return reply.send({ data: analysis });
    } catch (err) {
      if (err instanceof Error && err.name === 'ZodError') {
        return reply.status(400).send({ error: 'Invalid request data', details: err });
      }
      fastify.log.error({ err }, 'Meeting transcript analysis failed');
      return reply.status(500).send({ error: 'Failed to analyze meeting transcript' });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /:analysisId/apply — Apply selected task changes from an analysis
  // ---------------------------------------------------------------------------

  fastify.post('/:analysisId/apply', {
    preHandler: [requireScope('write'), requireFeature('meeting_intelligence'), analysisPM],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { analysisId } = request.params as { analysisId: string };
      const parsed = ApplyRequestSchema.parse(request.body);
      const userId = request.user!.userId;

      const result = await meetingIntelligenceService.applyChanges(
        analysisId,
        parsed.selectedItems,
        userId,
      );

      return reply.send({ data: result });
    } catch (err) {
      if (err instanceof Error && err.name === 'ZodError') {
        return reply.status(400).send({ error: 'Invalid request data', details: err });
      }
      fastify.log.error({ err }, 'Failed to apply meeting changes');
      return reply.status(500).send({ error: 'Failed to apply meeting changes' });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /upload-transcript — Upload a transcript file for AI analysis
  // ---------------------------------------------------------------------------

  fastify.post('/upload-transcript', {
    preHandler: [requireScope('write')], // project check is in the handler (checkProjectRole) — multipart
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;

      // A JSON (or empty) body makes request.file() throw "the request is not multipart"
      if (!request.isMultipart()) {
        return reply.status(400).send({ error: 'No file uploaded', message: 'Choose a transcript file to upload (.txt, .vtt or .srt).' });
      }
      const file = await request.file();
      if (!file) return reply.status(400).send({ error: 'No file uploaded', message: 'Choose a transcript file to upload (.txt, .vtt or .srt).' });

      // Validate extension
      const ext = file.filename.toLowerCase().split('.').pop();
      if (!ext || !['txt', 'vtt', 'srt'].includes(ext)) {
        return reply.status(400).send({ error: 'Unsupported file type. Accepted: .txt, .vtt, .srt' });
      }

      const buffer = await file.toBuffer();

      // 2MB limit for transcript files
      if (buffer.length > 2 * 1024 * 1024) {
        return reply.status(400).send({ error: 'File too large. Maximum size is 2MB.' });
      }

      const content = buffer.toString('utf-8');

      // Extract fields from multipart
      const fields = file.fields as Record<string, any>;
      const projectId = fields.projectId?.value as string;
      const scheduleId = fields.scheduleId?.value as string;
      const meetingId = fields.meetingId?.value as string | undefined;

      if (!projectId || !scheduleId) {
        return reply.status(400).send({ error: 'projectId and scheduleId are required' });
      }
      // Only the project's Manager/Owner, and the schedule must be that project's
      const scheduleProjects = await projectsOfSchedules([scheduleId]);
      if (!scheduleProjects || scheduleProjects[0] !== projectId) {
        return reply.status(400).send({ error: 'mismatch', message: "That schedule isn't in this project." });
      }
      const access = await checkProjectRole(request, projectId, 'manager');
      if (!access.ok) return reply.status(access.status).send(access.body);

      // Parse transcript
      const { format, segments, transcript } = parseTranscriptFile(file.filename, content);

      // Store original file if linked to a meeting
      if (meetingId) {
        fileAttachmentService.upload(
          'meeting', meetingId, userId,
          file.filename, file.mimetype || 'text/plain', buffer,
        ).catch(() => {}); // fire-and-forget
      }

      // Feed into existing AI pipeline
      const analysis = await meetingIntelligenceService.analyzeTranscript(
        transcript,
        projectId,
        scheduleId,
        userId,
        meetingId,
      );

      return reply.send({
        data: analysis,
        segments: segments.length,
        format,
      });
    } catch (err) {
      fastify.log.error({ err }, 'Transcript upload and analysis failed');
      return reply.status(500).send({ error: 'Failed to process transcript file' });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /project/:projectId/history — List analyses for a project
  // ---------------------------------------------------------------------------

  fastify.get('/project/:projectId/history', {
    preHandler: [requireScope('read'), requireFeature('meeting_intelligence'), requireProjectAccess('viewer')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const analyses = await meetingIntelligenceService.getProjectHistory(projectId);
      return reply.send({ data: analyses });
    } catch (err) {
      fastify.log.error({ err }, 'Failed to fetch meeting analysis history');
      return reply.status(500).send({ error: 'Failed to fetch meeting analysis history' });
    }
  });
  // ---------------------------------------------------------------------------
  // POST /:analysisId/check-raid-duplicates — Check for duplicate RAID items
  // ---------------------------------------------------------------------------

  const checkDuplicatesSchema = z.object({
    projectId: z.string(),
    titles: z.array(z.string()),
  });

  fastify.post('/:analysisId/check-raid-duplicates', {
    preHandler: [requireScope('read'), requireFeature('meeting_intelligence'), analysisMember],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { analysisId } = request.params as { analysisId: string };
      const parsed = checkDuplicatesSchema.parse(request.body);

      const analysis = await meetingIntelligenceService.getAnalysis(analysisId);
      if (!analysis) {
        return reply.status(404).send({ error: 'Analysis not found' });
      }

      const candidates = parsed.titles.map(t => ({ title: t }));
      const duplicates = await riskService.checkDuplicates(parsed.projectId, candidates);

      // Convert Map to plain object for JSON
      const result: Record<string, { existingId: string; currentSeverity: string; currentStatus: string }> = {};
      for (const [key, val] of duplicates) {
        result[key] = val;
      }

      return reply.send({ data: result });
    } catch (err) {
      if (err instanceof Error && err.name === 'ZodError') {
        return reply.status(400).send({ error: 'Invalid request data', details: err });
      }
      fastify.log.error({ err }, 'Failed to check RAID duplicates');
      return reply.status(500).send({ error: 'Failed to check RAID duplicates' });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /:analysisId/send-to-raid — Import meeting analysis items into RAID log
  // ---------------------------------------------------------------------------

  const sendToRaidItemSchema = z.object({
    type: z.enum(['risk', 'issue', 'action', 'decision']),
    title: z.string().min(1).max(255),
    description: z.string().max(5000).optional(),
    category: z.string().optional(),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    probability: z.number().int().min(1).max(5).optional(),
    impact: z.number().int().min(1).max(5).optional(),
    mitigationPlan: z.string().max(5000).optional(),
    dueDate: z.string().optional(),
    rationale: z.string().max(5000).optional(),
    decidedBy: z.string().optional(),
    actionType: z.enum(['preventive', 'corrective', 'improvement']).optional(),
    impactAssessment: z.string().max(5000).optional(),
    /** Meeting Coach: the owner the meeting named — a project member, or just a name */
    ownerId: z.string().max(64).optional(),
    ownerName: z.string().max(255).optional(),
  });

  const sendToRaidSchema = z.object({
    projectId: z.string(),
    items: z.array(sendToRaidItemSchema).min(1).max(100),
  });

  fastify.post('/:analysisId/send-to-raid', {
    preHandler: [requireScope('write'), requireFeature('meeting_intelligence'), sendToRaidPM],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { analysisId } = request.params as { analysisId: string };
      const parsed = sendToRaidSchema.parse(request.body);
      const userId = request.user!.userId;

      const analysis = await meetingIntelligenceService.getAnalysis(analysisId);
      if (!analysis) {
        return reply.status(404).send({ error: 'Analysis not found' });
      }

      // Which meeting these came from, so a meeting action can be traced in the RAID log:
      // the linked meeting's title, else the analysis date
      const linkedMeeting = analysis.meetingId ? await meetingRepository.findById(analysis.meetingId).catch(() => null) : null;
      const sourceMeeting = (linkedMeeting?.title || `Meeting analysis ${String(analysis.createdAt ?? '').slice(0, 10)}`.trim()).slice(0, 255);

      const imported: any[] = [];
      // An owner must be on this project; anyone else is kept as a name only
      const memberIds = new Set((await projectMemberService.findByProjectId(parsed.projectId)).map(m => m.userId));

      for (const item of parsed.items) {
        const ownerId = item.ownerId && memberIds.has(item.ownerId) ? item.ownerId : undefined;
        // eslint-disable-next-line no-await-in-loop -- each RAID item takes the next record number (R-001, A-002…), so creates must not overlap; at most 100
        const risk = await riskService.create({
          projectId: parsed.projectId,
          type: item.type,
          title: item.title,
          description: item.description,
          category: item.category,
          severity: item.severity,
          probability: item.probability,
          impact: item.impact,
          mitigationPlan: item.mitigationPlan,
          dueDate: item.dueDate,
          rationale: item.rationale,
          decidedBy: item.decidedBy,
          actionType: item.actionType,
          impactAssessment: item.impactAssessment,
          ownerId,
          ownerName: ownerId ? undefined : item.ownerName,
          source: 'meeting',
          sourceMeeting,
          createdBy: userId,
        });
        imported.push(risk);
      }

      return reply.send({ data: { imported: imported.length, items: imported } });
    } catch (err) {
      if (err instanceof Error && err.name === 'ZodError') {
        return reply.status(400).send({ error: 'Invalid request data', details: err });
      }
      fastify.log.error({ err }, 'Failed to send meeting items to RAID');
      return reply.status(500).send({ error: 'Failed to import meeting items to RAID log' });
    }
  });
}
