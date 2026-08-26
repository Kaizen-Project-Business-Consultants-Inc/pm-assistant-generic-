import path from 'path';
import { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import rawBody from 'fastify-raw-body';
import { config } from './config';
import logger, { requestLogger, responseLogger } from './utils/logger';
import { toCamelCaseKeys } from './utils/caseConverter';
import { auditService } from './services/auditService';
import { databaseService } from './database/connection';
import jwt from 'jsonwebtoken';
import { securityMiddleware, securityValidationMiddleware } from './middleware/securityMiddleware';
import { requestContextHook } from './middleware/requestContext';
import { tenantResolverHook } from './middleware/tenantResolver';
import { rateLimiter } from './middleware/rateLimiter';
import { apiKeyService } from './services/ApiKeyService';
import { metricsService } from './services/MetricsService';
import { requireActiveSubscription } from './middleware/requireSubscription';
import type { JwtPayload } from './types/fastify';

// Standard HTTP status text for error response normalization
const HTTP_STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  405: 'Method Not Allowed', 409: 'Conflict', 413: 'Payload Too Large',
  422: 'Unprocessable Entity', 429: 'Too Many Requests',
  500: 'Internal Server Error', 502: 'Bad Gateway',
  503: 'Service Unavailable', 504: 'Gateway Timeout',
};

