/**
 * Abstract interface for multi-provider storage connectors.
 * All providers (OneDrive, SharePoint, Google Drive, Dropbox) implement this interface.
 */

export interface StorageToken {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface StorageItem {
  id: string;
  name: string;
  size?: number;
  mimeType?: string;
  isFolder: boolean;
  childCount?: number;
  parentPath?: string;
  parentId?: string;
  lastModifiedDateTime?: string;
  deleted?: boolean;
  eTag?: string;
}

export interface DeltaResult {
  items: StorageItem[];
  deltaToken?: string;
}

export interface ConnectorConfig {
  siteId?: string;
  driveId?: string;
  sharedItemId?: string;
  shareUrl?: string;
  syncFolders?: string[];
  [key: string]: unknown;
}

export interface StorageAdapter {
  buildAuthUrl(params: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge?: string;
  }): string;

  exchangeCode(params: {
    code: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
    codeVerifier?: string;
  }): Promise<StorageToken>;

  refreshToken(params: {
    refreshToken: string;
    clientId: string;
    clientSecret: string;
  }): Promise<StorageToken>;

  testConnection(accessToken: string, connectorConfig?: ConnectorConfig): Promise<{ displayName: string; email: string }>;

  listFolder(accessToken: string, folderId?: string, connectorConfig?: ConnectorConfig): Promise<StorageItem[]>;

  getDelta(accessToken: string, deltaToken?: string, connectorConfig?: ConnectorConfig): Promise<DeltaResult>;

  listFolderFiles(accessToken: string, folderId: string, connectorConfig?: ConnectorConfig): Promise<StorageItem[]>;

  downloadFile(accessToken: string, itemId: string, connectorConfig?: ConnectorConfig): Promise<Buffer>;

  getScopes(): string;

  resolveShareLink?(accessToken: string, shareUrl: string): Promise<{ driveId: string; itemId: string; name: string }>;
}
