import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Guards the multi-tenant isolation guarantee: a query must run against the tenant
 * database that was just selected, never a previously selected one.
 *
 * Background (2026-09-18): `databaseService.query()` took a pooled connection, issued
 * ``USE `tenant_db` ``, then called the PREPARED form of the call. mysql2 caches
 * prepared statements per connection keyed by SQL text, and a prepared statement stays
 * bound to the database it was prepared against — so on a pooled connection that had
 * since switched tenants the database switch was silently ignored and the query hit the
 * PREVIOUS tenant's database. `SELECT DATABASE()` itself reported the stale name. A
 * backfill wrote one customer's rows into another customer's database before it was
 * caught on staging.
 *
 * The rule: any connection that has had a database switch applied must use the
 * non-prepared form. These tests fail if anyone reintroduces the prepared form there.
 */

const SRC = fs.readFileSync(path.join(__dirname, '../../database/connection.ts'), 'utf-8');

/** Source with comment lines removed, so documentation cannot satisfy or trip a check. */
const CODE = SRC.split('\n')
  .filter((l) => {
    const t = l.trimStart();
    return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
  })
  .join('\n');

const PREPARED_ON_CONNECTION = /\b(conn|connection)\.execute\s*\(/;

/** Every non-test server source file, comment lines stripped. */
function serverSources(): Array<{ file: string; code: string }> {
  const root = path.join(__dirname, '../..');
  const out: Array<{ file: string; code: string }> = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(full); continue; }
      if (!/\.ts$/.test(e.name) || /\.(test|spec)\.ts$/.test(e.name)) continue;
      const code = fs.readFileSync(full, 'utf-8').split('\n')
        .filter((l) => { const t = l.trimStart(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*'); })
        .join('\n');
      out.push({ file: path.relative(root, full), code });
    }
  };
  walk(root);
  return out;
}

describe('tenant isolation (whole server)', () => {
  // 2026-09-24: routes/core/bulk.ts had used connection.execute() inside
  // databaseService.transaction() for months — this guard only scanned connection.ts.
  // Every connection handed out by getConnection()/transaction() has had USE applied.
  it('no server file calls the prepared form on a connection', () => {
    const offenders = serverSources()
      .filter(({ code }) => PREPARED_ON_CONNECTION.test(code))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  }, 60_000); // reads every server file — slow when the machine is busy

  it('actually scans the route and service files', () => {
    const files = serverSources().map(s => s.file.replace(/\\/g, '/'));
    expect(files).toContain('routes/core/bulk.ts');
    expect(files.length).toBeGreaterThan(100);
  }, 60_000);
});

describe('tenant isolation (connection.ts)', () => {
  it('never uses the prepared form on a pooled connection', () => {
    // Pooled connections are the ones that get a database switch applied. The prepared
    // form on them is precisely the defect that leaked data between customers.
    expect(
      PREPARED_ON_CONNECTION.test(CODE),
      'A pooled connection must use the non-prepared form — prepared statements stay ' +
      'bound to the database they were prepared against, so a tenant switch is ignored.',
    ).toBe(false);
  });

  it('routes every database switch through the single guarded helper', () => {
    const switches = (CODE.match(/USE \\`/g) || []).length;
    const guarded = (CODE.match(/this\.runOnConnection</g) || []).length;

    expect(switches).toBeGreaterThan(0);
    // Every switch site, plus queryOn which receives an already-switched connection.
    expect(guarded).toBeGreaterThanOrEqual(switches);
  });

  it('keeps the guarded helper on the non-prepared form', () => {
    const helper = CODE.split('private async runOnConnection')[1] ?? '';
    const body = helper.slice(0, 300);

    expect(body).toContain('conn.query(sql, params)');
    expect(PREPARED_ON_CONNECTION.test(body)).toBe(false);
  });

  it('still passes parameters separately, so this is not an injection regression', () => {
    const helper = CODE.split('private async runOnConnection')[1] ?? '';
    const body = helper.slice(0, 300);

    // Guards against someone "fixing" a future problem by inlining values into the SQL.
    expect(body).toContain('params');
    expect(body).not.toMatch(/\$\{\s*params/);
  });

  it('applies the tenant switch before handing a connection to a caller', () => {
    // getConnection() hands a raw connection to transaction callers, so it must apply
    // the switch itself. Those callers then go through queryOn, which is guarded.
    const getConn = CODE.split('public async getConnection')[1] ?? '';
    const body = getConn.slice(0, 400);

    expect(body).toContain('USE \\`');
    expect(PREPARED_ON_CONNECTION.test(body)).toBe(false);
  });
});
