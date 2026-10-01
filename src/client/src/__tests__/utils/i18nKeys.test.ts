import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import en from '../../i18n/en.json';

/**
 * Every wording key the app looks up must exist in English (2026-10-01: the menu showed
 * "SECTION.PERSONAL" because section.personal was never added). Other languages fall back to
 * English (hooks/useTranslation.ts), so English is the one that must be complete.
 */
const SRC = join(__dirname, '..', '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') return [];
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|jsx?)$/.test(name) ? [p] : [];
  });
}

function has(bundle: unknown, key: string): boolean {
  let v: any = bundle;
  for (const part of key.split('.')) {
    if (v && typeof v === 'object' && part in v) v = v[part]; else return false;
  }
  return typeof v === 'string';
}

describe('wording keys', () => {
  it('every key used in the app has English wording', () => {
    const missing: string[] = [];
    for (const f of files(SRC)) {
      const src = readFileSync(f, 'utf8');
      if (!/useTranslation|titleKey|labelKey/.test(src)) continue;
      const keys = [
        ...[...src.matchAll(/\bt\(\s*['"]([a-zA-Z][\w]*(?:\.[\w]+)+)['"]\s*\)/g)].map(m => m[1]),
        ...[...src.matchAll(/\b(?:titleKey|labelKey)\s*:\s*['"]([a-zA-Z][\w]*(?:\.[\w]+)+)['"]/g)].map(m => m[1]),
      ];
      for (const k of keys) if (!has(en, k)) missing.push(`${relative(SRC, f).replace(/\\/g, '/')}: ${k}`);
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});
