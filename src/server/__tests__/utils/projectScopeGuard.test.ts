import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * One rule for "which projects can I see" (2026-10-01): created by me, member of, or the sample
 * project — utils/readableProjects.ts (readableProjectIds / readableProjectJoin). The dashboard
 * tiles and search used "created by me" and the Morning Briefing "member of", so the same screen
 * disagreed with itself. Only ProjectRepository (which defines the rule) may filter projects by
 * creator.
 */
const SERVER = join(__dirname, '..', '..');
const ALLOWED = new Set(['database/ProjectRepository.ts']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') return [];
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('project scope guard', () => {
  it('no query limits projects to the ones the user created (use utils/readableProjects)', () => {
    const bad = files(SERVER)
      .map(p => ({ f: relative(SERVER, p).replace(/\/g, '/'), s: readFileSync(p, 'utf8') }))
      .filter(({ f, s }) => !ALLOWED.has(f) && /\bp\.created_by\s*=\s*\?/.test(s))
      .map(({ f }) => f);
    expect(bad).toEqual([]);
  });
});
