import { config } from '../config';

/**
 * Which websites may call the API from a browser (@fastify/cors `origin`): the app's own site
 * (http or https), the Vite dev server outside production, and Claude (claude.ai / anthropic.com,
 * for the /mcp endpoint). Anything else is refused with 403 and a plain message — it answered 500
 * and was logged as a server error until 2026-10-19.
 */
export function corsOrigin(origin: string | undefined, callback: (err: Error | null, allow: boolean) => void): void {
  if (!origin) return callback(null, true);
  if (config.NODE_ENV !== 'production' && (origin === 'http://localhost:5173' || origin === 'https://localhost:5173')) {
    return callback(null, true);
  }
  // Accept both http and https variants of the configured origin
  const corsHost = config.CORS_ORIGIN.replace(/^https?:\/\//, '');
  const originHost = origin.replace(/^https?:\/\//, '');
  if (originHost === corsHost) return callback(null, true);
  // Allow Anthropic/Claude domains to access the /mcp endpoint
  if (originHost === 'claude.ai' || originHost.endsWith('.anthropic.com') || originHost.endsWith('.claude.ai')) {
    return callback(null, true);
  }
  callback(Object.assign(new Error("This website isn't allowed to use Kovarti's API."), { statusCode: 403, code: 'CORS_REFUSED' }), false);
}
