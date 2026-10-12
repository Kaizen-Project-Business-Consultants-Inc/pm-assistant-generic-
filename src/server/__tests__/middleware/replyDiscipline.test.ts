import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * A refusal must stop the route (2026-10-09). Our responses go through async onSend hooks, so
 * right after `reply.send()` Fastify does not yet count the reply as sent. A preHandler that sends
 * 403 and returns nothing therefore lets the ROUTE RUN ANYWAY — every route behind
 * platformAdminOnly (kill switch, shared Mjuzi memory, policies, skills, feedback) did its work for
 * anyone signed in, after answering 403. Rules:
 *   - a gate (preHandler / onRequest hook) that refuses RETURNS the reply;
 *   - a gate that asks a helper which sends must return reply when the helper refused — awaiting
 *     a helper that returns the reply is fine (awaiting a reply waits for it to finish);
 *   - a handler stops with `return reply`, not a bare `return` (that sends a second answer);
 *   - an async helper must not return the reply for the caller to test: `await` of a reply gives
 *     undefined (it is thenable). Return true/false instead.
 */
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { platformAdminOnly } from '../../utils/platformAdmin';
import { securityValidationMiddleware } from '../../middleware/securityMiddleware';

async function appWith(preHandler: any, user?: any, answer = true) {
  const app = Fastify();
  // like plugins.ts: an async onSend hook, which is what delays "sent"
  app.addHook('onSend', async (_req, _reply, payload) => { await new Promise(r => { setTimeout(r, 2); }); return payload; });
  const ran = { handler: false };
  app.post('/x', { preHandler: [async (req: any) => { req.user = user; }, preHandler] }, async (_req, reply) => { ran.handler = true; return answer ? { done: true } : reply; });
  await app.ready();
  return { app, ran };
}

describe('a gate that refuses stops the route', () => {
  it('why: a hook that sends and returns nothing lets the route run (the bug this guards)', async () => {
    const { app, ran } = await appWith(async (_req: any, reply: any) => { reply.status(403).send({}); }, undefined, false);
    const res = await app.inject({ method: 'POST', url: '/x' }).catch(() => null);
    await new Promise(r => { setTimeout(r, 20); });
    expect(res?.statusCode).toBe(403);
    expect(ran.handler).toBe(true);
  });

  it('platform admin only: a company user gets 403 and nothing runs', async () => {
    const { app, ran } = await appWith(platformAdminOnly, { userId: 'u1', role: 'admin', hasCompany: true });
    const res = await app.inject({ method: 'POST', url: '/x' });
    await new Promise(r => { setTimeout(r, 20); });
    expect(res.statusCode).toBe(403);
    expect(ran.handler).toBe(false);
  });

  it('platform admin only: the platform admin goes through', async () => {
    const { app, ran } = await appWith(platformAdminOnly, { userId: 'a1', role: 'admin', hasCompany: false });
    expect((await app.inject({ method: 'POST', url: '/x' })).statusCode).toBe(200);
    expect(ran.handler).toBe(true);
  });

  it('request too large / wrong content type: refused and nothing runs', async () => {
    for (const headers of [{ 'content-length': String(11 * 1024 * 1024) }, { 'content-type': 'text/plain', 'content-length': '5' }]) {
      const { app, ran } = await appWith(securityValidationMiddleware);
      const res = await app.inject({ method: 'POST', url: '/x', headers, payload: headers['content-type'] ? 'hello' : undefined }).catch(() => null);
      await new Promise(r => { setTimeout(r, 20); });
      expect(res?.statusCode).toBeGreaterThanOrEqual(400);
      expect(ran.handler).toBe(false);
    }
  });
});

const SERVER = join(__dirname, '..', '..');
const files = (d: string): string[] => readdirSync(d).flatMap(f => {
  const p = join(d, f);
  if (statSync(p).isDirectory()) return f === '__tests__' || f === 'node_modules' ? [] : files(p);
  return p.endsWith('.ts') ? [p] : [];
});
const sources = files(SERVER).map(p => ({ path: relative(SERVER, p).split(sep).join('/'), text: readFileSync(p, 'utf-8').replace(/\r\n/g, '\n') }));

/** Helpers that RETURN the reply when they refuse: awaiting them waits until it is sent */
const RETURNS_REPLY = new Set([
  'requireScope', 'requireProjectAccess', 'requireFeature', 'guestGuard', 'subscriptionGuard',
  'requirePMOrOrgAdmin', 'requireCRProjectAccess', 'requireMemberIfProject', 'executionReader',
]);

