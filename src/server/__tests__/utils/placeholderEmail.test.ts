import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { isPlaceholderEmail, makePlaceholderEmail } from '../../utils/placeholderEmail';
import { isPlaceholderEmail as clientIsPlaceholder, PLACEHOLDER_EMAIL_DOMAIN as clientDomain } from '../../../client/src/utils/placeholderEmail';
import { PLACEHOLDER_EMAIL_DOMAIN } from '../../utils/placeholderEmail';

describe('placeholder emails (2026-10-01)', () => {
  it('makes firstname.lastname@example.com from a name', () => {
    expect(makePlaceholderEmail('Parth Mandalia')).toBe('parth.mandalia@example.com');
    expect(makePlaceholderEmail("  Mary-Jane O'Neil ")).toBe('mary.jane.o.neil@example.com');
    expect(makePlaceholderEmail('DBJ & JV')).toBe('dbj.jv@example.com');
  });

  it('never gives two people the same placeholder', () => {
    const taken = new Set(['parth.patel@example.com']);
    expect(makePlaceholderEmail('Parth Patel', taken)).toBe('parth.patel.2@example.com');
    taken.add('parth.patel.2@example.com');
    expect(makePlaceholderEmail('Parth Patel', taken)).toBe('parth.patel.3@example.com');
  });

  it('falls back to "resource" for a name with no letters or digits', () => {
    expect(makePlaceholderEmail('—')).toBe('resource@example.com');
  });

  it('recognises placeholders only on the reserved domain', () => {
    expect(isPlaceholderEmail('a.b@example.com')).toBe(true);
    expect(isPlaceholderEmail(' A.B@EXAMPLE.COM ')).toBe(true);
    expect(isPlaceholderEmail('a@example.com.au')).toBe(false);
    expect(isPlaceholderEmail('a@notexample.com')).toBe(false);
    expect(isPlaceholderEmail('')).toBe(false);
    expect(isPlaceholderEmail(null)).toBe(false);
  });

  it('the screens and the server agree on what a placeholder is', () => {
    expect(clientDomain).toBe(PLACEHOLDER_EMAIL_DOMAIN);
    for (const e of ['a@example.com', 'a@b.com', '', 'x@EXAMPLE.com']) expect(clientIsPlaceholder(e)).toBe(isPlaceholderEmail(e));
  });

  it('the migration uses the same domain', () => {
    const sql = readFileSync(join(__dirname, '../../database/tenant-migrations/T069_generic_resources.sql'), 'utf8');
    expect(sql).toContain(`'@${PLACEHOLDER_EMAIL_DOMAIN}'`);
  });
});

/**
 * Guard: resources are only ever written through ResourceService (which enforces "every person
 * has an email, a generic role never does"). A raw INSERT elsewhere would slip past the rule —
 * that's how ten people ended up with no email before 2026-10-01.
 */
describe('resources are created only through ResourceService', () => {
  const SERVER = join(__dirname, '..', '..');
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === '__tests__' || n === 'node_modules' ? [] : files(p);
    return /\.ts$/.test(n) ? [p] : [];
  });

  it('no INSERT INTO resources outside the repository', () => {
    const bad = files(SERVER)
      .map((p) => ({ f: relative(SERVER, p).replace(/\\/g, '/'), s: readFileSync(p, 'utf8') }))
      .filter(({ f, s }) => f !== 'database/ResourceRepository.ts' && /INSERT\s+(IGNORE\s+)?INTO\s+resources\b/i.test(s))
      .map(({ f }) => f);
    expect(bad).toEqual([]);
  });

  it('the repository create is called only by ResourceService', () => {
    const bad = files(SERVER)
      .map((p) => ({ f: relative(SERVER, p).replace(/\\/g, '/'), s: readFileSync(p, 'utf8') }))
      .filter(({ f, s }) => f !== 'services/ResourceService.ts' && /resourceRepository\.create\(/.test(s))
      .map(({ f }) => f);
    expect(bad).toEqual([]);
  });
});
