import logger from '../../utils/logger';
import type { StorageAdapter, StorageToken, StorageItem, DeltaResult } from './StorageAdapter';

const AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://www.googleapis.com/drive/v3';

const MIME_MAP: Record<string, string> = {
  'application/vnd.google-apps.document': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
};

function toStorageItem(file: any): StorageItem {
  return {
    id: file.id,
    name: file.name,
    size: file.size ? Number(file.size) : undefined,
    mimeType: MIME_MAP[file.mimeType] || file.mimeType,
    isFolder: file.mimeType === 'application/vnd.google-apps.folder',
    childCount: undefined,
    parentPath: file.parents?.[0] ? `/${file.parents[0]}` : undefined,
    parentId: file.parents?.[0],
    lastModifiedDateTime: file.modifiedTime,
    deleted: file.trashed === true,
    eTag: file.md5Checksum || file.version,
  };
}

class GoogleDriveAdapter implements StorageAdapter {
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
      access_type: 'offline',
      prompt: 'consent',
    });
    if (params.codeChallenge) {
      query.set('code_challenge', params.codeChallenge);
      query.set('code_challenge_method', 'S256');
    }
    return `${AUTH_BASE}?${query.toString()}`;
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

    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!resp.ok) {
      const text = await resp.text();
      logger.error('Google Drive token exchange failed', { status: resp.status, body: text });
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

    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!resp.ok) {
      const text = await resp.text();
      logger.error('Google Drive token refresh failed', { status: resp.status, body: text });
      throw new Error(`Token refresh failed: ${resp.status}`);
    }

    const data = await resp.json();
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token || params.refreshToken, // Google may not return refresh_token on refresh
      expires_in: data.expires_in,
    };
  }

  async testConnection(accessToken: string): Promise<{ displayName: string; email: string }> {
    const resp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) throw new Error(`Connection test failed: ${resp.status}`);
    const data = await resp.json();
    return { displayName: data.name || data.email, email: data.email };
  }

  async listFolder(accessToken: string, folderId?: string): Promise<StorageItem[]> {
    const parent = folderId || 'root';
    const q = encodeURIComponent(`'${parent}' in parents and trashed = false`);
    const fields = encodeURIComponent('files(id,name,size,mimeType,parents,modifiedTime,md5Checksum,version),nextPageToken');
    const url = `${API_BASE}/files?q=${q}&fields=${fields}&pageSize=200`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) throw new Error(`List folder failed: ${resp.status}`);
    const data = await resp.json();
    return (data.files || []).map(toStorageItem);
  }

  async getDelta(accessToken: string, deltaToken?: string): Promise<DeltaResult> {
    let startPageToken: string;

    if (deltaToken) {
      // deltaToken is the saved pageToken from last sync
      startPageToken = deltaToken;
    } else {
      // Get initial start token
      const tokenResp = await fetch(`${API_BASE}/changes/startPageToken`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!tokenResp.ok) throw new Error(`Failed to get start page token: ${tokenResp.status}`);
      const tokenData = await tokenResp.json();
      startPageToken = tokenData.startPageToken;

      // On first sync, return empty — caller should use listFolderFiles instead
      return { items: [], deltaToken: startPageToken };
    }

    let allItems: StorageItem[] = [];
    let currentPageToken: string | undefined = startPageToken;
    let newStartPageToken: string | undefined;
    const MAX_PAGES = 50;
    let pages = 0;

    while (currentPageToken && pages < MAX_PAGES) {
      const fields = encodeURIComponent('changes(file(id,name,size,mimeType,parents,modifiedTime,trashed,md5Checksum,version),removed,fileId),nextPageToken,newStartPageToken');
      const url = `${API_BASE}/changes?pageToken=${currentPageToken}&fields=${fields}&pageSize=200`;

      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(30000),
      });

      if (!resp.ok) throw new Error(`Changes query failed: ${resp.status}`);
      const data: any = await resp.json();

      for (const change of (data.changes || [])) {
        if (change.removed) {
          allItems.push({
            id: change.fileId,
            name: '',
            isFolder: false,
            deleted: true,
          });
        } else if (change.file) {
          allItems.push(toStorageItem(change.file));
        }
      }

      currentPageToken = data.nextPageToken;
      if (data.newStartPageToken) {
        newStartPageToken = data.newStartPageToken;
      }
      pages++;
    }

    return { items: allItems, deltaToken: newStartPageToken || startPageToken };
  }

  async listFolderFiles(accessToken: string, folderId: string): Promise<StorageItem[]> {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const fields = encodeURIComponent('files(id,name,size,mimeType,parents,modifiedTime,md5Checksum,version),nextPageToken');
    let url: string | undefined = `${API_BASE}/files?q=${q}&fields=${fields}&pageSize=200`;
    let allItems: StorageItem[] = [];

    while (url) {
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(30000),
      });

      if (!resp.ok) throw new Error(`List folder files failed: ${resp.status}`);
      const data: any = await resp.json();
      allItems = allItems.concat((data.files || []).map(toStorageItem));
      url = data.nextPageToken
        ? `${API_BASE}/files?q=${q}&fields=${fields}&pageSize=200&pageToken=${data.nextPageToken}`
        : undefined;
    }

    return allItems;
  }

  async downloadFile(accessToken: string, itemId: string): Promise<Buffer> {
    // Check if it's a Google Workspace file that needs export
    const metaResp = await fetch(`${API_BASE}/files/${itemId}?fields=mimeType`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!metaResp.ok) throw new Error(`File metadata failed: ${metaResp.status}`);
    const meta = await metaResp.json();

    let url: string;
    if (MIME_MAP[meta.mimeType]) {
      // Export Google Workspace file
      url = `${API_BASE}/files/${itemId}/export?mimeType=${encodeURIComponent(MIME_MAP[meta.mimeType])}`;
    } else {
      url = `${API_BASE}/files/${itemId}?alt=media`;
    }

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
    const arrayBuffer = await resp.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  getScopes(): string {
    return 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';
  }
}

export const googleDriveAdapter: StorageAdapter = new GoogleDriveAdapter();
