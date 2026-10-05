import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { ROLE_SCOPES, effectiveScopes } from '../../constants/roleScopes';

/**
 * Guard (2026-10-05, audit critical #2): connecting Claude used to give every person a key
 * with read, write AND admin, and the API trusted the key over the person's role.
 * Now: Claude keys get the person's role rights; every key is limited to its owner's role;
 * the 'admin' right is only used for Kovarti platform-admin work.
 */
const server = join(__dirname, '..', '..');
const repo = join(server, '..', '..');
const code = (p: string) => readFileSync(p, 'utf-8').split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');

describe('effectiveScopes', () => {
  it('a key is limited to the role', () => {
    expect(effectiveScopes('viewer', ['read', 'write', 'admin'])).toEqual(['read']);
    expect(effectiveScopes('project_manager', ['read', 'write', 'admin'])).toEqual(['read', 'write']);
    expect(effectiveScopes('admin', ['read', 'write', 'admin'])).toEqual(['read', 'write', 'admin']);
    expect(effectiveScopes('project_manager', ['read'])).toEqual(['read']);
    expect(effectiveScopes('project_manager', ['admin'])).toEqual(['read', 'write']);
    expect(effectiveScopes('project_manager', ['*'])).toEqual(['read', 'write']);
    expect(effectiveScopes('nobody-knows', ['read', 'write', 'admin'])).toEqual(['read']);
    expect(effectiveScopes('pmo')).toEqual(['read', 'write']); // no key: the role
  });
});

describe('the Claude connection', () => {
  const oauth = join(repo, 'mcp-server', 'src', 'oauth');

  it('never issues a fixed set of rights', () => {
    for (const f of readdirSync(oauth).filter(f => f.endsWith('.ts'))) {
      expect(code(join(oauth, f)), f).not.toMatch(/\[\s*'read'\s*,\s*'write'\s*,\s*'admin'\s*\]\s*\)/);
    }
    const provider = code(join(oauth, 'provider.ts'));
    expect(provider.match(/JSON\.stringify\(await scopesForUser\(/g)?.length).toBe(2); // code exchange + renewal
  });

  it("uses the same role → rights list as the server", () => {
    const copy = readFileSync(join(oauth, 'roleScopes.ts'), 'utf-8');
    const parsed: Record<string, string[]> = {};
    for (const m of copy.matchAll(/^\s+(\w+):\s*\[([^\]]*)\]/gm)) parsed[m[1]] = [...m[2].matchAll(/'(\w+)'/g)].map(x => x[1]);
    expect(parsed).toEqual(ROLE_SCOPES);
  });
});

describe("the 'admin' right is only for Kovarti platform work", () => {
  const routes = join(server, 'routes');
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.ts')) files.push(p); } };
  walk(routes);

  it('every route that asks for it also requires the platform admin', () => {
    const bad: string[] = [];
    for (const p of files) {
      const src = code(p);
      for (const m of src.matchAll(/requireScope\('admin'\)[^\n]*/g)) {
        const line = m[0];
        const inline = /\)\(request, reply\);/.test(line);
        const ok = inline ? src.slice(m.index!, m.index! + 200).includes('requirePlatformAdmin(') : /platformAdminOnly/.test(line);
        if (!ok) bad.push(`${p.slice(routes.length + 1)}: ${line.trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('proposals: the project PM executes and rolls back; anyone revokes their own key', () => {
    const proposals = code(join(routes, 'agent', 'proposals.ts'));
    expect(proposals).toMatch(/'\/:id\/execute', \{\s*preHandler: \[requireScope\('write'\), proposalPMGate\]/);
    expect(proposals).toMatch(/'\/:id\/rollback', \{\s*preHandler: \[requireScope\('write'\), proposalPMGate\]/);
    expect(code(join(routes, 'integrations', 'apiKeys.ts'))).toMatch(/fastify\.delete\('\/:id', \{ preHandler: \[requireScope\('read'\)\] \}/);
  });
});
