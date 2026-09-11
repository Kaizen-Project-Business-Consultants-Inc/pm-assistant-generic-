import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { encryptToken, decryptToken } from '../utils/tokenEncryption';
import { storageConnectorRepository, type StorageConnector } from '../database/StorageConnectorRepository';
import { projectDocumentRepository } from '../database/ProjectDocumentRepository';
import { documentIntelligenceService } from './DocumentIntelligenceService';
import { oneDriveAdapter } from './integrations/OneDriveAdapter';
import { redisService } from './RedisService';
import { validateMimeType } from '../utils/mimeValidator';
import { getTenantContext, runWithTenantContext } from '../middleware/requestContext';
import logger from '../utils/logger';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'text/csv',
  'text/markdown',
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES_PER_SYNC = 50;
const OAUTH_STATE_TTL = 600; // 10 minutes
const TOKEN_REFRESH_BUFFER = 5 * 60 * 1000; // 5 minutes before expiry

class StorageConnectorService {
  async initiateOAuthFlow(projectId: string, userId: string): Promise<{ authUrl: string }> {
    const clientId = config.MICROSOFT_CLIENT_ID;
    if (!clientId) throw new Error('Microsoft OAuth not configured (MICROSOFT_CLIENT_ID missing)');

    // PKCE
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    // State token (anti-CSRF)
    const state = crypto.randomBytes(24).toString('hex');

    // Store in Redis with TTL (include tenant context for the unauthenticated callback)
    const tenantCtx = getTenantContext();
    await redisService.set(
      `oauth:onedrive:${state}`,
      JSON.stringify({
        projectId, userId, codeVerifier,
        tenantDbName: tenantCtx?.dbName || null,
        tenantOrgId: tenantCtx?.orgId || null,
      }),
      OAUTH_STATE_TTL,
    );

    const redirectUri = `${config.APP_URL}/api/v1/storage-connectors/onedrive/callback`;
    const scopes = 'Files.Read.All User.Read offline_access';

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: scopes,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'consent',
    });

    return { authUrl: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}` };
  }

  async handleOAuthCallback(state: string, code: string): Promise<StorageConnector> {
    // Validate state
    const raw = await redisService.get(`oauth:onedrive:${state}`);
    if (!raw) throw new Error('Invalid or expired OAuth state');

    const { projectId, userId, codeVerifier, tenantDbName, tenantOrgId } = JSON.parse(raw);

    // Delete state (single-use)
    await redisService.del(`oauth:onedrive:${state}`);

    const redirectUri = `${config.APP_URL}/api/v1/storage-connectors/onedrive/callback`;

    // Exchange code for tokens (no tenant context needed — external API call)
    const tokens = await oneDriveAdapter.exchangeCodeForTokens(
      code, redirectUri,
      config.MICROSOFT_CLIENT_ID, config.MICROSOFT_CLIENT_SECRET,
      codeVerifier,
    );

    // Test connection to get user info for display name
    const user = await oneDriveAdapter.testConnection(tokens.access_token);

    // Encrypt tokens
    const accessTokenEnc = encryptToken(tokens.access_token);
    const refreshTokenEnc = encryptToken(tokens.refresh_token);
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Create connector record — needs tenant context for DB write
    const createConnector = async () => storageConnectorRepository.create({
      projectId,
      provider: 'onedrive',
      displayName: `OneDrive - ${user.displayName}`,
      accessTokenEnc,
      refreshTokenEnc,
      tokenExpiresAt,
      createdBy: userId,
      config: { email: user.mail, syncFolders: [] },
    });

    let connector: StorageConnector;
    if (tenantDbName && tenantOrgId) {
      connector = await runWithTenantContext(tenantDbName, tenantOrgId, createConnector);
    } else {
      connector = await createConnector();
    }

    logger.info('OneDrive connector created', { connectorId: connector.id, projectId, user: user.mail });
    return connector;
  }

  async refreshTokenIfNeeded(connector: StorageConnector): Promise<string> {
    if (!connector.accessTokenEnc || !connector.refreshTokenEnc) {
      throw new Error('Connector has no tokens');
    }

    // Check if token still valid
    if (connector.tokenExpiresAt) {
      const expiresAt = new Date(connector.tokenExpiresAt).getTime();
      if (expiresAt > Date.now() + TOKEN_REFRESH_BUFFER) {
        return decryptToken(connector.accessTokenEnc);
      }
    }

    // Refresh
    const refreshToken = decryptToken(connector.refreshTokenEnc);
    const tokens = await oneDriveAdapter.refreshAccessToken(
      refreshToken,
      config.MICROSOFT_CLIENT_ID,
      config.MICROSOFT_CLIENT_SECRET,
    );

    const accessTokenEnc = encryptToken(tokens.access_token);
    const refreshTokenEnc = encryptToken(tokens.refresh_token);
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    await storageConnectorRepository.updateTokens(connector.id, {
      accessTokenEnc,
      refreshTokenEnc,
      tokenExpiresAt,
    });

    logger.debug('OneDrive token refreshed', { connectorId: connector.id });
    return tokens.access_token;
  }

  async listFolder(connectorId: string, folderId?: string): Promise<any[]> {
    const connector = await storageConnectorRepository.findById(connectorId);
    if (!connector) throw new Error('Connector not found');

    const accessToken = await this.refreshTokenIfNeeded(connector);
    const items = await oneDriveAdapter.listFolder(accessToken, folderId);

    return items.map(item => ({
      id: item.id,
      name: item.name,
      isFolder: !!item.folder,
      childCount: item.folder?.childCount || 0,
      size: item.size || 0,
      mimeType: item.file?.mimeType || null,
    }));
  }

  async updateSyncFolders(connectorId: string, folderIds: string[]): Promise<void> {
    const connector = await storageConnectorRepository.findById(connectorId);
    if (!connector) throw new Error('Connector not found');

    const cfg = connector.config || {};
    cfg.syncFolders = folderIds;
    await storageConnectorRepository.updateConfig(connectorId, cfg);

    // Reset delta token so next sync does a full pass with new folder filter
    await storageConnectorRepository.updateDelta(connectorId, null);
  }

  async syncConnector(connectorId: string): Promise<{ synced: number; deleted: number; skipped: number }> {
    const connector = await storageConnectorRepository.findById(connectorId);
    if (!connector) throw new Error('Connector not found');
    if (connector.status === 'disconnected') throw new Error('Connector is disconnected');

    let accessToken: string;
    try {
      accessToken = await this.refreshTokenIfNeeded(connector);
    } catch (err) {
      await storageConnectorRepository.updateStatus(connectorId, 'error', 'Token refresh failed');
      throw err;
    }

    const syncFolders: string[] = (connector.config as any)?.syncFolders || [];

    try {
      const delta = await oneDriveAdapter.getDelta(accessToken, connector.deltaToken || undefined);
      let synced = 0;
      let deleted = 0;
      let skipped = 0;

      for (const item of delta.value) {
        if (synced + deleted >= MAX_FILES_PER_SYNC) {
          skipped++;
          continue;
        }

        // Handle deletions
        if (item.deleted) {
          const existing = await projectDocumentRepository.findByExternalId(connectorId, item.id);
          if (existing) {
            // Delete file from disk
            try {
              const filePath = documentIntelligenceService.getFilePath(connector.projectId, existing.filename);
              await fs.unlink(filePath);
            } catch { /* file may already be gone */ }
            documentIntelligenceService.deleteDocumentEmbeddings(existing.id).catch(() => {});
            await projectDocumentRepository.delete(existing.id);
            deleted++;
          }
          continue;
        }

        // Skip folders
        if (item.folder) continue;

        // Filter to synced folders (if configured)
        if (syncFolders.length > 0 && item.parentReference?.id) {
          const parentId = item.parentReference.id;
          if (!syncFolders.includes(parentId)) continue;
        }

        // Skip unsupported types
        const mimeType = item.file?.mimeType;
        if (!mimeType || !ALLOWED_MIME_TYPES.includes(mimeType)) {
          skipped++;
          continue;
        }

        // Skip too large
        if (item.size && item.size > MAX_FILE_SIZE) {
          skipped++;
          continue;
        }

        // Check if already synced with same etag
        const existing = await projectDocumentRepository.findByExternalId(connectorId, item.id);
        if (existing && existing.externalEtag === item.eTag) {
          continue; // unchanged
        }

        // Download file
        const buffer = await oneDriveAdapter.downloadFile(accessToken, item.id);

        // Validate MIME
        const mimeCheck = validateMimeType(mimeType, buffer);
        if (!mimeCheck.valid) {
          skipped++;
          continue;
        }

        // Save to disk
        const ext = path.extname(item.name) || '';
        const docFilename = `${uuidv4()}${ext}`;
        const uploadDir = path.join(config.UPLOAD_DIR, 'documents', connector.projectId);
        await fs.mkdir(uploadDir, { recursive: true });
        const filePath = path.join(uploadDir, docFilename);
        await fs.writeFile(filePath, buffer);

        // Upsert document record
        const externalPath = item.parentReference?.path
          ? `${item.parentReference.path}/${item.name}`
          : item.name;

        const doc = await projectDocumentRepository.upsertFromConnector({
          existingId: existing?.id,
          projectId: connector.projectId,
          connectorId,
          externalId: item.id,
          externalPath,
          externalModifiedAt: item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : null,
          externalEtag: item.eTag || null,
          filename: existing ? existing.filename : docFilename,
          originalFilename: item.name,
          contentType: mimeType,
          fileSize: buffer.length,
          uploadedBy: connector.createdBy,
        });

        // If we reused existing record but file content changed, delete old file
        if (existing && existing.filename !== docFilename) {
          try {
            await fs.unlink(documentIntelligenceService.getFilePath(connector.projectId, existing.filename));
          } catch { /* ok */ }
        }

        // Fire-and-forget AI processing
        documentIntelligenceService.processDocument(connector.projectId, doc.id, filePath, connector.createdBy).catch(err =>
          logger.error('Connector doc processing error', { documentId: doc.id, error: err.message }),
        );

        synced++;
      }

      // Update delta token
      await storageConnectorRepository.updateDelta(connectorId, delta['@odata.deltaLink'] || null);

      // Clear error state if was in error
      if (connector.status === 'error') {
        await storageConnectorRepository.updateStatus(connectorId, 'active');
      }

      logger.info('Connector sync completed', { connectorId, synced, deleted, skipped });
      return { synced, deleted, skipped };
    } catch (err: any) {
      // Track consecutive failures
      const failures = ((connector.config as any)?.consecutiveFailures || 0) + 1;
      const cfg = { ...(connector.config || {}), consecutiveFailures: failures };
      await storageConnectorRepository.updateConfig(connectorId, cfg);

      if (failures >= 3) {
        await storageConnectorRepository.updateStatus(connectorId, 'error', `Sync failed ${failures} times: ${err.message}`);
      }
      throw err;
    }
  }

  async disconnect(connectorId: string): Promise<void> {
    const connector = await storageConnectorRepository.findById(connectorId);
    if (!connector) throw new Error('Connector not found');

    // Note: Microsoft doesn't have a token revocation endpoint for consumer accounts.
    // We just delete our stored tokens.
    await storageConnectorRepository.delete(connectorId);
    logger.info('Storage connector disconnected', { connectorId, provider: connector.provider });
  }
}

export const storageConnectorService = new StorageConnectorService();
