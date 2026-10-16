import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import http from 'node:http';
import { config } from '../../config';

// Headers to strip from proxied response (added by Helmet/Fastify, not relevant for MCP)
const STRIP_HEADERS = new Set([
  'content-security-policy',
  'content-security-policy-report-only',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'origin-agent-cluster',
  'referrer-policy',
  'strict-transport-security',
  'x-content-type-options',
  'x-dns-prefetch-control',
  'x-download-options',
  'x-frame-options',
  'x-permitted-cross-domain-policies',
  'x-xss-protection',
  'x-powered-by',
]);

/**
 * Reverse-proxy /mcp requests to the local MCP HTTP server on port 3100.
 */
export async function mcpProxyRoutes(fastify: FastifyInstance) {
  const MCP_PORT = 3100;

  // Collect raw body as a Buffer instead of JSON-parsing it
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser(
    '*',
    { parseAs: 'buffer' },
    (_req: FastifyRequest, body: Buffer, done: (err: null, body: Buffer) => void) => {
      done(null, body);
    },
  );

  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      reply.raw.writeHead(204, {
        'access-control-allow-origin': config.CORS_ORIGIN,
        'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
        'access-control-allow-headers': 'Content-Type, Accept, Mcp-Session-Id, Authorization',
        'access-control-expose-headers': 'Mcp-Session-Id',
      });
      reply.raw.end();
      reply.hijack();
      return;
    }

    const headers: Record<string, string> = {};
    if (request.headers['content-type']) {
      headers['content-type'] = request.headers['content-type'] as string;
    }
    if (request.headers['accept']) {
      headers['accept'] = request.headers['accept'] as string;
    }
    if (request.headers['mcp-session-id']) {
      headers['mcp-session-id'] = request.headers['mcp-session-id'] as string;
    }
    if (request.headers['authorization']) {
      headers['authorization'] = request.headers['authorization'] as string;
    }
    // the visitor's address as this server worked it out (utils/trustProxy.ts) — the MCP server
    // trusts this loopback hop, so its req.ip is the visitor, not 127.0.0.1
    headers['x-forwarded-for'] = request.ip;

    const body = request.body as Buffer | undefined;
    if (body && body.length > 0) {
      headers['content-length'] = String(body.length);
    }

    // Hijack the reply so Fastify doesn't try to add headers after we write them
    reply.hijack();

    return new Promise<void>((resolve) => {
      const proxyReq = http.request(
        {
          hostname: '127.0.0.1',
          port: MCP_PORT,
          path: '/mcp',
          method: request.method,
          headers,
        },
        (proxyRes) => {
          // Build clean response headers: keep MCP headers, strip Helmet headers
          const responseHeaders: Record<string, string | string[]> = {
            'access-control-allow-origin': config.CORS_ORIGIN,
            'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
            'access-control-allow-headers': 'Content-Type, Accept, Mcp-Session-Id, Authorization',
            'access-control-expose-headers': 'Mcp-Session-Id',
          };
          for (const [key, value] of Object.entries(proxyRes.headers)) {
            if (value && !STRIP_HEADERS.has(key.toLowerCase())) {
              responseHeaders[key] = value as string | string[];
            }
          }
          reply.raw.writeHead(proxyRes.statusCode || 502, responseHeaders);
          proxyRes.pipe(reply.raw, { end: true });
          proxyRes.on('end', resolve);
          proxyRes.on('error', () => resolve());
        },
      );

      proxyReq.on('error', (err) => {
        fastify.log.error(err, 'MCP proxy error');
        if (!reply.raw.headersSent) {
          reply.raw.writeHead(502, { 'content-type': 'application/json' });
          reply.raw.end(JSON.stringify({ error: 'MCP server unavailable' }));
        }
        resolve();
      });

      if (body && body.length > 0) {
        proxyReq.end(body);
      } else {
        proxyReq.end();
      }
    });
  };

  fastify.all('/', handler);
}