export async function registerPlugins(fastify: FastifyInstance) {
  await fastify.register(compress, {
    threshold: 1024,           // Only compress responses >= 1 KB
    encodings: ['gzip', 'deflate'],  // brotli excluded — too CPU-heavy for 1-OCPU VM
  });
  await fastify.register(websocket);
  await fastify.register(rawBody, { field: 'rawBody', global: false, runFirst: true });
  await fastify.register(multipart, { limits: { fileSize: config.MAX_UPLOAD_SIZE_MB * 1024 * 1024 } });

  fastify.addHook('onRequest', requestLogger);
  fastify.addHook('onRequest', securityMiddleware);
  fastify.addHook('preHandler', securityValidationMiddleware);

  // Early JWT resolution — populates request.user from cookie before tenant resolver.
  // Does NOT fail on missing/invalid tokens (route-level authMiddleware handles enforcement).
  fastify.addHook('preHandler', async (request) => {
    if (request.user) return; // Already set by API key hook
    try {
      const token = request.cookies?.access_token;
      if (!token) return;
      const decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload;
      request.user = { userId: decoded.userId, username: decoded.username, role: decoded.role };
    } catch {
      // Silently ignore — route-level authMiddleware will enforce auth
    }
  });

  // Request context must run after securityValidationMiddleware (which sets x-request-id)
  fastify.addHook('preHandler', requestContextHook);
  // Tenant resolver must run after requestContextHook (needs userId in context)
  fastify.addHook('preHandler', tenantResolverHook);

  // Subscription gating — block write operations for expired trials / unpaid users
  // Exempt paths: auth, stripe, portal (public), websocket, waitlist, MCP, and read-only GET/OPTIONS/HEAD
  const SUBSCRIPTION_EXEMPT_PREFIXES = [
    '/api/v1/auth',
    '/api/v1/stripe',
    '/api/v1/portal',
    '/api/v1/ws',
    '/api/v1/waitlist',
    '/api/v1/users/me/profile',
    '/api/v1/nl-query',
    '/api/v1/meeting-intelligence/analyze',
    '/mcp',
  ];
  fastify.addHook('preHandler', async (request, reply) => {
    // Only gate write methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    // Skip non-API routes
    if (!request.url.startsWith('/api/') && !request.url.startsWith('/mcp')) return;
    // Skip exempt paths
    for (const prefix of SUBSCRIPTION_EXEMPT_PREFIXES) {
      if (request.url.startsWith(prefix)) return;
    }
    // Skip if no user (authMiddleware will handle 401)
    if (!request.user) return;
    await requireActiveSubscription(request, reply);
  });

  if (config.METRICS_ENABLED) {
    fastify.addHook('onRequest', async () => { metricsService.incrementActiveRequests(); });
    fastify.addHook('onResponse', async (request, reply) => {
      metricsService.decrementActiveRequests();
      const durationMs = Math.round(reply.elapsedTime || 0);
      metricsService.recordRequest(request.method, request.url, reply.statusCode, durationMs);
    });
  }

  // Server-Timing header — exposes processing time to browser Performance API
  fastify.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      const ms = reply.elapsedTime?.toFixed(1) ?? '0';
      reply.header('Server-Timing', `total;dur=${ms}`);
    }
  });

  fastify.addHook('onResponse', responseLogger);

  // Normalize DB snake_case keys to camelCase in JSON API responses only
  fastify.addHook('preSerialization', async (request, _reply, payload) => {
    if (request.url.startsWith('/api/') && payload && typeof payload === 'object') {
      return toCamelCaseKeys(payload);
    }
    return payload;
  });

  // Normalize all API error responses to a standard format:
  // { statusCode, error, message, timestamp, path, ...extras }
  fastify.addHook('onSend', async (request, reply, payload) => {
    if (reply.statusCode < 400 || !request.url.startsWith('/api/')) return payload;
    if (typeof payload !== 'string') return payload;

    let body: Record<string, unknown>;
    try { body = JSON.parse(payload); } catch { return payload; }

    // Already normalized (has all required fields from global error handler or not-found handler)
    if (body.statusCode && body.error && body.message && body.timestamp && body.path) return payload;

    const statusCode = reply.statusCode;
    const statusText = HTTP_STATUS_TEXT[statusCode] || 'Error';

    const normalized: Record<string, unknown> = {
      statusCode,
      error: typeof body.error === 'string' ? body.error : statusText,
      message: typeof body.message === 'string' ? body.message : (typeof body.error === 'string' ? body.error : statusText),
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    // Preserve optional fields from route-level responses
    if (body.details !== undefined) normalized.details = body.details;
    if (body.retryAfter !== undefined) normalized.retryAfter = body.retryAfter;
    if (body.retryAfterMs !== undefined) normalized.retryAfterMs = body.retryAfterMs;
    if (body.code !== undefined) normalized.code = body.code;
    if (body.resetDate !== undefined) normalized.resetDate = body.resetDate;
    if (body.used !== undefined) normalized.used = body.used;
    if (body.budget !== undefined) normalized.budget = body.budget;

    return JSON.stringify(normalized);
  });

  // Global API key resolution — sets apiKeyId on request for all API routes (even those without authMiddleware)
  fastify.addHook('onRequest', async (request) => {
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ') && (request.url.startsWith('/api/') || request.url.startsWith('/mcp'))) {
      try {
        const keyInfo = await apiKeyService.validateKey(authHeader.slice(7));
        if (keyInfo) {
          request.apiKeyId = keyInfo.keyId;
          request.apiKeyScopes = keyInfo.scopes;
          request.apiKeyRateLimit = keyInfo.rateLimit;
          // Also set user if not already set (for routes without authMiddleware)
          if (!request.user) {
            request.user = {
              userId: keyInfo.userId,
              username: 'api-key',
              role: keyInfo.userRole,
            };
          }
        }
      } catch {
        // Silently fail — route-level authMiddleware will handle auth errors
      }
    }
  });

  // Rate limiting for API key requests — runs after API key resolution hook above
  fastify.addHook('onRequest', async (request, reply) => {
    const apiKeyId = request.apiKeyId;
    if (apiKeyId && (request.url.startsWith('/api/') || request.url.startsWith('/mcp'))) {
      const limit = request.apiKeyRateLimit || 100;
      const result = rateLimiter.check(apiKeyId, limit);
      reply.header('X-RateLimit-Limit', String(limit));
      reply.header('X-RateLimit-Remaining', String(result.remaining));
      reply.header('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));
      if (!result.allowed) {
        return reply.status(429).send({
          error: 'Rate limit exceeded',
          retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
        });
      }
    }
  });

  // Log API key usage on response
  fastify.addHook('onResponse', async (request, reply) => {
    const apiKeyId = request.apiKeyId;
    if (apiKeyId) {
      const responseTime = Math.round(reply.elapsedTime || 0);
      const ip = request.ip || '';
      apiKeyService.logUsage(apiKeyId, request.method, request.url, reply.statusCode, responseTime, ip);
    }
  });

  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        scriptSrc: [
          "'self'",
          // Inline gtag script hash (see index.html)
          "'sha256-eCGAeUSA/USJdg+UP79N3fM7LLrSz53WdyTKf6QZipw='",
          "https://www.googletagmanager.com",
          ...(config.NODE_ENV === 'development' ? ["'unsafe-eval'", "'unsafe-inline'"] : [])
        ],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: [
          "'self'",
          "https://www.google-analytics.com",
          "https://www.googletagmanager.com",
          ...(config.NODE_ENV === 'development' ? [
            "http://localhost:3001", "ws://localhost:3001", "wss://localhost:3001"
          ] : [
            "wss:",
          ])
        ],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        objectSrc: ["'none'"],
        frameSrc: ["'self'", "https://checkout.stripe.com", "https://js.stripe.com"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    hsts: config.NODE_ENV === 'production' ? {
      maxAge: 31536000, includeSubDomains: true, preload: true
    } : false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hidePoweredBy: true,
  });

  await fastify.register(cors, {
    origin: (origin, callback) => {
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
      callback(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'x-user-role', 'x-user-id', 'x-admin-key', 'Mcp-Session-Id'],
    exposedHeaders: ['Mcp-Session-Id', 'Server-Timing'],
  });

  await fastify.register(cookie, {
    secret: config.COOKIE_SECRET,
    parseOptions: {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'lax',
    },
  });

  await fastify.register(swagger, {
    swagger: {
      info: {
        title: 'Kovarti PM Assistant API',
        description: 'AI-Powered Project Management API',
        version: '1.0.0',
      },
      host: `${config.HOST}:${config.PORT}`,
      schemes: ['http', 'https'],
      consumes: ['application/json'],
      produces: ['application/json'],
      securityDefinitions: {
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'access_token' },
        bearerAuth: { type: 'apiKey', in: 'header', name: 'Authorization', description: 'Bearer <api-key>' },
      },
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/documentation',
    uiConfig: { docExpansion: 'list', deepLinking: false },
    staticCSP: true,
    transformSpecificationClone: true,
  });

  fastify.setErrorHandler(async (err: unknown, request, reply) => {
    const error = err instanceof Error ? err : new Error(String(err));
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    logger.error('Global error handler', { errorName: error.name, errorMessage: error.message });

    auditService.logSystemEvent(request, 'error', {
      error: error.message, url: request.url, method: request.method
    });

    const response: Record<string, unknown> = {
      statusCode,
      error: statusCode === 500 ? 'Internal Server Error' : error.name || 'Error',
      message: statusCode === 500 ? 'Internal Server Error' : error.message,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    // Preserve structured error fields (code, resetDate, etc.)
    const errAny = error as unknown as Record<string, unknown>;
    if (errAny.code) response.code = errAny.code;
    if (errAny.resetDate) response.resetDate = errAny.resetDate;
    if (errAny.used !== undefined) response.used = errAny.used;
    if (errAny.budget !== undefined) response.budget = errAny.budget;

    return reply.status(statusCode).send(response);
  });

  // Serve static client build in production (Nginx serves these directly, this is a fallback)
  if (config.NODE_ENV === 'production') {
    // On server: /opt/pm-app/client-dist/  (deploy.sh puts client build there)
    // Locally: src/client/dist/
    const candidates = [
      path.resolve('/opt/pm-app/client-dist'),
      path.join(__dirname, '..', '..', 'src', 'client', 'dist'),
      path.join(__dirname, '..', 'client'),
    ];
    const fs = await import('fs');
    const clientDistPath = candidates.find(p => fs.existsSync(p)) || candidates[0];
    await fastify.register(fastifyStatic, {
      root: clientDistPath,
      prefix: '/',
      wildcard: false,
    });

    // SPA fallback: serve index.html for non-API routes
    fastify.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/') || request.url.startsWith('/documentation')) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `Route ${request.method}:${request.url} not found`,
          timestamp: new Date().toISOString()
        });
      } else {
        return reply.sendFile('index.html');
      }
    });
  } else {
    fastify.setNotFoundHandler(async (request, reply) => {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `Route ${request.method}:${request.url} not found`,
        timestamp: new Date().toISOString()
      });
    });
  }

  fastify.get('/health', async (_request, reply) => {
    // Database check
    let dbStatus = 'OK';
    let dbResponseTimeMs = 0;
    try {
      const start = Date.now();
      const connected = await databaseService.testConnection();
      dbResponseTimeMs = Date.now() - start;
      if (!connected) dbStatus = 'FAIL';
    } catch {
      dbStatus = 'FAIL';
    }

    // Memory check
    const mem = process.memoryUsage();
    const rssInMb = Math.round((mem.rss / 1024 / 1024) * 10) / 10;
    const heapUsedInMb = Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10;
    const heapTotalInMb = Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10;
    const memStatus = heapTotalInMb > 0 && (heapUsedInMb / heapTotalInMb) > 0.9 ? 'WARN' : 'OK';

    // Overall status
    const overallStatus = dbStatus === 'OK' ? 'OK' : 'DEGRADED';
    const httpStatus = overallStatus === 'OK' ? 200 : 503;

    return reply.status(httpStatus).send({
      status: overallStatus,
      service: 'Kovarti PM Assistant Generic',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: config.NODE_ENV,
      checks: {
        database: { status: dbStatus, responseTimeMs: dbResponseTimeMs },
        memory: { status: memStatus, rssInMb, heapUsedInMb, heapTotalInMb }
      }
    });
  });
}
