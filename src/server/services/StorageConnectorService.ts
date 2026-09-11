import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { encryptToken, decryptToken } from '../utils/tokenEncryption';
import { storageConnectorRepository, type StorageConnector } from '../database/StorageConnectorRepository';
import { projectDocumentRepository } from '../database/ProjectDocumentRepository';
import { documentIntelligenceService } from './DocumentIntelligenceService';
import { getStorageAdapter, getProviderCredentials, getCallbackPath, getProviderLabel, type StorageProvider } from './integrations/storageAdapterRegistry';
import type { StorageItem, ConnectorConfig } from './integrations/StorageAdapter';
import { redisService } from './RedisService';
import { validateMimeType } from '../utils/mimeValidator';
import { getTenantContext, runWithTenantContext } from '../middleware/requestContext';
import { userService } from './UserService';
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

const TIER_DOC_LIMITS: Record<string, number> = {
  trial: 0,
  consultant_basic: 0,
  consultant_pro: 100,
  sme: 500,
  enterprise: Infinity,
};

class StorageConnectorService {
  async initiateOAuthFlow(projectId: string, userId: string, provider: StorageProvider): Promise<{ authUrl: string }> {
    const creds = getProviderCredentials(provider);
    if (!creds.clientId) throw new Error(`${getProviderLabel(provider)} integration not configured`);

    // PKCE (Dropbox doesn't support it, but we generate anyway — adapter ignores if not needed)
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
      `oauth:storage:${state}`,
      JSON.stringify({
        projectId, userId, codeVerifier, provider,
        tenantDbName: tenantCtx?.dbName || null,
        tenantOrgId: tenantCtx?.orgId || null,
      }),
      OAUTH_STATE_TTL,
    );

    const callbackPath = getCallbackPath(provider);
    const redirectUri = `${config.APP_URL}/api/v1/storage-connectors/${callbackPath}/callback`;

    const adapter = getStorageAdapter(provider);
    const authUrl = adapter.buildAuthUrl({
      clientId: creds.clientId,
      redirectUri,
      state,
      codeChallenge,
    });

