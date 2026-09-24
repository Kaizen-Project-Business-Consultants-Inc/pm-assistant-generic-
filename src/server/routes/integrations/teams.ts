import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { teamsAdapter } from '../../services/integrations/TeamsAdapter';
import { integrationRepository, parseConfig } from '../../database/IntegrationRepository';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { config } from '../../config';
import logger from '../../utils/logger';

export async function teamsRoutes(fastify: FastifyInstance) {
  // GET /install — returns OAuth URL for Microsoft Teams install
  fastify.get('/install', {
    preHandler: [authMiddleware, requireScope('write')],
    schema: { description: 'Get Microsoft Teams OAuth install URL', tags: ['teams'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!config.MICROSOFT_CLIENT_ID) {
        return reply.status(501).send({
          error: 'Microsoft Teams not configured',
          message: 'Microsoft Teams is not set up on this site yet. Contact support and we will enable it.',
        });
      }
      const state = require('crypto').randomBytes(16).toString('hex') + ':' + request.user!.userId;
      const url = teamsAdapter.buildOAuthUrl(state);
      return { url, state };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to generate install URL' });
    }
  });

  // GET /callback — OAuth callback (called by Microsoft's redirect, no auth)
  fastify.get('/callback', {
    schema: { description: 'Microsoft Teams OAuth callback', tags: ['teams'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { code, state, error } = request.query as { code?: string; state?: string; error?: string };

    if (error) {
      return reply.redirect(`${config.APP_URL}/oauth/callback?error=${encodeURIComponent(error)}&provider=msteams`);
    }
    if (!code || !state) {
      return reply.redirect(`${config.APP_URL}/oauth/callback?error=missing_params&provider=msteams`);
    }

    try {
      const userId = state.split(':')[1];
      if (!userId) throw new Error('Invalid state');

      const token = await teamsAdapter.exchangeCode(code);
      const integConfig: Record<string, any> = {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: Date.now() + token.expires_in * 1000,
      };

      await integrationRepository.create(userId, 'msteams', integConfig);
      return reply.redirect(`${config.APP_URL}/oauth/callback?success=true&provider=msteams`);
    } catch (err: any) {
      logger.error('Teams OAuth callback failed', { error: err.message });
      return reply.redirect(`${config.APP_URL}/oauth/callback?error=${encodeURIComponent(err.message)}&provider=msteams`);
    }
  });

  // GET /teams — list Microsoft Teams the connected account has joined
  fastify.get('/teams', {
    preHandler: [authMiddleware, requireScope('read')],
    schema: { description: 'List joined Microsoft Teams', tags: ['teams'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { integrationId } = request.query as { integrationId?: string };
      const row = integrationId ? await integrationRepository.findRawById(integrationId) : null;
      if (!row || row.user_id !== request.user!.userId || row.provider !== 'msteams') {
        return reply.status(404).send({ error: 'Not found', message: 'Microsoft Teams connection not found' });
      }
      const cfg = parseConfig(row.config);
      const accessToken = await teamsAdapter.ensureFreshToken(row.id, cfg);
      if (!accessToken) {
        return reply.status(400).send({ error: 'Expired', message: 'Microsoft Teams no longer accepts this connection. Disconnect and connect again.' });
      }
      const joinedTeams = await teamsAdapter.listTeams(accessToken);
      return { teams: joinedTeams };
    } catch (error: any) {
      logger.error('List Microsoft Teams error', { error: error.message });
      return reply.status(502).send({ error: 'Microsoft Teams unavailable', message: `Microsoft Teams did not return your teams: ${error.message}` });
    }
  });

  // GET /channels — list channels for a chosen team
  fastify.get('/channels', {
    preHandler: [authMiddleware, requireScope('read')],
    schema: { description: 'List channels for a Microsoft Team', tags: ['teams'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { integrationId, teamId } = request.query as { integrationId?: string; teamId?: string };
      if (!teamId) {
        return reply.status(400).send({ error: 'Missing teamId', message: 'Choose a team first.' });
      }
      const row = integrationId ? await integrationRepository.findRawById(integrationId) : null;
      if (!row || row.user_id !== request.user!.userId || row.provider !== 'msteams') {
        return reply.status(404).send({ error: 'Not found', message: 'Microsoft Teams connection not found' });
      }
      const cfg = parseConfig(row.config);
      const accessToken = await teamsAdapter.ensureFreshToken(row.id, cfg);
      if (!accessToken) {
        return reply.status(400).send({ error: 'Expired', message: 'Microsoft Teams no longer accepts this connection. Disconnect and connect again.' });
      }
      const channels = await teamsAdapter.listChannels(accessToken, teamId);
      return { channels };
    } catch (error: any) {
      logger.error('List Teams channels error', { error: error.message });
      return reply.status(502).send({ error: 'Microsoft Teams unavailable', message: `Microsoft Teams did not return your channels: ${error.message}` });
    }
  });
}
