import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
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
import { userService } from '../../services/UserService';
import { fileAttachmentService } from '../../services/FileAttachmentService';
import { parseTranscriptFile } from '../../utils/transcriptParser';

export async function meetingIntelligenceRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // ---------------------------------------------------------------------------
  // POST /analyze — Analyze a meeting transcript
  // ---------------------------------------------------------------------------

  // Trial users get sample analysis data with an upgrade prompt.
  fastify.post('/analyze', {
    preHandler: [requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;

      // Trial users get sample meeting analysis (before schema validation)
      if (request.user!.role !== 'admin') {
        const user = await userService.findById(userId);
        if (user && user.subscriptionTier === 'trial') {
          return reply.send({ data: generateSampleMeetingAnalysis(), sample: true });
        }
      }

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
    preHandler: [requireScope('write'), requireFeature('meeting_intelligence')],
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
    preHandler: [requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;

      // Trial users get sample analysis data
      if (request.user!.role !== 'admin') {
        const user = await userService.findById(userId);
        if (user && user.subscriptionTier === 'trial') {
          return reply.send({ data: generateSampleMeetingAnalysis(), sample: true, segments: 0, format: 'sample' });
        }
      }

      const file = await request.file();
      if (!file) return reply.status(400).send({ error: 'No file uploaded' });

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
    preHandler: [requireScope('read'), requireFeature('meeting_intelligence')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const analyses = meetingIntelligenceService.getProjectHistory(projectId);
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
    preHandler: [requireScope('read'), requireFeature('meeting_intelligence')],
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
  });

  const sendToRaidSchema = z.object({
    projectId: z.string(),
    items: z.array(sendToRaidItemSchema).min(1).max(100),
  });

  fastify.post('/:analysisId/send-to-raid', {
    preHandler: [requireScope('write'), requireFeature('meeting_intelligence')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { analysisId } = request.params as { analysisId: string };
      const parsed = sendToRaidSchema.parse(request.body);
      const userId = request.user!.userId;

      const analysis = await meetingIntelligenceService.getAnalysis(analysisId);
      if (!analysis) {
        return reply.status(404).send({ error: 'Analysis not found' });
      }

      const imported: any[] = [];

      for (const item of parsed.items) {
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
          source: 'meeting',
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

function generateSampleMeetingAnalysis() {
  return {
    id: 'sample-analysis',
    summary: 'Sprint review discussed progress on frontend redesign, identified two blockers, and decided to extend the testing phase by one week.',
    actionItems: [
      { description: 'Update wireframes based on stakeholder feedback', assignee: 'Jane Smith', dueDate: 'Next Friday', priority: 'high' },
      { description: 'Resolve API integration blocker with payments team', assignee: 'John Doe', dueDate: 'End of week', priority: 'critical' },
      { description: 'Schedule user testing sessions for next sprint', assignee: 'Sarah Kim', dueDate: 'Next Monday', priority: 'medium' },
    ],
    decisions: [
      { decision: 'Extend testing phase by one week to accommodate additional QA scenarios', rationale: 'Additional QA scenarios needed for payment integration', madeBy: 'Project Manager' },
      { decision: 'Use React instead of Vue for the new dashboard component', rationale: 'Team has more React experience and existing components are React-based', madeBy: 'Tech Lead' },
    ],
    risks: [
      { description: 'Payment integration delay may impact release timeline', severity: 'high', mitigation: 'Escalate to payments team lead' },
    ],
    taskUpdates: [
      { taskName: 'Frontend Redesign', status: 'in_progress', progress: 75, notes: 'On track for completion next week' },
      { taskName: 'API Integration', status: 'blocked', progress: 40, notes: 'Waiting on payments team response' },
    ],
    createdAt: new Date().toISOString(),
  };
}
