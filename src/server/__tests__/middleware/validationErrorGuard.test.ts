import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * Bad input must come back as 400 with the field that was wrong — never "Internal server error".
 * The app's error handler (plugins.ts) does that for a ZodError, but only if the route lets it
 * through: a route that `.parse()`s the request and then catches everything into a 500 hides it
 * (Team Planner testing, 2026-10-02: clearing "Assigned to" with null gave a 500; 19 routes did this).
 * Each such route's catch must rethrow the ZodError, handle it itself, or use safeParse.
 */
const ROUTES = join(__dirname, '..', '..', 'routes');
const files = (d: string): string[] => readdirSync(d).flatMap(f => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
});

describe('bad input is a 400, not a 500', () => {
  it('no route parses the request and then turns a validation error into a 500', () => {
    const offenders: string[] = [];
    for (const f of files(ROUTES)) {
      const s = readFileSync(f, 'utf-8');
      const routes = [...s.matchAll(/fastify\.(get|post|put|patch|delete)\(\s*['`]([^'`]+)['`]/g)];
      routes.forEach((m, i) => {
        const body = s.slice(m.index! + m[0].length, i + 1 < routes.length ? routes[i + 1].index : s.length);
        if (/\.parse\(request\.(body|query|params)/.test(body) && /status\(500\)/.test(body) && !body.includes('ZodError') && !body.includes('safeParse')) {
          offenders.push(`${relative(ROUTES, f).split(sep).join('/')}: ${m[1].toUpperCase()} ${m[2]}`);
        }
      });
    }
    expect(offenders, 'In the catch, add: if (error instanceof z.ZodError) throw error;').toEqual([]);
  });
});
