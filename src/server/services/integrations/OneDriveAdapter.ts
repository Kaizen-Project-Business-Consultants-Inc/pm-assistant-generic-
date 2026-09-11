import logger from '../../utils/logger';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const AUTH_BASE = 'https://login.microsoftonline.com/common/oauth2/v2.0';

export interface OneDriveToken {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface DriveItem {
  id: string;
  name: string;
  size?: number;
  file?: { mimeType: string };
  folder?: { childCount: number };
  parentReference?: { path: string; id: string };
  lastModifiedDateTime?: string;
  deleted?: Record<string, unknown>;
  eTag?: string;
}

export interface DeltaResponse {
  value: DriveItem[];
  '@odata.deltaLink'?: string;
  '@odata.nextLink'?: string;
}

class OneDriveAdapter {
  async exchangeCodeForTokens(
    code: string,
    redirectUri: string,
    clientId: string,
    clientSecret: string,
    codeVerifier: string,
  ): Promise<OneDriveToken> {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    });

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

    return resp.json() as Promise<OneDriveToken>;
  }

  async refreshAccessToken(
    refreshToken: string,
    clientId: string,
    clientSecret: string,
  ): Promise<OneDriveToken> {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
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

    return resp.json() as Promise<OneDriveToken>;
  }

  async testConnection(accessToken: string): Promise<{ displayName: string; mail: string }> {
    const resp = await fetch(`${GRAPH_BASE}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) throw new Error(`Connection test failed: ${resp.status}`);
    const data = await resp.json();
    return { displayName: data.displayName, mail: data.mail || data.userPrincipalName };
  }

  async listFolder(accessToken: string, folderId?: string): Promise<DriveItem[]> {
    const path = folderId
      ? `${GRAPH_BASE}/me/drive/items/${folderId}/children`
      : `${GRAPH_BASE}/me/drive/root/children`;

    const resp = await fetch(`${path}?$select=id,name,size,file,folder,parentReference`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) throw new Error(`List folder failed: ${resp.status}`);
    const data = await resp.json();
    return data.value as DriveItem[];
  }

  async getDelta(accessToken: string, deltaLink?: string): Promise<DeltaResponse> {
    const url = deltaLink || `${GRAPH_BASE}/me/drive/root/delta?$select=id,name,size,file,folder,parentReference,lastModifiedDateTime,deleted,eTag`;

    let allItems: DriveItem[] = [];
    let currentUrl: string | undefined = url;
    let finalDeltaLink: string | undefined;
    const MAX_PAGES = 50; // Safety cap — don't paginate forever on huge drives
    let pages = 0;

    while (currentUrl && pages < MAX_PAGES) {
      const resp: Response = await fetch(currentUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(30000), // 30s per page
      });

      if (!resp.ok) throw new Error(`Delta query failed: ${resp.status}`);
      const data: any = await resp.json();
      allItems = allItems.concat(data.value || []);
      currentUrl = data['@odata.nextLink'] as string | undefined;
      if (data['@odata.deltaLink']) {
        finalDeltaLink = data['@odata.deltaLink'];
      }
      pages++;
    }

    if (currentUrl && pages >= MAX_PAGES) {
      logger.warn('Delta pagination capped', { pages, items: allItems.length });
    }

    return {
      value: allItems,
      '@odata.deltaLink': finalDeltaLink,
    };
  }

  /**
   * List all files in a specific folder (non-recursive).
   * Used as an alternative to delta for targeted folder sync.
   */
  async listFolderFiles(accessToken: string, folderId: string): Promise<DriveItem[]> {
    const url = `${GRAPH_BASE}/me/drive/items/${folderId}/children?$select=id,name,size,file,folder,parentReference,lastModifiedDateTime,eTag&$top=200`;
    let allItems: DriveItem[] = [];
    let currentUrl: string | undefined = url;

    while (currentUrl) {
      const resp: Response = await fetch(currentUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(30000),
      });

      if (!resp.ok) throw new Error(`List folder files failed: ${resp.status}`);
      const data: any = await resp.json();
      allItems = allItems.concat(data.value || []);
      currentUrl = data['@odata.nextLink'] as string | undefined;
    }

    return allItems;
  }

  async downloadFile(accessToken: string, itemId: string): Promise<Buffer> {
    const resp = await fetch(`${GRAPH_BASE}/me/drive/items/${itemId}/content`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: 'follow',
    });

    if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
    const arrayBuffer = await resp.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}

export const oneDriveAdapter = new OneDriveAdapter();
