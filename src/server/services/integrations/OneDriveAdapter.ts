import logger from '../../utils/logger';
import type { StorageAdapter, StorageToken, StorageItem, DeltaResult, ConnectorConfig } from './StorageAdapter';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const AUTH_BASE = 'https://login.microsoftonline.com/common/oauth2/v2.0';

function driveBase(connectorConfig?: ConnectorConfig): string {
  if (connectorConfig?.driveId) {
    return `${GRAPH_BASE}/drives/${connectorConfig.driveId}`;
  }
  if (connectorConfig?.siteId) {
    return `${GRAPH_BASE}/sites/${connectorConfig.siteId}/drive`;
  }
  return `${GRAPH_BASE}/me/drive`;
}

function toStorageItem(item: any): StorageItem {
  return {
    id: item.id,
    name: item.name,
    size: item.size,
    mimeType: item.file?.mimeType,
    isFolder: !!item.folder,
    childCount: item.folder?.childCount,
    parentPath: item.parentReference?.path,
    parentId: item.parentReference?.id,
    lastModifiedDateTime: item.lastModifiedDateTime,
    deleted: !!item.deleted,
    eTag: item.eTag,
  };
}

class OneDriveAdapter implements StorageAdapter {
  buildAuthUrl(params: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge?: string;
  }): string {
    const query = new URLSearchParams({
      client_id: params.clientId,
      response_type: 'code',
      redirect_uri: params.redirectUri,
      scope: this.getScopes(),
      state: params.state,
      prompt: 'select_account',
    });
    if (params.codeChallenge) {
      query.set('code_challenge', params.codeChallenge);
      query.set('code_challenge_method', 'S256');
    }
    return `${AUTH_BASE}/authorize?${query.toString()}`;
  }

  async exchangeCode(params: {
    code: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
    codeVerifier?: string;
  }): Promise<StorageToken> {
    const body = new URLSearchParams({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
      grant_type: 'authorization_code',
    });
    if (params.codeVerifier) {
      body.set('code_verifier', params.codeVerifier);
    }

    const resp = await fetch(`${AUTH_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!resp.ok) {
      const text = await resp.text();
      logger.error('OneDrive token exchange failed', { status: resp.status, body: text });
      throw new Error(`Token exchange failed: ${resp.status}`);
    }

    return resp.json() as Promise<StorageToken>;
  }

  async refreshToken(params: {
    refreshToken: string;
    clientId: string;
    clientSecret: string;
  }): Promise<StorageToken> {
    const body = new URLSearchParams({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      refresh_token: params.refreshToken,
      grant_type: 'refresh_token',
    });

    const resp = await fetch(`${AUTH_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!resp.ok) {
      const text = await resp.text();
      logger.error('OneDrive token refresh failed', { status: resp.status, body: text });
      throw new Error(`Token refresh failed: ${resp.status}`);
    }

    return resp.json() as Promise<StorageToken>;
  }

  async testConnection(accessToken: string): Promise<{ displayName: string; email: string }> {
    const resp = await fetch(`${GRAPH_BASE}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) throw new Error(`Connection test failed: ${resp.status}`);
    const data = await resp.json();
    return { displayName: data.displayName, email: data.mail || data.userPrincipalName };
  }

  async listFolder(accessToken: string, folderId?: string, connectorConfig?: ConnectorConfig): Promise<StorageItem[]> {
    const base = driveBase(connectorConfig);
    let path: string;
    if (folderId) {
      path = `${base}/items/${folderId}/children`;
    } else if (connectorConfig?.sharedItemId) {
      path = `${base}/items/${connectorConfig.sharedItemId}/children`;
    } else {
      path = `${base}/root/children`;
    }

    const resp = await fetch(`${path}?$select=id,name,size,file,folder,parentReference`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) throw new Error(`List folder failed: ${resp.status}`);
    const data = await resp.json();
    return (data.value || []).map(toStorageItem);
  }

  async getDelta(accessToken: string, deltaToken?: string, connectorConfig?: ConnectorConfig): Promise<DeltaResult> {
    const base = driveBase(connectorConfig);
    const url = deltaToken || `${base}/root/delta?$select=id,name,size,file,folder,parentReference,lastModifiedDateTime,deleted,eTag`;

    let allItems: StorageItem[] = [];
    let currentUrl: string | undefined = url;
    let finalDeltaToken: string | undefined;
    const MAX_PAGES = 50;
    let pages = 0;

    while (currentUrl && pages < MAX_PAGES) {
      const resp: Response = await fetch(currentUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(30000),
      });

      if (!resp.ok) throw new Error(`Delta query failed: ${resp.status}`);
      const data: any = await resp.json();
      allItems = allItems.concat((data.value || []).map(toStorageItem));
      currentUrl = data['@odata.nextLink'] as string | undefined;
      if (data['@odata.deltaLink']) {
        finalDeltaToken = data['@odata.deltaLink'];
      }
      pages++;
    }

    if (currentUrl && pages >= MAX_PAGES) {
      logger.warn('Delta pagination capped', { pages, items: allItems.length });
    }

    return { items: allItems, deltaToken: finalDeltaToken };
  }

  async listFolderFiles(accessToken: string, folderId: string, connectorConfig?: ConnectorConfig): Promise<StorageItem[]> {
    const base = driveBase(connectorConfig);
    const url = `${base}/items/${folderId}/children?$select=id,name,size,file,folder,parentReference,lastModifiedDateTime,eTag&$top=200`;
    let allItems: StorageItem[] = [];
    let currentUrl: string | undefined = url;

    while (currentUrl) {
      const resp: Response = await fetch(currentUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(30000),
      });

      if (!resp.ok) throw new Error(`List folder files failed: ${resp.status}`);
      const data: any = await resp.json();
      allItems = allItems.concat((data.value || []).map(toStorageItem));
      currentUrl = data['@odata.nextLink'] as string | undefined;
    }

    return allItems;
  }

  async downloadFile(accessToken: string, itemId: string, connectorConfig?: ConnectorConfig): Promise<Buffer> {
    const base = driveBase(connectorConfig);
    const resp = await fetch(`${base}/items/${itemId}/content`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: 'follow',
    });

    if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
    const arrayBuffer = await resp.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async resolveShareLink(accessToken: string, shareUrl: string): Promise<{ driveId: string; itemId: string; name: string }> {
    // Encode sharing URL per Microsoft Graph Shares API: "u!" + base64url(shareUrl)
    const encoded = 'u!' + Buffer.from(shareUrl, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const resp = await fetch(`${GRAPH_BASE}/shares/${encoded}/driveItem`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) {
      const text = await resp.text();
      logger.error('Resolve share link failed', { status: resp.status, body: text });
      throw new Error(`Failed to resolve shared folder link: ${resp.status}`);
    }

    const item = await resp.json() as any;
    const driveId = item.parentReference?.driveId || item.remoteItem?.parentReference?.driveId;
    const itemId = item.id || item.remoteItem?.id;

    if (!driveId || !itemId) {
      throw new Error('Could not resolve drive ID from shared link — ensure the link points to a folder');
    }

    return { driveId, itemId, name: item.name || 'Shared Folder' };
  }

  getScopes(): string {
    return 'Files.Read.All User.Read offline_access';
  }
}

export const oneDriveAdapter: StorageAdapter = new OneDriveAdapter();
