import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as querystring from 'querystring';
import { slackAdapter } from '../../services/integrations/SlackAdapter';
import { projectService } from '../../services/ProjectService';
import { actionProposalService } from '../../services/agents/ActionProposalService';
import { integrationRepository } from '../../database/IntegrationRepository';
import { config } from '../../config';
import logger from '../../utils/logger';

export async function slackRoutes(fastify: FastifyInstance) {
  // POST /commands — Slack slash command handler
  fastify.post('/commands', {
    config: { rawBody: true },
    schema: { description: 'Slack slash command endpoint', tags: ['slack'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const rawBody = request.rawBody;
      if (!rawBody) {
        return reply.status(400).send({ error: 'Missing raw body' });
      }

      const rawStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');

      // Verify Slack signature
      const timestamp = request.headers['x-slack-request-timestamp'] as string;
      const signature = request.headers['x-slack-signature'] as string;
      if (!slackAdapter.verifySignature(config.SLACK_SIGNING_SECRET, timestamp, rawStr, signature)) {
        return reply.status(401).send({ error: 'Invalid signature' });
      }

      const parsed = querystring.parse(rawStr);
      const text = (parsed['text'] as string || '').trim();
      const command = text.split(/\s+/);

      if (command[0] === 'status') {
        const projectName = command.slice(1).join(' ');
        if (!projectName) {
          return reply.send({
            response_type: 'ephemeral',
            text: 'Usage: `/kovarti status <project name>`',
          });
        }

        const project = await projectService.findByName(projectName);
        if (!project) {
          return reply.send({
            response_type: 'ephemeral',
            text: `Project "${projectName}" not found.`,
          });
        }

        const blocks = slackAdapter.buildStatusBlocks(project);
        return reply.send({
          response_type: 'ephemeral',
          text: `Status for ${project.name}`,
          blocks,
        });
      }

      // Default: help
      return reply.send({
        response_type: 'ephemeral',
        text: '*Kovarti PM Commands:*\n`/kovarti status <project name>` — View project status',
      });
    } catch (error: any) {
      logger.error('Slack command error', { error: error.message });
      return reply.status(200).send({ response_type: 'ephemeral', text: 'An error occurred processing your command.' });
    }
  });

  // POST /interactivity — Slack interactive component callbacks
  fastify.post('/interactivity', {
    config: { rawBody: true },
    schema: { description: 'Slack interactivity endpoint', tags: ['slack'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const rawBody = request.rawBody;
      if (!rawBody) {
        return reply.status(400).send({ error: 'Missing raw body' });
      }

      const rawStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');

      // Verify Slack signature
      const timestamp = request.headers['x-slack-request-timestamp'] as string;
      const signature = request.headers['x-slack-signature'] as string;
      if (!slackAdapter.verifySignature(config.SLACK_SIGNING_SECRET, timestamp, rawStr, signature)) {
        return reply.status(401).send({ error: 'Invalid signature' });
      }

      const parsed = querystring.parse(rawStr);
      const payloadStr = parsed['payload'] as string;
      if (!payloadStr) {
        return reply.status(400).send({ error: 'Missing payload' });
      }

      const payload = JSON.parse(payloadStr);
      const actions = payload.actions || [];
      const action = actions[0];
      if (!action) {
        return reply.send({ text: 'No action received' });
      }

      const actionId = action.action_id as string;
      const proposalId = action.value as string;
      const slackUser = payload.user?.username || payload.user?.name || 'slack-user';

      if (actionId === 'proposal_approve' || actionId === 'proposal_reject') {
        const decision = actionId === 'proposal_approve' ? 'approved' : 'rejected';

        // Find the integration owner to act as reviewer
        // Use the first active Slack integration's user_id as the acting user
        const integrations = await integrationRepository.findActiveSlackByProject(proposalId);
        let reviewerId = 'system';
        if (integrations.length > 0) {
          reviewerId = integrations[0].user_id;
        }

        const comment = `${decision === 'approved' ? 'Approved' : 'Rejected'} via Slack by @${slackUser}`;
        await actionProposalService.addReview(proposalId, reviewerId, decision, comment);

        // Return updated message
        return reply.send({
          replace_original: true,
          text: `Proposal *${decision}* by @${slackUser}`,
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: `Proposal *${decision}* by @${slackUser}` },
            },
          ],
        });
      }

      return reply.send({ text: 'Unknown action' });
    } catch (error: any) {
      logger.error('Slack interactivity error', { error: error.message });
      return reply.status(200).send({ replace_original: false, text: 'An error occurred processing your action.' });
    }
  });
}
