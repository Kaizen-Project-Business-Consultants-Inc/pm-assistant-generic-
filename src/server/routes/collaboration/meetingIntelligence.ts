import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { meetingIntelligenceService } from '../../services/MeetingIntelligenceService';
import {
  AnalyzeRequestSchema,
  ApplyRequestSchema,
} from '../../schemas/meetingSchemas';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireFeature } from '../../middleware/requireTier';
import { userService } from '../../services/UserService';

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
      { description: 'Extend testing phase by one week to accommodate additional QA scenarios', decidedBy: 'Project Manager' },
      { description: 'Use React instead of Vue for the new dashboard component', decidedBy: 'Tech Lead' },
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
