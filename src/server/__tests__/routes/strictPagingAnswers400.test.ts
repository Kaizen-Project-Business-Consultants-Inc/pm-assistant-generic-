import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * parsePagination is the strict paging check: an out-of-range ?limit= (e.g. 500 when the most is
 * 200) throws a validation error that must reach the caller as a 400 with the reason. Six list
 * routes caught it in a try/catch that answered 500 "Failed to fetch…" (found 2026-10-15). Every
 * route that calls it inside a try must turn a ZodError into a 400 in that catch.
 */
const routesDir = join(__dirname, '../../routes');
const files = (dir: string): string[] => readdirSync(dir).flatMap(f => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
});

describe('strict paging answers 400, not 500', () => {
  it('every parsePagination call inside a try is followed by a catch that answers ZodError with 400', () => {
    const offenders: string[] = [];
    for (const file of files(routesDir)) {
      const src = readFileSync(file, 'utf8');
      let at = src.indexOf('parsePagination(');
      while (at !== -1) {
        const lineStart = src.lastIndexOf('\n', at) + 1;
        if (!src.slice(lineStart, at).trimStart().startsWith('import')) {
          const tryAt = src.lastIndexOf('try {', at);
          const catchAt = src.indexOf('catch (', at);
          // inside a try (the try opens after the route's start and before the call)
          if (tryAt !== -1 && catchAt !== -1 && src.lastIndexOf('fastify.', at) < tryAt) {
            const handler = src.slice(catchAt, catchAt + 400);
            if (!/ZodError\) return sendValidationError/.test(handler)) offenders.push(`${file.split('routes')[1]} @${src.slice(0, at).split('\n').length}`);
          }
        }
        at = src.indexOf('parsePagination(', at + 1);
      }
    }
    expect(offenders).toEqual([]);
  });
});
