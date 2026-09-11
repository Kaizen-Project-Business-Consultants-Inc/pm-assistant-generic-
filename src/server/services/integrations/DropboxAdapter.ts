import logger from '../../utils/logger';
import type { StorageAdapter, StorageToken, StorageItem, DeltaResult } from './StorageAdapter';

const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const API_BASE = 'https://api.dropboxapi.com/2';
const CONTENT_BASE = 'https://content.dropboxapi.com/2';

function toStorageItem(entry: any): StorageItem {
  const isFolder = entry['.tag'] === 'folder';
  return {
    id: entry.id || entry.path_lower,
    name: entry.name,
    size: entry.size,
    mimeType: undefined, // Dropbox doesn't provide MIME types in metadata
    isFolder,
    childCount: undefined,
    parentPath: entry.path_display ? entry.path_display.substring(0, entry.path_display.lastIndexOf('/')) : undefined,
    parentId: undefined,
    lastModifiedDateTime: entry.server_modified || entry.client_modified,
    deleted: entry['.tag'] === 'deleted',
    eTag: entry.content_hash,
  };
}

class DropboxAdapter implements StorageAdapter {
  buildAuthUrl(params: {
    clientId: string;
    redirectUri: string;
    state: string;
  }): string {
    const query = new URLSearchParams({
      client_id: params.clientId,
      response_type: 'code',
      redirect_uri: params.redirectUri,
      state: params.state,
      token_access_type: 'offline',
    });
    // Dropbox does not support PKCE — omit code_challenge
    return `${AUTH_URL}?${query.toString()}`;
  }

  async exchangeCode(params: {
    code: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
  }): Promise<StorageToken> {
    const body = new URLSearchParams({
      code: params.code,
      grant_type: 'authorization_code',
      redirect_uri: params.redirectUri,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    });

    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!resp.ok) {
      const text = await resp.text();
      logger.error('Dropbox token exchange failed', { status: resp.status, body: text });
      throw new Error(`Token exchange failed: ${resp.status}`);
    }

    const data = await resp.json();
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in || 14400, // Dropbox short-lived tokens: 4 hours
    };
  }

  async refreshToken(params: {
    refreshToken: string;
    clientId: string;
    clientSecret: string;
  }): Promise<StorageToken> {
    const body = new URLSearchParams({
      refresh_token: params.refreshToken,
      grant_type: 'refresh_token',
      client_id: params.clientId,
      client_secret: params.clientSecret,
    });

    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!resp.ok) {
      const text = await resp.text();
      logger.error('Dropbox token refresh failed', { status: resp.status, body: text });
      throw new Error(`Token refresh failed: ${resp.status}`);
    }

    const data = await resp.json();
    return {
      access_token: data.access_token,
      refresh_token: params.refreshToken, // Dropbox keeps the same refresh token
      expires_in: data.expires_in || 14400,
    };
  }

  async testConnection(accessToken: string): Promise<{ displayName: string; email: string }> {
    const resp = await fetch(`${API_BASE}/users/get_current_account`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: 'null',
    });

    if (!resp.ok) throw new Error(`Connection test failed: ${resp.status}`);
    const data = await resp.json();
    return {
      displayName: data.name?.display_name || data.email,
      email: data.email,
    };
  }

  async listFolder(accessToken: string, folderId?: string): Promise<StorageItem[]> {
    const path = folderId || '';
    const resp = await fetch(`${API_BASE}/files/list_folder`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path, include_deleted: false, limit: 200 }),
    });

    if (!resp.ok) throw new Error(`List folder failed: ${resp.status}`);
    const data = await resp.json();
    return (data.entries || []).map(toStorageItem);
  }

  async getDelta(accessToken: string, deltaToken?: string): Promise<DeltaResult> {
    if (deltaToken) {
      // Continue from cursor
      let allItems: StorageItem[] = [];
      let cursor = deltaToken;
      let hasMore = true;
      const MAX_PAGES = 50;
      let pages = 0;

      while (hasMore && pages < MAX_PAGES) {
        const resp = await fetch(`${API_BASE}/files/list_folder/continue`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ cursor }),
          signal: AbortSignal.timeout(30000),
        });

        if (!resp.ok) throw new Error(`Delta continue failed: ${resp.status}`);
        const data: any = await resp.json();
        allItems = allItems.concat((data.entries || []).map(toStorageItem));
        cursor = data.cursor;
        hasMore = data.has_more;
        pages++;
      }

      return { items: allItems, deltaToken: cursor };
    }

    // Initial sync: get latest cursor without listing everything
    const resp = await fetch(`${API_BASE}/files/list_folder/get_latest_cursor`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: '', recursive: true, include_deleted: true }),
    });

    if (!resp.ok) throw new Error(`Get latest cursor failed: ${resp.status}`);
    const data = await resp.json();
    return { items: [], deltaToken: data.cursor };
  }

  async listFolderFiles(accessToken: string, folderId: string): Promise<StorageItem[]> {
    let allItems: StorageItem[] = [];
    let cursor: string | undefined;
    let hasMore = true;

    // Initial request
    const resp = await fetch(`${API_BASE}/files/list_folder`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: folderId, include_deleted: false, limit: 200 }),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) throw new Error(`List folder files failed: ${resp.status}`);
    const data: any = await resp.json();
    allItems = allItems.concat((data.entries || []).map(toStorageItem));
    cursor = data.cursor;
    hasMore = data.has_more;

    // Paginate
    while (hasMore && cursor) {
      const contResp = await fetch(`${API_BASE}/files/list_folder/continue`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cursor }),
        signal: AbortSignal.timeout(30000),
      });

      if (!contResp.ok) throw new Error(`List folder continue failed: ${contResp.status}`);
      const contData: any = await contResp.json();
      allItems = allItems.concat((contData.entries || []).map(toStorageItem));
      cursor = contData.cursor;
      hasMore = contData.has_more;
    }

    return allItems;
  }

  async downloadFile(accessToken: string, itemId: string): Promise<Buffer> {
    // itemId for Dropbox is the path or id — use path_or_id format
    const apiArg = JSON.stringify({ path: itemId });

    const resp = await fetch(`${CONTENT_BASE}/files/download`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Dropbox-API-Arg': apiArg,
      },
    });

    if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
    const arrayBuffer = await resp.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  getScopes(): string {
    return 'files.metadata.read files.content.read account_info.read';
  }
}

export const dropboxAdapter: StorageAdapter = new DropboxAdapter();
