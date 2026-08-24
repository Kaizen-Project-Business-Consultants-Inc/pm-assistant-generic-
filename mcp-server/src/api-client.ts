const BASE_URL = (process.env.PM_BASE_URL || 'https://kovarti.com').replace(/\/$/, '');

export interface ApiClient {
  get: (path: string) => Promise<unknown>;
  post: (path: string, body?: unknown) => Promise<unknown>;
  put: (path: string, body?: unknown) => Promise<unknown>;
  delete: (path: string) => Promise<unknown>;
}

function makeRequest(apiKey: string) {
  return async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${BASE_URL}/api/v1${path}`;
    const reqHeaders: Record<string, string> = {
      'Authorization': `Bearer ${apiKey}`,
    };
    if (body !== undefined) {
      reqHeaders['Content-Type'] = 'application/json';
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: reqHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err?.name === 'AbortError') {
        throw new Error(`API ${method} ${path} → timeout after 30s`);
      }
      throw err;
    }
    clearTimeout(timeoutId);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API ${method} ${path} → ${res.status}: ${text}`);
    }
    return res.json();
  };
}

/**
 * Create an API client bound to a specific API key.
 */
export function createApiClient(apiKey: string): ApiClient {
  const request = makeRequest(apiKey);
  return {
    get: (path: string) => request('GET', path),
    post: (path: string, body?: unknown) => request('POST', path, body),
    put: (path: string, body?: unknown) => request('PUT', path, body),
    delete: (path: string) => request('DELETE', path),
  };
}

/**
 * Default singleton client using PM_API_KEY env var (for stdio mode).
 */
const defaultKey = process.env.PM_API_KEY || '';
export const api: ApiClient = createApiClient(defaultKey);

/**
 * Get an API client from the MCP tool's `extra` context.
 * In HTTP/OAuth mode, uses the per-user API key from authInfo.
 * Falls back to the default PM_API_KEY for stdio mode.
 */
export function getApiClientFromExtra(extra: Record<string, unknown>): ApiClient {
  const authInfo = extra?.authInfo as { extra?: { apiKey?: string } } | undefined;
  const perUserKey = authInfo?.extra?.apiKey;
  if (perUserKey && typeof perUserKey === 'string') {
    return createApiClient(perUserKey);
  }
  // Fallback: default api client (stdio mode)
  return api;
}

export function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}
