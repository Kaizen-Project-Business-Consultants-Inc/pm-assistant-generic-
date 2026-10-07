import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

import { isPlatformAdmin } from '../../utils/platformAdmin';
import { clampPagination } from '../../schemas/paginationSchema';
export async function logsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /api/v1/admin/logs — query structured logs
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user;
    if (!isPlatformAdmin(user)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' });
    }

    const query = request.query as {
      level?: string;
      search?: string;
      date?: string;
      limit?: string;
    };

    const level = query.level; // filter by log level
    const search = query.search; // free-text search in message
    const date = query.date || new Date().toISOString().substring(0, 10); // YYYY-MM-DD
    // text or a negative number falls back to the default instead of breaking (2026-10-07)
    const { limit } = clampPagination(query, { defaultLimit: 200, maxLimit: 1000 });

    const logFile = path.resolve(`logs/app-${date}.log`);

    if (!fs.existsSync(logFile)) {
      return { entries: [], total: 0, date, message: 'No log file for this date' };
    }

    const entries: any[] = [];

    const fileStream = fs.createReadStream(logFile, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;

      try {
        const entry = JSON.parse(line);

        if (level && entry.level !== level) continue;
        if (search && !JSON.stringify(entry).toLowerCase().includes(search.toLowerCase())) continue;

        entries.push(entry);

        if (entries.length >= limit) break;
      } catch {
        // skip malformed lines
      }
    }

    return { entries, total: entries.length, date };
  });

  // GET /api/v1/admin/logs/files — list available log files
  fastify.get('/files', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user;
    if (!isPlatformAdmin(user)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' });
    }

    const logsDir = path.resolve('logs');
    if (!fs.existsSync(logsDir)) {
      return { files: [] };
    }

    const files = fs.readdirSync(logsDir)
      .filter(f => f.endsWith('.log') || f.endsWith('.log.gz'))
      .map(f => {
        const stat = fs.statSync(path.join(logsDir, f));
        return { name: f, sizeBytes: stat.size, modified: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));

    return { files };
  });

  // GET /api/v1/admin/logs/download/:filename — download a log file
  fastify.get('/download/:filename', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user;
    if (!isPlatformAdmin(user)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' });
    }

    const { filename } = request.params as { filename: string };

    // Sanitize filename to prevent path traversal
    const sanitized = path.basename(filename);
    if (sanitized !== filename || (!sanitized.endsWith('.log') && !sanitized.endsWith('.log.gz'))) {
      return reply.status(400).send({ error: 'Invalid filename' });
    }

    const filePath = path.resolve('logs', sanitized);
    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({ error: 'File not found' });
    }

    const contentType = sanitized.endsWith('.gz') ? 'application/gzip' : 'application/x-ndjson';
    reply.header('Content-Type', contentType);
    reply.header('Content-Disposition', `attachment; filename="${sanitized}"`);

    const stream = fs.createReadStream(filePath);
    return reply.send(stream);
  });
}
