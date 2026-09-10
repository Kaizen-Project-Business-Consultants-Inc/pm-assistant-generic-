import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';

export async function securityMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  reply.header('X-Robots-Tag', 'noindex, nofollow');
  reply.header('X-Download-Options', 'noopen');
  reply.header('X-Permitted-Cross-Domain-Policies', 'none');

  if (request.url.includes('/api/auth/') || request.url.includes('/api/users/')) {
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    reply.header('Pragma', 'no-cache');
    reply.header('Expires', '0');
  }

  if (request.url.startsWith('/api/')) {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '1; mode=block');
    // CORS headers are handled by @fastify/cors plugin — do not duplicate here
  }
}

export async function securityValidationMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const contentLength = parseInt(request.headers['content-length'] || '0');
  const maxSize = 10 * 1024 * 1024; // 10MB

  if (contentLength > maxSize) {
    reply.code(413).send({ error: 'Request too large' });
    return;
  }

  if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
    const contentType = request.headers['content-type'];
    const bodyLength = parseInt(request.headers['content-length'] || '0');
    // Only enforce Content-Type when request has a body
    if (bodyLength > 0 && (!contentType || (!contentType.includes('application/json') && !contentType.includes('multipart/form-data')))) {
      reply.code(400).send({ error: 'Invalid content type' });
      return;
    }
  }

  const requestId = `req-${crypto.randomUUID()}`;
  request.headers['x-request-id'] = requestId;
  reply.header('X-Request-ID', requestId);
}
