import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Global search uses the word indexes (T085) — MATCH … AGAINST in boolean mode — instead of
 * LIKE '%…%' full reads (2026-10-08). Very short searches keep the old LIKE query.
 */
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: 'project_manager' }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const readable = vi.hoisted(() => ({ ids: new Set<string>(['p1', 'p2']) as Set<string> | 'all' }));
vi.mock('../../utils/readableProjects', () => ({ readableProjectIds: vi.fn(async () => readable.ids) }));
const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../database/connection', () => ({ databaseService: db }));

import { searchRoutes, booleanSearchTerm } from '../../routes/core/search';

/** [sql, params] of the query that reads the given table */
const callFor = (table: string): [string, unknown[]] => {
  const c = db.query.mock.calls.find(([sql]) => new RegExp(`FROM ${table}\\b`).test(sql));
  if (!c) throw new Error(`no query on ${table}`);
  return [String(c[0]).replace(/\s+/g, ' '), c[1]];
};
const TABLES = ['projects', 'tasks', 'goals', 'lessons_learned', 'resources', 'change_requests', 'project_risks', 'sprints', 'task_comments'];

describe('booleanSearchTerm', () => {
  it('turns each word into a required prefix term', () => {
    expect(booleanSearchTerm('Design review')).toBe('+design* +review*');
  });
  it('drops every boolean-mode operator and splits on them', () => {
    expect(booleanSearchTerm('+foo -bar <baz> (qux) ~quux *corge "grault" @garply')).toBe('+foo* +bar* +baz* +qux* +quux* +corge* +grault* +garply*');
    expect(booleanSearchTerm(`x') OR 1=1 -- "`)).toBeNull();
  });
  it('leaves out words the index never holds: shorter than 3 letters, stopwords; repeats once', () => {
    expect(booleanSearchTerm('QA plan for the go-live plan')).toBe('+plan* +live*');
    expect(booleanSearchTerm('ab')).toBeNull();
    expect(booleanSearchTerm('the')).toBeNull();
    expect(booleanSearchTerm('+-*')).toBeNull();
  });
  it('keeps letters from other languages', () => {
    expect(booleanSearchTerm('Übergabe café')).toBe('+übergabe* +café*');
  });
});

