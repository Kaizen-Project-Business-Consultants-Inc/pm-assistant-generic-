/**
 * Every HTTP route the server registers, with the permission gates in front of it — the
 * source for the role-permission test (e2e/permissions). Loads the routes the same way the
 * server does, but never listens or touches a database.
 *
 *   npx tsx src/server/scripts/listRoutes.ts <output.json>   (the app's logger writes to stdout)
 */
import 'dotenv/config';
import Fastify from 'fastify';
import { writeFileSync } from 'fs';
import { registerRoutes } from '../routes';

interface RouteInfo { method: string; url: string; gates: string[] }

async function main() {
  const fastify = Fastify({ logger: false });
  const routes: RouteInfo[] = [];
  fastify.addHook('onRoute', (opts) => {
    const methods = Array.isArray(opts.method) ? opts.method : [opts.method];
    const pre = opts.preHandler ? (Array.isArray(opts.preHandler) ? opts.preHandler : [opts.preHandler]) : [];
    const gates = pre.map((h: any) => h?.gateName || h?.name || 'anonymous').filter(Boolean);
    for (const m of methods) {
      if (m === 'HEAD' || m === 'OPTIONS') continue;
      routes.push({ method: String(m), url: opts.url, gates });
    }
  });
  // Route plugins sometimes expect decorators the real server adds; stub the common ones
  for (const name of ['authenticate', 'redis', 'io']) {
    if (!fastify.hasDecorator(name)) fastify.decorate(name, (() => undefined) as any);
  }
  await registerRoutes(fastify);
  await fastify.ready();
  routes.sort((a, b) => a.url.localeCompare(b.url) || a.method.localeCompare(b.method));
  const out = process.argv[2] || 'route-inventory.json';
  writeFileSync(out, JSON.stringify(routes, null, 1));
  console.error(`[routes] ${routes.length} routes written to ${out}`);
  await fastify.close();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
