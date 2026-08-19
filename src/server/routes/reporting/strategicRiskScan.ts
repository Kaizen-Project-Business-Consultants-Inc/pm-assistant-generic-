import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requirePaidTier } from '../../middleware/requireTier';
import { strategicRiskAnalysisService } from '../../services/StrategicRiskAnalysisService';
import { renderStrategicRiskHtml } from '../../utils/strategicRiskRenderer';
import { WebSocketService } from '../../services/WebSocketService';
import { userService } from '../../services/UserService';
import { getTenantContext, runWithTenantContext } from '../../middleware/requestContext';
import logger from '../../utils/logger';
import crypto from 'crypto';

const scanSchema = z.object({
  projectId: z.string().min(1),
});

export async function strategicRiskScanRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // Run a strategic risk scan (background mode via WebSocket)
  fastify.post('/scan', {
    preHandler: [requireScope('write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const body = scanSchema.parse(request.body);

      // Trial users get a sample result synchronously
      if (request.user!.role !== 'admin') {
        const user = await userService.findById(userId);
        if (user && user.subscriptionTier === 'trial') {
          const sample = strategicRiskAnalysisService.generateSample(body.projectId);
          const html = renderStrategicRiskHtml(sample);
          return { result: { ...sample, html }, sample: true };
        }
      }

      // Return immediately with a jobId; generate in background
      const jobId = crypto.randomUUID();
      const tenantCtx = getTenantContext();

      const runScan = () => strategicRiskAnalysisService.analyze(body.projectId, userId);

      const scanPromise = tenantCtx
        ? runWithTenantContext(tenantCtx.dbName, tenantCtx.orgId, runScan)
        : runScan();

      scanPromise.then(result => {
        const html = renderStrategicRiskHtml(result);
        logger.info('Background strategic risk scan completed', { jobId, userId, projectId: body.projectId });
        WebSocketService.sendToUser(userId, {
          type: 'strategic_risk_scan_ready',
          payload: { jobId, projectId: body.projectId, result: { ...result, html } },
        });
      }).catch(error => {
        logger.error('Background strategic risk scan failed', { error: error.message, stack: error.stack, jobId });
        WebSocketService.sendToUser(userId, {
          type: 'strategic_risk_scan_failed',
          payload: { jobId, projectId: body.projectId, error: 'Failed to run strategic risk scan' },
        });
      });

      return { jobId, status: 'scanning' };
    } catch (error: any) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      logger.error('Strategic risk scan error', { error });
      return reply.status(500).send({ error: 'Failed to run strategic risk scan' });
    }
  });
}