describe('GET /search', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(searchRoutes, { prefix: '/api/v1/search' }); }, 60_000);
  // the company database has the 9 word indexes (T085) unless a test says otherwise
  const withIndexes = (n: number) => db.query.mockImplementation(async (sql: string) => (/information_schema/.test(sql) ? [{ n }] : []));
  beforeEach(() => { db.query.mockReset(); withIndexes(9); readable.ids = new Set(['p1', 'p2']); });

  it('normal words: every table uses MATCH … AGAINST in boolean mode, ordered by relevance, no LIKE', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=' + encodeURIComponent('design review') });
    expect(res.statusCode).toBe(200);
    for (const t of TABLES) {
      const [sql, params] = callFor(t);
      expect(sql, t).toMatch(/WHERE MATCH\([^)]+\) AGAINST\(\? IN BOOLEAN MODE\)/);
      expect(sql, t).toMatch(/ORDER BY MATCH\([^)]+\) AGAINST\(\? IN BOOLEAN MODE\) DESC/);
      expect(sql, t).not.toMatch(/LIKE/);
      expect(params[0], t).toBe('+design* +review*');
      expect(params[params.length - 1], t).toBe('+design* +review*');
    }
    // the same columns as before, in the order of their index
    expect(callFor('tasks')[0]).toContain('MATCH(t.name, t.description)');
    expect(callFor('resources')[0]).toContain('MATCH(name, role, email)');
    expect(callFor('sprints')[0]).toContain('MATCH(sp.name, sp.goal)');
    expect(callFor('task_comments')[0]).toContain('MATCH(tc.text)');
  });

  it('a 2-letter search keeps the old LIKE query unchanged', async () => {
    await app.inject({ method: 'GET', url: '/api/v1/search?q=QA' });
    const [sql, params] = callFor('tasks');
    expect(sql).toContain('WHERE (t.name LIKE ? OR t.description LIKE ?) AND p.id IN (?,?)');
    expect(sql).not.toMatch(/MATCH|ORDER BY/);
    expect(params).toEqual(['%QA%', '%QA%', 'p1', 'p2']);
    expect(callFor('resources')[1]).toEqual(['%QA%', '%QA%', '%QA%', 'u1']);
    expect(callFor('task_comments')[0]).toContain('WHERE (tc.text LIKE ?)');
  });

  it('special characters never reach the SQL text; the search is still a bound parameter', async () => {
    const q = `"); DROP TABLE tasks; -- +alpha* @beta`;
    await app.inject({ method: 'GET', url: '/api/v1/search?q=' + encodeURIComponent(q) });
    for (const t of TABLES) {
      const [sql, params] = callFor(t);
      expect(sql).not.toMatch(/DROP|alpha|beta/);
      expect(params[0]).toBe('+drop* +table* +tasks* +alpha* +beta*');
    }
  });

  it('access filters, status and project filters and limits are unchanged', async () => {
    await app.inject({ method: 'GET', url: '/api/v1/search?q=budget&status=open&project=p2' });
    const [sql, params] = callFor('tasks');
    expect(sql).toMatch(/AND p\.id IN \(\?,\?\) AND t\.status = \? AND s\.project_id = \? ORDER BY .* LIMIT 10/);
    expect(params).toEqual(['+budget*', 'p1', 'p2', 'open', 'p2', '+budget*']);
    expect(callFor('projects')[0]).toMatch(/AND id IN \(\?,\?\) AND status = \? AND id = \? ORDER BY .* LIMIT 10$/);
    expect(callFor('project_risks')[0]).toMatch(/LIMIT 10$/);
    expect(callFor('change_requests')[0]).toMatch(/AND p\.id IN \(\?,\?\) AND cr\.status = \? AND cr\.project_id = \? ORDER BY .* LIMIT 5$/);
    expect(callFor('goals')[1]).toEqual(['+budget*', 'u1', 'open', '+budget*']);
    expect(callFor('resources')[1]).toEqual(['+budget*', 'u1', '+budget*']);
    expect(callFor('task_comments')[1]).toEqual(['+budget*', 'p1', 'p2', 'p2', '+budget*']);
  });

  it('no readable projects: project data queries match nothing', async () => {
    readable.ids = new Set();
    await app.inject({ method: 'GET', url: '/api/v1/search?q=budget' });
    for (const t of ['projects', 'tasks', 'change_requests', 'project_risks', 'sprints', 'task_comments']) {
      expect(callFor(t)[0], t).toContain('AND 1 = 0');
    }
  });

  it('result shape is unchanged', async () => {
    db.query.mockImplementation(async (sql: string) => /information_schema/.test(sql) ? [{ n: 9 }] : /FROM tasks/.test(sql)
      ? [{ id: 't1', name: 'Budget review', description: 'd', status: 'pending', priority: 'high', assigned_to: null, progress_percentage: 10, start_date: '2026-10-01', end_date: '2026-10-02', project_id: 'p1', project_name: 'P' }]
      : []);
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=budget&type=task' });
    expect(res.json().results).toEqual([{ type: 'task', id: 't1', name: 'Budget review', description: 'd', status: 'pending', projectId: 'p1', projectName: 'P', priority: 'high', assignedTo: null, progress: 10, startDate: '2026-10-01', endDate: '2026-10-02' }]);
  });

  it('every MATCH column list has a FULLTEXT index with exactly those columns (T085)', async () => {
    await app.inject({ method: 'GET', url: '/api/v1/search?q=budget' });
    const migration = readFileSync(join(__dirname, '..', '..', 'database', 'tenant-migrations', 'T085_search_fulltext.sql'), 'utf-8');
    const indexed = new Map([...migration.matchAll(/ALTER TABLE (\w+) ADD FULLTEXT INDEX IF NOT EXISTS \w+ \(([^)]+)\)/g)]
      .map(m => [m[1], m[2].replace(/`/g, '').replace(/\s+/g, '')]));
    for (const t of TABLES) {
      const cols = /MATCH\(([^)]+)\)/.exec(callFor(t)[0])![1].replace(/\b\w+\./g, '').replace(/\s+/g, '');
      expect(indexed.get(t), t).toBe(cols);
    }
  });

  it('a company database without the word indexes (T085 not applied) falls back to "contains" search, not an error', async () => {
    const { searchRoutes, _resetWordIndexCheck } = await import('../../routes/core/search');
    _resetWordIndexCheck();
    const Fastify = (await import('fastify')).default;
    const app2 = Fastify();
    await app2.register(searchRoutes, { prefix: '/api/v1/search' });
    db.query.mockReset();
    db.query.mockImplementation(async (sql: string) => (/information_schema/.test(sql) ? [{ n: 3 }] : []));
    const res = await app2.inject({ method: 'GET', url: '/api/v1/search?q=planning' });
    expect(res.statusCode).toBe(200);
    const texts = db.query.mock.calls.map(([sql]) => String(sql)).filter(s => !/information_schema/.test(s));
    expect(texts.some(s => /MATCH\(/.test(s))).toBe(false);
    expect(texts.some(s => /LIKE \?/.test(s))).toBe(true);
    await app2.close();
  });
});
