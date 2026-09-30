import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { PLAN_TIERS, FEATURE_KEYS } from '../../constants/planFeatures';

/**
 * Every plan we sell must get a price row and an on/off setting for every plan-gated feature
 * from the migrations alone — so a new database, the test bed or a rebuilt server is
 * complete. A missing setting reads as "feature off": production's SME, Enterprise and Trial
 * plans had no feature settings, the Enterprise price row existed only on production (added
 * by hand), and "ai_assistant" was in no plan at all (found 2026-09-30).
 *
 * Reads the migration SQL: literal rows, plus 102's "copy another plan's features" form.
 */
const DIR = join(__dirname, '..', '..', 'database', 'migrations');
const sql = readdirSync(DIR)
  .filter(f => /^\d+_.*\.sql$/.test(f) && !f.endsWith('.down.sql'))
  .sort()
  .map(f => readFileSync(join(DIR, f), 'utf8'))
  .join('\n');

function seededFeatures(): Set<string> {
  const have = new Set<string>();
  const statements = sql.split(';');
  for (const st of statements) {
    if (!/INSERT\s+(IGNORE\s+)?INTO\s+tier_features/i.test(st)) continue;
    // Literal rows: (UUID(), 'tier', 'feature', 0|1)
    for (const m of st.matchAll(/\(\s*UUID\(\)\s*,\s*'(\w+)'\s*,\s*'(\w+)'\s*,\s*[01]\s*\)/g)) have.add(`${m[1]}|${m[2]}`);
    // Copied rows: SELECT UUID(), 'new_tier', feature_key ... FROM tier_features WHERE tier = 'old_tier'
    const copy = st.match(/SELECT\s+UUID\(\)\s*,\s*'(\w+)'\s*,\s*feature_key[\s\S]*FROM\s+tier_features\s+WHERE\s+tier\s*=\s*'(\w+)'/i);
    if (copy) for (const k of [...have]) if (k.startsWith(`${copy[2]}|`)) have.add(`${copy[1]}|${k.split('|')[1]}`);
  }
  return have;
}

function pricedTiers(): Set<string> {
  const tiers = new Set<string>();
  for (const st of sql.split(/;\s*\n/)) {
    if (!/INSERT\s+(IGNORE\s+)?INTO\s+pricing_config/i.test(st)) continue;
    for (const m of st.matchAll(/\(\s*UUID\(\)\s*,\s*'(\w+)'\s*,\s*'/g)) tiers.add(m[1]);
  }
  return tiers;
}

describe('plan tables are complete from the migrations alone', () => {
  it('every plan we sell has a price row', () => {
    const priced = pricedTiers();
    expect(PLAN_TIERS.filter(t => !priced.has(t))).toEqual([]);
  });

  it('every plan has an on/off setting for every plan-gated feature', () => {
    const have = seededFeatures();
    const missing = PLAN_TIERS.flatMap(t => FEATURE_KEYS.filter(k => !have.has(`${t}|${k}`)).map(k => `${t}|${k}`));
    expect(missing).toEqual([]);
  });

  it('every feature key the code asks for is on the list (requireFeature is typed to it)', () => {
    // The compile-time check covers requireFeature(); this catches isFeatureEnabled('…') calls.
    const src = join(__dirname, '..', '..');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.name === '__tests__' || e.name === 'node_modules') continue;
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(src);
    const used = new Set<string>();
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(/(?:requireFeature|isFeatureEnabled)\((?:[^,)]*,\s*)?'(\w+)'\)/g)) used.add(m[1]);
    }
    expect([...used].filter(k => !(FEATURE_KEYS as readonly string[]).includes(k))).toEqual([]);
    expect(used.size).toBeGreaterThan(5);
  });
});
