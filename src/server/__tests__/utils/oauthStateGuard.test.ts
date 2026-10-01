import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * "Connect your account" sign-ins (Oct 2026). The state sent to Slack / Microsoft / Google
 * used to be "<random>:<user id>" and the callback trusted the user id in it — so a made-up
 * state could attach someone's account to another Kovarti user. Every flow now uses
 * utils/oauthState.ts (random one-time state kept server-side, finished only by the same
 * signed-in person). This test fails the build if the old pattern comes back anywhere.
 */
const SERVER = join(__dirname, '..', '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') return [];
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('sign-in state guard', () => {
  const all = files(SERVER).map(p => ({ file: relative(SERVER, p).replace(/\\/g, '/'), src: readFileSync(p, 'utf8') }));

  it('no callback reads a user id out of the state', () => {
    const bad = all.filter(f => /state\.split\(\s*['"]:['"]\s*\)/.test(f.src)).map(f => f.file);
    expect(bad).toEqual([]);
  });

  it('no install link puts the user id in the state', () => {
    const bad = all.filter(f => /\+\s*['"]:['"]\s*\+\s*request\.user/.test(f.src) || /`[^`]*:\$\{request\.user!?\.userId\}[^`]*`/.test(f.src) && /state/i.test(f.src))
      .filter(f => /randomBytes|state/.test(f.src))
      .map(f => f.file);
    expect(bad).toEqual([]);
  });

  it('every account-connect callback checks the state with oauthState (or its own one-time store)', () => {
    const callbacks = all.filter(f => /\.get\(\s*['"]\/callback['"]/.test(f.src) && /\bstate\b/.test(f.src));
    const unchecked = callbacks
      .filter(f => !/finishOAuthState|handleOAuthCallback/.test(f.src))
      .map(f => f.file);
    expect(callbacks.length).toBeGreaterThanOrEqual(3); // slack, teams (+ meetings), calendar; storage has its own route and one-time store
    expect(unchecked).toEqual([]);
  });
});