describe('reply discipline across the server', () => {
  const lines = (s: { text: string }) => s.text.split('\n');

  it('no handler stops with a bare `return` after a check that was handed the reply (use `return reply`)', () => {
    const bad: string[] = [];
    for (const s of sources) {
      const L = lines(s);
      L.forEach((l, i) => {
        // one line: if (!requireAdmin(request, reply)) return;   if (await rejectIfDemo(id, reply)) return;
        if (/[(,]\s*reply\s*[,)][^;]*\)\s*return;/.test(l)) bad.push(`${s.path}:${i + 1}`);
        // two lines: const allowed = await check(…, reply); … if (!allowed) return;
        const m = l.match(/^\s*if \(!(\w+)\) return;$/);
        if (m && L.slice(Math.max(0, i - 4), i).some(p => new RegExp(`\\b(const|let)\\s+${m[1]}\\b\\s*=.*[(,]\\s*reply\\s*[,)]`).test(p))) bad.push(`${s.path}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('every refusal in the shared gates (middleware/) is returned', () => {
    // boolean helpers by design: their callers stop with `return reply`
    const BOOLEAN_HELPERS = new Set(['middleware/checkEntityProjectAccess.ts']);
    const bad = sources.filter(s => s.path.startsWith('middleware/') && !BOOLEAN_HELPERS.has(s.path)).flatMap(s => lines(s)
      .map((l, i) => ({ t: l.trim(), at: `${s.path}:${i + 1}` }))
      .filter(({ t }) => /\breply\b[^;]*\.send\(/.test(t) && !t.startsWith('//') && !/\breturn (void )?reply\b|=>\s*reply\b/.test(t))
      .map(({ at, t }) => `${at} ${t}`));
    expect(bad).toEqual([]);
  });

  it('the helpers trusted to return the reply really do', () => {
    for (const name of RETURNS_REPLY) {
      const def = new RegExp(`(function|const) ${name}\\b`);
      const s = sources.find(x => def.test(x.text));
      expect(s, name).toBeTruthy();
      const body = s!.text.slice(s!.text.search(def)).split(/\n\};?\n/)[0];
      const sends = body.split('\n').map(l => l.trim()).filter(t => /\breply\b[^;]*\.send\(/.test(t) && !t.startsWith('//'));
      for (const t of sends) expect(t, `${name}: ${t}`).toMatch(/\breturn (void )?reply\b/);
    }
  });

  it('every gate either returns its refusal or asks a helper that does', () => {
    // names used as gates
    const gateNames = new Set<string>();
    for (const s of sources) {
      for (const m of s.text.matchAll(/preHandler: \[([^\]]*)\]/g)) for (const n of m[1].split(',')) { const k = n.trim().match(/^([A-Za-z_]\w*)/)?.[1]; if (k) gateNames.add(k); }
      for (const m of s.text.matchAll(/preHandler: ([A-Za-z_]\w*)\b/g)) gateNames.add(m[1]);
      for (const m of s.text.matchAll(/addHook\('(?:preHandler|onRequest)', ([A-Za-z_]\w*)\)/g)) gateNames.add(m[1]);
    }
    const problems: string[] = [];
    for (const s of sources) {
      for (const m of s.text.matchAll(/(?:export )?(?:async function|function|const) ([A-Za-z_]\w*)\b/g)) {
        if (!gateNames.has(m[1])) continue;
        const start = m.index!;
        const lineStart = s.text.lastIndexOf('\n', start) + 1;
        const indent = s.text.slice(lineStart, start).match(/^\s*/)![0];
        const rest = s.text.slice(start);
        // the signature runs to the first `{` (it may span lines); the body to the closing brace at
        // the definition's indentation
        const signature = rest.slice(0, rest.indexOf('{') + 1);
        if (/=\s*(requireProjectAccess|requireScope|requireFeature|heavyActionLimit)\(/.test(signature)) continue;
        if (!/\breply\b/.test(signature)) continue; // a local with the same name, not the gate itself
        const end = rest.search(new RegExp(`\\n${indent}\\}`));
        const body = rest.slice(0, end < 0 ? 3000 : end).split('\n');
        body.slice(1).forEach((l, i) => {
          const t = l.trim();
          if (t.startsWith('//') || t.startsWith('*')) return;
          const at = `${s.path}:${s.text.slice(0, start).split('\n').length + i + 1} (${m[1]})`;
          if (/\breply\b[^;]*\.send\(/.test(t) && !/\breturn (void )?reply\b|=>\s*reply\b/.test(t)) problems.push(`${at} sends without returning: ${t}`);
          const call = t.match(/^(?:await )?([A-Za-z_]\w*)\([^)]*\breply\b/);
          if (call && !RETURNS_REPLY.has(call[1])) problems.push(`${at} asks ${call[1]}() but does not return the reply when it refuses: ${t}`);
        });
      }
    }
    expect(problems).toEqual([]);
  });

  /*
   * Inline gates (audit 2, L-m, 2026-10-11): the check above sees only NAMED gates. A gate written
   * in place — `preHandler: [requireScope('read'), async (request, reply) => { … }]`, or
   * `addHook('preHandler' | 'onRequest', async (request, reply) => { … })` — must follow the same
   * rules. Found by matching brackets, skipping strings and comments.
   */
  it('every inline gate returns its refusal or asks a helper that does', () => {
    const problems: string[] = [];
    for (const s of sources) {
      for (const g of inlineGates(s.text)) {
        const firstLine = s.text.slice(0, g.start).split('\n').length;
        g.body.split('\n').forEach((l, i) => {
          const t = l.trim();
          if (t.startsWith('//') || t.startsWith('*')) return;
          const at = `${s.path}:${firstLine + i}`;
          if (/\breply\b[^;]*\.send\(/.test(t) && !/\breturn (void )?reply\b|=>\s*reply\b/.test(t)) problems.push(`${at} sends without returning: ${t}`);
          const call = t.match(/^(?:await )?([A-Za-z_]\w*)\([^)]*\breply\b/);
          if (call && !RETURNS_REPLY.has(call[1])) problems.push(`${at} asks ${call[1]}() but does not return the reply when it refuses: ${t}`);
        });
      }
    }
    expect(problems).toEqual([]);
    // not vacuous: the in-place gates the audit read by hand are among those checked
    const withGates = new Set(sources.filter(s => inlineGates(s.text).length > 0).map(s => s.path));
    for (const f of ['plugins.ts', 'routes/ai/dreaming.ts', 'routes/automation/automations.ts', 'routes/collaboration/documentIntelligence.ts',
      'routes/collaboration/risks.ts', 'routes/scheduling/calendars.ts', 'routes/scheduling/schedules.ts']) expect(withGates.has(f), f).toBe(true);
  });

  it('the inline-gate finder sees gates written in place, and only those', () => {
    const src = [
      "fastify.get('/a', { preHandler: [requireScope('read'), async (request, reply) => {",
      "  if (!ok) reply.status(403).send({ error: '}' });",
      "}] }, async (request, reply) => { reply.send({}); });",
      "fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {",
      "  if (bad) { return reply.status(403).send({}); }",
      "});",
      "fastify.addHook('onRequest', async (request) => { request.x = 1; });",
      "fastify.addHook('onSend', async (_r, reply, payload) => { reply.send(payload); });",
    ].join('\n');
    const found = inlineGates(src).map(g => g.body);
    expect(found).toHaveLength(2);
    expect(found[0]).toContain("reply.status(403).send({ error: '}' })"); // a brace inside a string is not the end
    expect(found[0]).not.toContain('reply.send({})'); // the route handler is not a gate
    expect(found[1]).toContain('return reply.status(403)');
  });
});

/** Index just past the bracket that closes the one at `open` (skips strings, template literals and comments) */
function closeOf(text: string, open: number): number {
  const pairs: Record<string, string> = { '{': '}', '[': ']', '(': ')' };
  const stack: string[] = [];
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); if (i < 0) return text.length; continue; }
    if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i) + 1; continue; }
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++;
      continue;
    }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === stack[stack.length - 1]) { stack.pop(); if (stack.length === 0) return i + 1; }
  }
  return text.length;
}

/** The bodies of gates written in place: functions taking `reply` inside a preHandler array, or passed straight to addHook('preHandler' | 'onRequest') */
function inlineGates(text: string): { start: number; body: string }[] {
  const out: { start: number; body: string }[] = [];
  const fnIn = (from: number, to: number) => {
    const re = /(?:async\s*)?(?:function\s*\w*\s*)?\(([^()]*)\)\s*(?::\s*[\w<>|\s]+)?(?:=>)?\s*\{/g;
    re.lastIndex = from;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) && m.index < to) {
      const open = m.index + m[0].length - 1;
      const close = closeOf(text, open);
      if (/\breply\b/.test(m[1])) out.push({ start: open, body: text.slice(open, close) });
      re.lastIndex = close;
    }
  };
  for (const m of text.matchAll(/preHandler:\s*\[/g)) {
    const open = m.index! + m[0].length - 1;
    fnIn(open + 1, closeOf(text, open));
  }
  for (const m of text.matchAll(/addHook\(\s*'(?:preHandler|onRequest)',\s*/g)) {
    const at = m.index! + m[0].length;
    if (/^(?:async\b|function\b|\()/.test(text.slice(at))) fnIn(at, at + 1);
  }
  return out;
}