    return { authUrl };
  }

  async handleOAuthCallback(state: string, code: string): Promise<StorageConnector> {
    // Validate state
    const raw = await redisService.get(`oauth:storage:${state}`);
    if (!raw) throw new Error('Invalid or expired OAuth state');

    const { projectId, userId, codeVerifier, provider, tenantDbName, tenantOrgId } = JSON.parse(raw);

    // Delete state (single-use)
    await redisService.del(`oauth:storage:${state}`);

    const callbackPath = getCallbackPath(provider);
    const redirectUri = `${config.APP_URL}/api/v1/storage-connectors/${callbackPath}/callback`;
    const creds = getProviderCredentials(provider);
    const adapter = getStorageAdapter(provider);

    // Exchange code for tokens
    const tokens = await adapter.exchangeCode({
      code, redirectUri,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      codeVerifier,
    });

    // Test connection to get user info for display name
    const user = await adapter.testConnection(tokens.access_token);

    // Encrypt tokens
    const accessTokenEnc = encryptToken(tokens.access_token);
    const refreshTokenEnc = encryptToken(tokens.refresh_token);
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    const label = getProviderLabel(provider);

    // Create connector record — needs tenant context for DB write
    const createConnector = async () => storageConnectorRepository.create({
      projectId,
      provider,
      displayName: `${label} - ${user.displayName}`,
      accessTokenEnc,
      refreshTokenEnc,
      tokenExpiresAt,
      createdBy: userId,
      config: { email: user.email, syncFolders: [] },
    });

    let connector: StorageConnector;
    if (tenantDbName && tenantOrgId) {
      connector = await runWithTenantContext(tenantDbName, tenantOrgId, createConnector);
    } else {
      connector = await createConnector();
    }

    logger.info('Storage connector created', { connectorId: connector.id, projectId, provider, user: user.email });
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
    const refreshTokenVal = decryptToken(connector.refreshTokenEnc);
    const creds = getProviderCredentials(connector.provider);
    const adapter = getStorageAdapter(connector.provider);

    const tokens = await adapter.refreshToken({
      refreshToken: refreshTokenVal,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    });

    const accessTokenEnc = encryptToken(tokens.access_token);
    const refreshTokenEnc = encryptToken(tokens.refresh_token);
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    await storageConnectorRepository.updateTokens(connector.id, {
      accessTokenEnc,
      refreshTokenEnc,
      tokenExpiresAt,
    });

    logger.debug('Storage token refreshed', { connectorId: connector.id, provider: connector.provider });
    return tokens.access_token;
  }

  async listFolder(connectorId: string, folderId?: string): Promise<any[]> {
    const connector = await storageConnectorRepository.findById(connectorId);
    if (!connector) throw new Error('Connector not found');

    const accessToken = await this.refreshTokenIfNeeded(connector);
    const adapter = getStorageAdapter(connector.provider);
    const connectorConfig = (connector.config || {}) as ConnectorConfig;
    const items = await adapter.listFolder(accessToken, folderId, connectorConfig);

    return items.map(item => ({
      id: item.id,
      name: item.name,
      isFolder: item.isFolder,
      childCount: item.childCount || 0,
      size: item.size || 0,
      mimeType: item.mimeType || null,
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

  async syncConnector(connectorId: string, docLimit?: number): Promise<{ synced: number; deleted: number; skipped: number }> {
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
    const adapter = getStorageAdapter(connector.provider);
    const connectorConfig = (connector.config || {}) as ConnectorConfig;

    // Resolve document limit from user tier
    let effectiveDocLimit = docLimit;
    if (effectiveDocLimit === undefined) {
      try {
        const user = await userService.findById(connector.createdBy);
        const tier = user?.subscriptionTier || 'trial';
        effectiveDocLimit = TIER_DOC_LIMITS[tier] ?? 0;
      } catch {
        effectiveDocLimit = Infinity; // Fallback: don't block if user lookup fails
      }
    }

    let remainingDocs = Infinity;
    if (effectiveDocLimit !== Infinity) {
      const currentCount = await projectDocumentRepository.countByProject(connector.projectId);
      remainingDocs = Math.max(0, effectiveDocLimit - currentCount);
    }

    try {
      let items: StorageItem[];
      let deltaToken: string | undefined;

      if (syncFolders.length > 0) {
        // Targeted sync: list files in each selected folder
        const folderResults = await Promise.all(
          syncFolders.map(fid => adapter.listFolderFiles(accessToken, fid, connectorConfig)),
        );
        items = folderResults.flat();
        deltaToken = undefined;
      } else {
        // Full drive delta sync
        const delta = await adapter.getDelta(accessToken, connector.deltaToken || undefined, connectorConfig);
        items = delta.items;
        deltaToken = delta.deltaToken;
      }

      let synced = 0;
      let deleted = 0;
      let skipped = 0;

      for (const item of items) {
        if (synced + deleted >= MAX_FILES_PER_SYNC) {
          skipped++;
          continue;
        }

        // Handle deletions
        if (item.deleted) {
          const existing = await projectDocumentRepository.findByExternalId(connectorId, item.id);
          if (existing) {
            documentIntelligenceService.deleteDocumentEmbeddings(existing.id).catch(() => {});
            await projectDocumentRepository.delete(existing.id);
            deleted++;
          }
          continue;
        }

        // Skip folders
        if (item.isFolder) continue;

        // Skip unsupported types
        const mimeType = item.mimeType;
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

        // Check document limit (only for new files, not updates)
        if (!existing && remainingDocs <= 0) {
          skipped++;
          continue;
        }

        // Download file
        const buffer = await adapter.downloadFile(accessToken, item.id, connectorConfig);

        // Validate MIME
        const mimeCheck = validateMimeType(mimeType, buffer);
        if (!mimeCheck.valid) {
          skipped++;
          continue;
        }

        // Save to temp file for AI processing (BYOS: not kept permanently)
        const ext = path.extname(item.name) || '';
        const tmpFilename = `tmp_${uuidv4()}${ext}`;
        const tmpDir = path.join(config.UPLOAD_DIR, 'documents', '_tmp');
        await fs.mkdir(tmpDir, { recursive: true });
        const tmpPath = path.join(tmpDir, tmpFilename);
        await fs.writeFile(tmpPath, buffer);

        // Build external path
        const externalPath = item.parentPath
          ? `${item.parentPath}/${item.name}`
          : item.name;

        const doc = await projectDocumentRepository.upsertFromConnector({
          existingId: existing?.id,
          projectId: connector.projectId,
          connectorId,
          externalId: item.id,
          externalPath,
          externalModifiedAt: item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : null,
          externalEtag: item.eTag || null,
          filename: '', // BYOS: no local file stored
          originalFilename: item.name,
          contentType: mimeType,
          fileSize: buffer.length,
          uploadedBy: connector.createdBy,
        });

        // AI processing, then clean up temp file
        documentIntelligenceService.processDocument(connector.projectId, doc.id, tmpPath, connector.createdBy)
          .catch(err => logger.error('Connector doc processing error', { documentId: doc.id, error: err.message }))
          .finally(() => fs.unlink(tmpPath).catch(() => {}));

        synced++;
        if (!existing) remainingDocs--;
      }

      // Update delta token (only when using full-drive delta sync)
      if (deltaToken) {
        await storageConnectorRepository.updateDelta(connectorId, deltaToken);
      }

      // Clear error state if was in error
      if (connector.status === 'error') {
        await storageConnectorRepository.updateStatus(connectorId, 'active');
      }

      logger.info('Connector sync completed', { connectorId, provider: connector.provider, synced, deleted, skipped });
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

  /**
   * Stream a file from the provider on-demand (BYOS: Kovarti doesn't store the file).
   */
  async streamFileFromProvider(connectorId: string, externalId: string): Promise<Buffer> {
    const connector = await storageConnectorRepository.findById(connectorId);
    if (!connector) throw new Error('Connector not found');

    const accessToken = await this.refreshTokenIfNeeded(connector);
    const adapter = getStorageAdapter(connector.provider);
    const connectorConfig = (connector.config || {}) as ConnectorConfig;
    return adapter.downloadFile(accessToken, externalId, connectorConfig);
  }

  async disconnect(connectorId: string): Promise<void> {
    const connector = await storageConnectorRepository.findById(connectorId);
    if (!connector) throw new Error('Connector not found');

    await storageConnectorRepository.delete(connectorId);
    logger.info('Storage connector disconnected', { connectorId, provider: connector.provider });
  }
}

export const storageConnectorService = new StorageConnectorService();
