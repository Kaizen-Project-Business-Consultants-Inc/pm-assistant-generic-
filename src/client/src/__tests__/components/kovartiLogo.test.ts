import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';

// Oct 2026: one logo everywhere — the Gantt K (components/ui/KovartiMark.tsx). The public pages
// used a lightbulb icon and the sidebar a plain "K"; this keeps old marks from coming back.
const SRC = join(__dirname, '../..');
const files = (dir: string): string[] => readdirSync(dir).flatMap(n => {
  const p = join(dir, n);
  if (n === '__tests__' || n === 'node_modules') return [];
  return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
});

describe('Kovarti logo is the one shared mark', () => {
  const all = files(SRC).map(p => ({ p, s: readFileSync(p, 'utf8') }));
  it('the old lightbulb logo is gone', () => {
    expect(all.filter(f => f.s.includes('M9.663 17h4.673') || f.s.includes('LOGO_SVG_PATH')).map(f => f.p)).toEqual([]);
  });
  it('the sidebar, sign-in, onboarding and public pages draw KovartiMark', () => {
    for (const name of ['Sidebar.tsx', 'LoginPage.tsx', 'OnboardingPage.tsx', 'PublicNavbar.tsx', 'LandingPage.tsx', 'PricingPage.tsx', 'PrelaunchLandingPage.tsx']) {
      const f = all.find(x => basename(x.p) === name)!;
      expect([name, f.s.includes('<KovartiMark')]).toEqual([name, true]);
    }
  });
});
