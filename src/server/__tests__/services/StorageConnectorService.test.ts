import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the service under test
// ---------------------------------------------------------------------------

const mockAdapter = {
  buildAuthUrl: vi.fn(),
  exchangeCode: vi.fn(),
  refreshToken: vi.fn(),
  testConnection: vi.fn(),
  listFolder: vi.fn(),
  getDelta: vi.fn(),
  listFolderFiles: vi.fn(),
  downloadFile: vi.fn(),
  getScopes: vi.fn(),
  resolveShareLink: vi.fn(),
};

vi.mock('../../services/integrations/storageAdapterRegistry', () => ({
  getStorageAdapter: vi.fn(() => mockAdapter),
  getProviderCredentials: vi.fn(() => ({ clientId: 'test-client-id', clientSecret: 'test-client-secret' })),
  getCallbackPath: vi.fn(() => 'onedrive'),
  getProviderLabel: vi.fn(() => 'OneDrive'),
}));

vi.mock('../../database/StorageConnectorRepository', () => ({
  storageConnectorRepository: {
    findById: vi.fn(),
    create: vi.fn(),
    updateTokens: vi.fn().mockResolvedValue(undefined),
    updateConfig: vi.fn().mockResolvedValue(undefined),
    updateDelta: vi.fn().mockResolvedValue(undefined),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../database/ProjectDocumentRepository', () => ({
  projectDocumentRepository: {
    findByExternalId: vi.fn(),
    countByProject: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
    upsertFromConnector: vi.fn(),
  },
}));

vi.mock('../../services/DocumentIntelligenceService', () => ({
  documentIntelligenceService: {
    processDocument: vi.fn().mockResolvedValue(undefined),
    deleteDocumentEmbeddings: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/RedisService', () => ({
  redisService: {
    set: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
    del: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/UserService', () => ({
  userService: {
    findById: vi.fn(),
  },
}));

vi.mock('../../utils/tokenEncryption', () => ({
  encryptToken: vi.fn((val: string) => `encrypted_${val}`),
  decryptToken: vi.fn((val: string) => val.replace('encrypted_', '')),
}));

vi.mock('../../utils/mimeValidator', () => ({
  validateMimeType: vi.fn(() => ({ valid: true })),
}));

vi.mock('../../middleware/requestContext', () => ({
  getTenantContext: vi.fn(() => ({ dbName: 'pmassist_t_test', orgId: 'org-1' })),
  runWithTenantContext: vi.fn((_db: string, _org: string, fn: () => any) => fn()),
}));

vi.mock('../../config', () => ({
  config: {
    APP_URL: 'https://app.test.com',
    UPLOAD_DIR: '/tmp/uploads',
    CONNECTOR_ENCRYPTION_KEY: 'a]32charencryptionkeyfortest1234',
  },
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-1234'),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { storageConnectorService } from '../../services/StorageConnectorService';
import { storageConnectorRepository } from '../../database/StorageConnectorRepository';
import { projectDocumentRepository } from '../../database/ProjectDocumentRepository';
import { documentIntelligenceService } from '../../services/DocumentIntelligenceService';
import { redisService } from '../../services/RedisService';
import { userService } from '../../services/UserService';
import { validateMimeType } from '../../utils/mimeValidator';
import { encryptToken, decryptToken } from '../../utils/tokenEncryption';
import { getProviderCredentials, getProviderLabel } from '../../services/integrations/storageAdapterRegistry';
import type { StorageConnector } from '../../database/StorageConnectorRepository';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConnector(overrides: Partial<StorageConnector> = {}): StorageConnector {
  return {
    id: 'conn-1',
    projectId: 'proj-1',
    provider: 'onedrive',
    displayName: 'OneDrive - Test User',
    accessTokenEnc: 'encrypted_access-token',
    refreshTokenEnc: 'encrypted_refresh-token',
    tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(), // 1 hour from now
    config: { syncFolders: [] },
    status: 'active',
    errorMessage: null,
    lastSyncAt: null,
    deltaToken: null,
    syncIntervalMinutes: 60,
    createdBy: 'user-1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StorageConnectorService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // initiateOAuthFlow
  // =========================================================================
  describe('initiateOAuthFlow', () => {
    it('should build auth URL and store state in Redis', async () => {
      mockAdapter.buildAuthUrl.mockReturnValue('https://login.example.com/oauth?state=xyz');

      const result = await storageConnectorService.initiateOAuthFlow('proj-1', 'user-1', 'onedrive');

      expect(result).toEqual({ authUrl: 'https://login.example.com/oauth?state=xyz' });
      expect(redisService.set).toHaveBeenCalledTimes(1);
      const setArgs = vi.mocked(redisService.set).mock.calls[0];
      expect(setArgs[0]).toMatch(/^oauth:storage:/);
      const stored = JSON.parse(setArgs[1] as string);
      expect(stored.projectId).toBe('proj-1');
      expect(stored.userId).toBe('user-1');
      expect(stored.provider).toBe('onedrive');
      expect(stored.codeVerifier).toBeDefined();
      expect(setArgs[2]).toBe(600); // OAUTH_STATE_TTL
    });

    it('should throw if provider credentials are not configured', async () => {
      vi.mocked(getProviderCredentials).mockReturnValueOnce({ clientId: '', clientSecret: '' });

      await expect(
        storageConnectorService.initiateOAuthFlow('proj-1', 'user-1', 'onedrive'),
      ).rejects.toThrow('integration not configured');
    });

    it('should include shareUrl and siteUrl in stored state when provided', async () => {
      mockAdapter.buildAuthUrl.mockReturnValue('https://login.example.com/oauth');

      await storageConnectorService.initiateOAuthFlow('proj-1', 'user-1', 'sharepoint', {
        shareUrl: 'https://share.example.com/folder',
        siteUrl: 'https://site.example.com',
      });

      const stored = JSON.parse(vi.mocked(redisService.set).mock.calls[0][1] as string);
      expect(stored.shareUrl).toBe('https://share.example.com/folder');
      expect(stored.siteUrl).toBe('https://site.example.com');
    });
  });

  // =========================================================================
  // handleOAuthCallback
  // =========================================================================
  describe('handleOAuthCallback', () => {
    const stateToken = 'state-abc';
    const oauthState = {
      projectId: 'proj-1',
      userId: 'user-1',
      codeVerifier: 'verifier-xyz',
      provider: 'onedrive',
      tenantDbName: 'pmassist_t_test',
      tenantOrgId: 'org-1',
      shareUrl: null,
      siteUrl: null,
    };

    beforeEach(() => {
      vi.mocked(redisService.get).mockResolvedValue(JSON.stringify(oauthState));
      mockAdapter.exchangeCode.mockResolvedValue({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      });
      mockAdapter.testConnection.mockResolvedValue({ displayName: 'Test User', email: 'test@example.com' });
      vi.mocked(storageConnectorRepository.create).mockResolvedValue(makeConnector());
    });

    it('should exchange code, encrypt tokens, and create connector', async () => {
      const result = await storageConnectorService.handleOAuthCallback(stateToken, 'auth-code');

      expect(redisService.get).toHaveBeenCalledWith(`oauth:storage:${stateToken}`);
      expect(redisService.del).toHaveBeenCalledWith(`oauth:storage:${stateToken}`);
      expect(mockAdapter.exchangeCode).toHaveBeenCalledWith(expect.objectContaining({
        code: 'auth-code',
        codeVerifier: 'verifier-xyz',
      }));
      expect(encryptToken).toHaveBeenCalledWith('new-access');
      expect(encryptToken).toHaveBeenCalledWith('new-refresh');
      expect(storageConnectorRepository.create).toHaveBeenCalledWith(expect.objectContaining({
        projectId: 'proj-1',
        provider: 'onedrive',
        createdBy: 'user-1',
        accessTokenEnc: 'encrypted_new-access',
        refreshTokenEnc: 'encrypted_new-refresh',
      }));
      expect(result.id).toBe('conn-1');
    });

    it('should throw if state is invalid or expired', async () => {
      vi.mocked(redisService.get).mockResolvedValue(null);

      await expect(
        storageConnectorService.handleOAuthCallback('bad-state', 'code'),
      ).rejects.toThrow('Invalid or expired OAuth state');
    });

    it('should resolve share link when shareUrl is present', async () => {
      const stateWithShare = { ...oauthState, shareUrl: 'https://share.test.com/link' };
      vi.mocked(redisService.get).mockResolvedValue(JSON.stringify(stateWithShare));
      mockAdapter.resolveShareLink.mockResolvedValue({
        driveId: 'drive-123',
        itemId: 'item-456',
        name: 'Shared Folder',
      });

      await storageConnectorService.handleOAuthCallback(stateToken, 'auth-code');

      expect(mockAdapter.resolveShareLink).toHaveBeenCalledWith('new-access', 'https://share.test.com/link');
      expect(storageConnectorRepository.create).toHaveBeenCalledWith(expect.objectContaining({
        displayName: 'OneDrive - Test User (Shared Folder)',
        config: expect.objectContaining({
          driveId: 'drive-123',
          sharedItemId: 'item-456',
        }),
      }));
    });

    it('should run without tenant context when tenantDbName is missing', async () => {
      const stateNoTenant = { ...oauthState, tenantDbName: null, tenantOrgId: null };
      vi.mocked(redisService.get).mockResolvedValue(JSON.stringify(stateNoTenant));

      const result = await storageConnectorService.handleOAuthCallback(stateToken, 'auth-code');

      expect(result.id).toBe('conn-1');
      // runWithTenantContext should NOT have been called since we import it above
      // but with null tenantDbName it takes the else branch
    });
  });

  // =========================================================================
  // refreshTokenIfNeeded
  // =========================================================================
  describe('refreshTokenIfNeeded', () => {
    it('should return existing token if not expired', async () => {
      const connector = makeConnector({
        tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });

      const token = await storageConnectorService.refreshTokenIfNeeded(connector);

      expect(token).toBe('access-token'); // decryptToken strips 'encrypted_'
      expect(mockAdapter.refreshToken).not.toHaveBeenCalled();
    });

    it('should refresh token if within buffer window', async () => {
      const connector = makeConnector({
        tokenExpiresAt: new Date(Date.now() + 60_000).toISOString(), // 1 min from now, within 5-min buffer
      });

      mockAdapter.refreshToken.mockResolvedValue({
        access_token: 'refreshed-access',
        refresh_token: 'refreshed-refresh',
        expires_in: 3600,
      });

      const token = await storageConnectorService.refreshTokenIfNeeded(connector);

      expect(token).toBe('refreshed-access');
      expect(mockAdapter.refreshToken).toHaveBeenCalled();
      expect(storageConnectorRepository.updateTokens).toHaveBeenCalledWith('conn-1', expect.objectContaining({
        accessTokenEnc: 'encrypted_refreshed-access',
        refreshTokenEnc: 'encrypted_refreshed-refresh',
      }));
    });

    it('should refresh token if tokenExpiresAt is null', async () => {
      const connector = makeConnector({ tokenExpiresAt: null });
      mockAdapter.refreshToken.mockResolvedValue({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      });

      const token = await storageConnectorService.refreshTokenIfNeeded(connector);

      expect(token).toBe('new-access');
      expect(mockAdapter.refreshToken).toHaveBeenCalled();
    });

    it('should throw if connector has no tokens', async () => {
      const connector = makeConnector({ accessTokenEnc: null, refreshTokenEnc: null });

      await expect(
        storageConnectorService.refreshTokenIfNeeded(connector),
      ).rejects.toThrow('Connector has no tokens');
    });
  });

  // =========================================================================
  // listFolder
  // =========================================================================
  describe('listFolder', () => {
    it('should list folder contents from provider', async () => {
      const connector = makeConnector();
      vi.mocked(storageConnectorRepository.findById).mockResolvedValue(connector);
      mockAdapter.listFolder.mockResolvedValue([
        { id: 'f1', name: 'Documents', isFolder: true, childCount: 5 },
        { id: 'f2', name: 'report.pdf', isFolder: false, size: 1024, mimeType: 'application/pdf' },
      ]);

      const items = await storageConnectorService.listFolder('conn-1', 'root');

      expect(items).toHaveLength(2);
      expect(items[0]).toEqual({ id: 'f1', name: 'Documents', isFolder: true, childCount: 5, size: 0, mimeType: null });
      expect(items[1]).toEqual({ id: 'f2', name: 'report.pdf', isFolder: false, childCount: 0, size: 1024, mimeType: 'application/pdf' });
    });

    it('should throw if connector not found', async () => {
      vi.mocked(storageConnectorRepository.findById).mockResolvedValue(null);

      await expect(storageConnectorService.listFolder('bad-id')).rejects.toThrow('Connector not found');
    });
  });

  // =========================================================================
  // updateSyncFolders
  // =========================================================================
  describe('updateSyncFolders', () => {
    it('should update config with new folder IDs and reset delta token', async () => {
      const connector = makeConnector({ config: { syncFolders: ['old-folder'] } });
      vi.mocked(storageConnectorRepository.findById).mockResolvedValue(connector);

      await storageConnectorService.updateSyncFolders('conn-1', ['folder-a', 'folder-b']);

      expect(storageConnectorRepository.updateConfig).toHaveBeenCalledWith('conn-1', {
        syncFolders: ['folder-a', 'folder-b'],
      });
      expect(storageConnectorRepository.updateDelta).toHaveBeenCalledWith('conn-1', null);
    });

    it('should throw if connector not found', async () => {
      vi.mocked(storageConnectorRepository.findById).mockResolvedValue(null);

      await expect(
        storageConnectorService.updateSyncFolders('bad-id', []),
      ).rejects.toThrow('Connector not found');
    });
  });

  // =========================================================================
  // syncConnector
  // =========================================================================
  describe('syncConnector', () => {
    it('should throw if connector not found', async () => {
      vi.mocked(storageConnectorRepository.findById).mockResolvedValue(null);

      await expect(storageConnectorService.syncConnector('bad-id')).rejects.toThrow('Connector not found');
    });

    it('should throw if connector is disconnected', async () => {
      vi.mocked(storageConnectorRepository.findById).mockResolvedValue(makeConnector({ status: 'disconnected' }));

      await expect(storageConnectorService.syncConnector('conn-1')).rejects.toThrow('Connector is disconnected');
    });

    it('should mark error and rethrow if token refresh fails', async () => {
      const connector = makeConnector({ accessTokenEnc: null, refreshTokenEnc: null });
      vi.mocked(storageConnectorRepository.findById).mockResolvedValue(connector);

      await expect(storageConnectorService.syncConnector('conn-1')).rejects.toThrow('Connector has no tokens');
      expect(storageConnectorRepository.updateStatus).toHaveBeenCalledWith('conn-1', 'error', 'Token refresh failed');
    });

    it('should use full-drive delta sync when no syncFolders configured', async () => {
      const connector = makeConnector();
      vi.mocked(storageConnectorRepository.findById).mockResolvedValue(connector);
      vi.mocked(userService.findById).mockResolvedValue({ subscriptionTier: 'enterprise' } as any);
      mockAdapter.getDelta.mockResolvedValue({ items: [], deltaToken: 'new-delta' });

      const result = await storageConnectorService.syncConnector('conn-1');

      expect(mockAdapter.getDelta).toHaveBeenCalled();
      expect(mockAdapter.listFolderFiles).not.toHaveBeenCalled();
      expect(storageConnectorRepository.updateDelta).toHaveBeenCalledWith('conn-1', 'new-delta');
      expect(result).toEqual({ synced: 0, deleted: 0, skipped: 0 });
    });

    it('should use targeted folder sync when syncFolders are configured', async () => {
      const connector = makeConnector({ config: { syncFolders: ['folder-1', 'folder-2'] } });
      vi.mocked(storageConnectorRepository.findById).mockResolvedValue(connector);
      vi.mocked(userService.findById).mockResolvedValue({ subscriptionTier: 'enterprise' } as any);
      mockAdapter.listFolderFiles.mockResolvedValue([]);

      const result = await storageConnectorService.syncConnector('conn-1');

      expect(mockAdapter.listFolderFiles).toHaveBeenCalledTimes(2);
      expect(mockAdapter.getDelta).not.toHaveBeenCalled();
      expect(result).toEqual({ synced: 0, deleted: 0, skipped: 0 });
    });

    it('should sync new files: download, validate, upsert, and trigger AI processing', async () => {
      const connector = makeConnector();
      vi.mocked(storageConnectorRepository.findById).mockResolvedValue(connector);
      vi.mocked(userService.findById).mockResolvedValue({ subscriptionTier: 'enterprise' } as any);
      vi.mocked(projectDocumentRepository.findByExternalId).mockResolvedValue(null);
      vi.mocked(projectDocumentRepository.upsertFromConnector).mockResolvedValue({ id: 'doc-1' } as any);
      mockAdapter.getDelta.mockResolvedValue({
        items: [{
          id: 'ext-1',
          name: 'report.pdf',
          isFolder: false,
          size: 5000,
          mimeType: 'application/pdf',
          eTag: 'etag-1',
          parentPath: '/docs',
          lastModifiedDateTime: '2026-01-15T10:00:00Z',
        }],
        deltaToken: 'delta-2',
      });
      mockAdapter.downloadFile.mockResolvedValue(Buffer.from('file-content'));

      const result = await storageConnectorService.syncConnector('conn-1');

      expect(result.synced).toBe(1);
      expect(mockAdapter.downloadFile).toHaveBeenCalledWith(expect.any(String), 'ext-1', expect.any(Object));
      expect(projectDocumentRepository.upsertFromConnector).toHaveBeenCalledWith(expect.objectContaining({
        projectId: 'proj-1',
        connectorId: 'conn-1',
        externalId: 'ext-1',
        originalFilename: 'report.pdf',
        externalPath: '/docs/report.pdf',
      }));
      expect(documentIntelligenceService.processDocument).toHaveBeenCalled();
    });

    it('should handle deleted items', async () => {
      const connector = makeConnector();
      vi.mocked(storageConnectorRepository.findById).mockResolvedValue(connector);
      vi.mocked(userService.findById).mockResolvedValue({ subscriptionTier: 'enterprise' } as any);
      vi.mocked(projectDocumentRepository.findByExternalId).mockResolvedValue({ id: 'doc-existing' } as any);
      mockAdapter.getDelta.mockResolvedValue({
        items: [{ id: 'ext-1', name: 'old.pdf', isFolder: false, deleted: true }],
        deltaToken: 'delta-3',
      });

      const result = await storageConnectorService.syncConnector('conn-1');

      expect(result.deleted).toBe(1);
      expect(documentIntelligenceService.deleteDocumentEmbeddings).toHaveBeenCalledWith('doc-existing');
      expect(projectDocumentRepository.delete).toHaveBeenCalledWith('doc-existing');
    });

    it('should skip folders', async () => {
      const connector = makeConnector();
      vi.mocked(storageConnectorRepository.findById).mockResolvedValue(connector);
      vi.mocked(userService.findById).mockResolvedValue({ subscriptionTier: 'enterprise' } as any);
      mockAdapter.getDelta.mockResolvedValue({
        items: [{ id: 'f1', name: 'folder', isFolder: true }],
        deltaToken: 'delta-4',
      });

      const result = await storageConnectorService.syncConnector('conn-1');

      expect(result.synced).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it('should skip unsupported MIME types', async () => {
      const connector = makeConnector();
      vi.mocked(storageConnectorRepository.findById).mockResolvedValue(connector);
      vi.mocked(userService.findById).mockResolvedValue({ subscriptionTier: 'enterprise' } as any);
      mockAdapter.getDelta.mockResolvedValue({
        items: [{ id: 'ext-1', name: 'image.png', isFolder: false, mimeType: 'image/png', size: 100 }],
        deltaToken: 'delta-5',
      });

      const result = await storageConnectorService.syncConnector('conn-1');

      expect(result.skipped).toBe(1);
      expect(result.synced).toBe(0);
    });

    it('should skip files exceeding MAX_FILE_SIZE', async () => {
      const connector = makeConnector();
      vi.mocked(storageConnectorRepository.findById).mockResolvedValue(connector);
      vi.mocked(userService.findById).mockResolvedValue({ subscriptionTier: 'enterprise' } as any);
      mockAdapter.getDelta.mockResolvedValue({
        items: [{ id: 'ext-1', name: 'huge.pdf', isFolder: false, mimeType: 'application/pdf', size: 20 * 1024 * 1024 }],
        deltaToken: 'delta-6',
      });

      const result = await storageConnectorService.syncConnector('conn-1');

      expect(result.skipped).toBe(1);
    });

    it('should skip unchanged files (same eTag)', async () => {
      const connector = makeConnector();
      vi.mocked(storageConnectorRepository.findById).mockResolvedValue(connector);
      vi.mocked(userService.findById).mockResolvedValue({ subscriptionTier: 'enterprise' } as any);
      vi.mocked(projectDocumentRepository.findByExternalId).mockResolvedValue({
        id: 'doc-1',
        externalEtag: 'same-etag',
      } as any);
      mockAdapter.getDelta.mockResolvedValue({
        items: [{ id: 'ext-1', name: 'report.pdf', isFolder: false, mimeType: 'application/pdf', size: 100, eTag: 'same-etag' }],
        deltaToken: 'delta-7',
      });

      const result = await storageConnectorService.syncConnector('conn-1');

      expect(result.synced).toBe(0);
      expect(result.skipped).toBe(0);
      expect(mockAdapter.downloadFile).not.toHaveBeenCalled();
    });

    it('should skip new files when document limit reached', async () => {
      const connector = makeConnector();
      vi.mocked(storageConnectorRepository.findById).mockResolvedValue(connector);
      vi.mocked(userService.findById).mockResolvedValue({ subscriptionTier: 'consultant_pro' } as any);
      vi.mocked(projectDocumentRepository.countByProject).mockResolvedValue(100); // at limit
      vi.mocked(projectDocumentRepository.findByExternalId).mockResolvedValue(null);
      mockAdapter.getDelta.mockResolvedValue({
        items: [{ id: 'ext-1', name: 'new.pdf', isFolder: false, mimeType: 'application/pdf', size: 100 }],
        deltaToken: 'delta-8',
      });

      const result = await storageConnectorService.syncConnector('conn-1');

      expect(result.skipped).toBe(1);
      expect(result.synced).toBe(0);
    });

    it('should skip files with invalid MIME validation', async () => {
      const connector = makeConnector();
      vi.mocked(storageConnectorRepository.findById).mockResolvedValue(connector);
      vi.mocked(userService.findById).mockResolvedValue({ subscriptionTier: 'enterprise' } as any);
      vi.mocked(projectDocumentRepository.findByExternalId).mockResolvedValue(null);
      vi.mocked(validateMimeType).mockReturnValueOnce({ valid: false, reason: 'MIME mismatch' } as any);
      mockAdapter.getDelta.mockResolvedValue({
        items: [{ id: 'ext-1', name: 'fake.pdf', isFolder: false, mimeType: 'application/pdf', size: 100 }],
        deltaToken: 'delta-9',
      });
      mockAdapter.downloadFile.mockResolvedValue(Buffer.from('not-a-pdf'));

      const result = await storageConnectorService.syncConnector('conn-1');

      expect(result.skipped).toBe(1);
    });

    it('should clear error status after successful sync', async () => {
      const connector = makeConnector({ status: 'error' });
      vi.mocked(storageConnectorRepository.findById).mockResolvedValue(connector);
      vi.mocked(userService.findById).mockResolvedValue({ subscriptionTier: 'enterprise' } as any);
      mockAdapter.getDelta.mockResolvedValue({ items: [], deltaToken: 'delta-ok' });

      await storageConnectorService.syncConnector('conn-1');

      expect(storageConnectorRepository.updateStatus).toHaveBeenCalledWith('conn-1', 'active');
    });

    it('should track consecutive failures and set error status after 3', async () => {
      const connector = makeConnector({ config: { consecutiveFailures: 2 } });
      vi.mocked(storageConnectorRepository.findById).mockResolvedValue(connector);
      vi.mocked(userService.findById).mockResolvedValue({ subscriptionTier: 'enterprise' } as any);
      mockAdapter.getDelta.mockRejectedValue(new Error('Provider API error'));

      await expect(storageConnectorService.syncConnector('conn-1')).rejects.toThrow('Provider API error');

      expect(storageConnectorRepository.updateConfig).toHaveBeenCalledWith('conn-1', expect.objectContaining({
        consecutiveFailures: 3,
      }));
      expect(storageConnectorRepository.updateStatus).toHaveBeenCalledWith(
        'conn-1',
        'error',
        expect.stringContaining('Sync failed 3 times'),
      );
    });

    it('should respect explicit docLimit parameter', async () => {
      const connector = makeConnector();
      vi.mocked(storageConnectorRepository.findById).mockResolvedValue(connector);
      vi.mocked(projectDocumentRepository.countByProject).mockResolvedValue(5);
      vi.mocked(projectDocumentRepository.findByExternalId).mockResolvedValue(null);
      vi.mocked(projectDocumentRepository.upsertFromConnector).mockResolvedValue({ id: 'doc-1' } as any);
      mockAdapter.getDelta.mockResolvedValue({
        items: [{ id: 'ext-1', name: 'file.pdf', isFolder: false, mimeType: 'application/pdf', size: 100 }],
        deltaToken: 'delta-10',
      });
      mockAdapter.downloadFile.mockResolvedValue(Buffer.from('content'));

      const result = await storageConnectorService.syncConnector('conn-1', 10);

      expect(result.synced).toBe(1);
      // userService.findById should NOT be called when docLimit is provided
      expect(userService.findById).not.toHaveBeenCalled();
    });

    it('should use fallback Infinity limit when user lookup fails', async () => {
      const connector = makeConnector();
      vi.mocked(storageConnectorRepository.findById).mockResolvedValue(connector);
      vi.mocked(userService.findById).mockRejectedValue(new Error('DB error'));
      vi.mocked(projectDocumentRepository.findByExternalId).mockResolvedValue(null);
      vi.mocked(projectDocumentRepository.upsertFromConnector).mockResolvedValue({ id: 'doc-1' } as any);
      mockAdapter.getDelta.mockResolvedValue({
        items: [{ id: 'ext-1', name: 'file.pdf', isFolder: false, mimeType: 'application/pdf', size: 100 }],
        deltaToken: 'delta-11',
      });
      mockAdapter.downloadFile.mockResolvedValue(Buffer.from('content'));

      const result = await storageConnectorService.syncConnector('conn-1');

      // Should still sync because fallback is Infinity
      expect(result.synced).toBe(1);
    });

    it('should enforce MAX_FILES_PER_SYNC limit', async () => {
      const connector = makeConnector();
      vi.mocked(storageConnectorRepository.findById).mockResolvedValue(connector);
      vi.mocked(userService.findById).mockResolvedValue({ subscriptionTier: 'enterprise' } as any);
      vi.mocked(projectDocumentRepository.findByExternalId).mockResolvedValue(null);
      vi.mocked(projectDocumentRepository.upsertFromConnector).mockResolvedValue({ id: 'doc-x' } as any);

      // Generate 55 items — exceeds MAX_FILES_PER_SYNC of 50
      const items = Array.from({ length: 55 }, (_, i) => ({
        id: `ext-${i}`,
        name: `file-${i}.pdf`,
        isFolder: false,
        mimeType: 'application/pdf',
        size: 100,
      }));
      mockAdapter.getDelta.mockResolvedValue({ items, deltaToken: 'delta-12' });
      mockAdapter.downloadFile.mockResolvedValue(Buffer.from('content'));

      const result = await storageConnectorService.syncConnector('conn-1');

      expect(result.synced).toBe(50);
      expect(result.skipped).toBe(5);
    });

    it('should use externalPath from item.name when parentPath is absent', async () => {
      const connector = makeConnector();
      vi.mocked(storageConnectorRepository.findById).mockResolvedValue(connector);
      vi.mocked(userService.findById).mockResolvedValue({ subscriptionTier: 'enterprise' } as any);
      vi.mocked(projectDocumentRepository.findByExternalId).mockResolvedValue(null);
      vi.mocked(projectDocumentRepository.upsertFromConnector).mockResolvedValue({ id: 'doc-1' } as any);
      mockAdapter.getDelta.mockResolvedValue({
        items: [{ id: 'ext-1', name: 'rootfile.pdf', isFolder: false, mimeType: 'application/pdf', size: 100 }],
        deltaToken: 'delta-13',
      });
      mockAdapter.downloadFile.mockResolvedValue(Buffer.from('content'));

      await storageConnectorService.syncConnector('conn-1');

      expect(projectDocumentRepository.upsertFromConnector).toHaveBeenCalledWith(
        expect.objectContaining({ externalPath: 'rootfile.pdf' }),
      );
    });
  });

  // =========================================================================
  // streamFileFromProvider
  // =========================================================================
  describe('streamFileFromProvider', () => {
    it('should download file from provider', async () => {
      const connector = makeConnector();
      vi.mocked(storageConnectorRepository.findById).mockResolvedValue(connector);
      const fileBuffer = Buffer.from('file-bytes');
      mockAdapter.downloadFile.mockResolvedValue(fileBuffer);

      const result = await storageConnectorService.streamFileFromProvider('conn-1', 'ext-file-1');

      expect(result).toBe(fileBuffer);
      expect(mockAdapter.downloadFile).toHaveBeenCalledWith(expect.any(String), 'ext-file-1', expect.any(Object));
    });

    it('should throw if connector not found', async () => {
      vi.mocked(storageConnectorRepository.findById).mockResolvedValue(null);

      await expect(
        storageConnectorService.streamFileFromProvider('bad-id', 'ext-1'),
      ).rejects.toThrow('Connector not found');
    });
  });

  // =========================================================================
  // disconnect
  // =========================================================================
  describe('disconnect', () => {
    it('should delete connector record', async () => {
      const connector = makeConnector();
      vi.mocked(storageConnectorRepository.findById).mockResolvedValue(connector);

      await storageConnectorService.disconnect('conn-1');

      expect(storageConnectorRepository.delete).toHaveBeenCalledWith('conn-1');
    });

    it('should throw if connector not found', async () => {
      vi.mocked(storageConnectorRepository.findById).mockResolvedValue(null);

      await expect(storageConnectorService.disconnect('bad-id')).rejects.toThrow('Connector not found');
    });
  });
});
