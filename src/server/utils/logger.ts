import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { getRequestId } from '../middleware/requestContext';

// ---------------------------------------------------------------------------
// PII Masking
// ---------------------------------------------------------------------------

/** Mask an email address: `user@example.com` -> `u***@e***.com` */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***@***';
  const domainParts = domain.split('.');
  const tld = domainParts.pop() || '';
  const domainName = domainParts.join('.');
  return `${local[0]}***@${domainName[0]}***.${tld}`;
}

/** PII patterns applied to string values in log output */
const PII_PATTERNS: Array<{ regex: RegExp; replacer: (match: string) => string }> = [
  // Email addresses
  { regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacer: maskEmail },
  // JWT tokens (eyJ...)
  { regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, replacer: () => '[JWT_REDACTED]' },
  // API keys / Bearer tokens (long base64/hex strings, 32+ chars)
  { regex: /\b[A-Za-z0-9/+]{32,}={0,2}\b/g, replacer: (m) => `${m.slice(0, 8)}***[KEY_REDACTED]` },
  // Password field values in JSON-like strings
  { regex: /"password"\s*:\s*"[^"]*"/gi, replacer: () => '"password":"[REDACTED]"' },
];

/**
 * Recursively mask PII in a value. Handles strings, objects, arrays, and Error instances.
 */
export function maskPii(value: unknown): unknown {
  if (typeof value === 'string') {
    let result = value;
    for (const { regex, replacer } of PII_PATTERNS) {
      result = result.replace(regex, replacer as (substring: string, ...args: unknown[]) => string);
    }
    return result;
  }
  if (value instanceof Error) {
    const masked = new Error(maskPii(value.message) as string);
    masked.name = value.name;
    if (value.stack) masked.stack = maskPii(value.stack) as string;
    return masked;
  }
  if (Array.isArray(value)) {
    return value.map(maskPii);
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = maskPii(v);
    }
    return result;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Winston Formats
// ---------------------------------------------------------------------------

const addRequestId = winston.format((info) => {
  const requestId = getRequestId();
  if (requestId) {
    info.requestId = requestId;
  }
  return info;
});

const piiMask = winston.format((info) => {
  if (info.message) info.message = maskPii(info.message) as string;
  // Mask any extra metadata fields (spread into the info object)
  for (const key of Object.keys(info)) {
    if (key === 'level' || key === 'timestamp' || key === 'service' || key === 'requestId') continue;
    if (key !== 'message') {
      info[key] = maskPii(info[key]);
    }
  }
  return info;
});

// Rotating file transport — keeps 14 days, max 20MB per file
const rotateTransport = new DailyRotateFile({
  filename: 'logs/app-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '14d',
  zippedArchive: true,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    addRequestId(),
    piiMask(),
    winston.format.json(),
  ),
});

const errorRotateTransport = new DailyRotateFile({
  filename: 'logs/error-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  level: 'error',
  maxSize: '20m',
  maxFiles: '30d',
  zippedArchive: true,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    addRequestId(),
    piiMask(),
    winston.format.json(),
  ),
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    addRequestId(),
    piiMask(),
    winston.format.json()
  ),
  defaultMeta: { service: 'pm-assistant-generic' },
  transports: [
    rotateTransport,
    errorRotateTransport,
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
} else {
  // Production: also log to stdout so systemd/journalctl captures output
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    )
  }));
}

export const requestLogger = (request: any, reply: any, done: any) => {
  logger.info('Request received', {
    method: request.method,
    url: request.url,
    ip: request.ip,
    userAgent: request.headers['user-agent']
  });
  done();
};

export const responseLogger = (request: any, reply: any, done: any) => {
  const durationMs = Math.round(reply.elapsedTime || 0);
  logger.info('Response sent', {
    method: request.method,
    url: request.url,
    statusCode: reply.statusCode,
    durationMs,
    ip: request.ip,
  });
  done();
};

export const errorLogger = logger;
export const auditLogger = logger;
export default logger;
