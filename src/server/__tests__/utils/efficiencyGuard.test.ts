import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import ts from 'typescript';

/**
 * Efficiency guard (2026-10-08, after the efficiency check found the audit "verify" reading the
 * whole 108 MB audit history for any user, ~10 missing indexes and history tables that never
 * shrink). Reads the server code and the migrations — no database needed. Four rules:
 *
 *  1. A SELECT on a table that grows without end has a WHERE, a LIMIT or is a COUNT — never
 *     "read it all".
 *  2. ...and its WHERE uses a column that starts an index on that table (else it reads the table).
 *  3. Every table that grows without end has a clean-up (DELETE … older than …) or is listed in
 *     KEEP_FOREVER with the reason.
 *  4. Heavy routes (export, verify, download, import, bulk, rebuild, simulate…) check a role or
 *     the project, and are rate-limited.
 *
 * What exists today is listed below as allowances — they may only go DOWN (fix, then lower the
 * number in the same change). Anything new fails. Raising a number needs the user's OK.
 */

/** Tables that gain rows every day and are never naturally bounded */
const GROWING = [
  'audit_ledger', 'workflow_executions', 'workflow_node_executions', 'agent_activity_log', 'agent_memory',
  'ai_usage_log', 'api_key_usage_log', 'automation_executions', 'chat_messages', 'integration_sync_log',
  'memory_change_log', 'notifications', 'project_health_history', 'raid_activity_log', 'task_activities',
  'time_entries', 'webhook_deliveries', 'tasks',
];

/** Kept on purpose — the reason is the rule */
const KEEP_FOREVER: Record<string, string> = {
  audit_ledger: 'tamper-evident record of every change — kept for compliance',
  time_entries: 'timesheets are billing records',
  tasks: 'project data, archived with the project',
  raid_activity_log: 'history of a RAID item, part of the project record',
  task_activities: 'history of a task, part of the project record',
  project_health_history: 'one row per project per day — trend charts read it',
  memory_change_log: 'record of what the AI memory changed, for undo and audit',
};

// --- allowances on 2026-10-08 (only go down) -------------------------------------------------
const UNBOUNDED_ALLOWED: Record<string, number> = {
  'database/AuditLedgerRepository.ts': 1, // verifyChain reads the whole ledger — efficiency report item 1
};
const UNINDEXED_ALLOWED: Record<string, number> = {
  'routes/admin/admin.ts': 3, // agent_memory by memory_type, audit_ledger by created_at
  'routes/admin/operations.ts': 1,
  'routes/reporting/dashboardData.ts': 1, // tasks by created_at (issues trend)
  'services/DailyBriefingService.ts': 1, // raid_activity_log by created_at
  'services/scheduling/timesheetComplianceJob.ts': 1, // time_entries by date
  'services/scheduling/utilizationCoachingJob.ts': 1,
};
const NO_CLEANUP_ALLOWED: string[] = [
  'workflow_executions', 'workflow_node_executions', 'agent_activity_log', 'ai_usage_log',
  'automation_executions', 'chat_messages', 'integration_sync_log',
];
const HEAVY_ROUTE_ALLOWED: Record<string, number> = {
  'routes/admin/auditTrail.ts': 2, // /verify (any reader — report item 1) and compliance export
  'routes/admin/knowledgeBase.ts': 1,
  'routes/admin/logs.ts': 1,
  'routes/admin/waitlist.ts': 1,
  'routes/automation/automations.ts': 1,
  'routes/collaboration/documentIntelligence.ts': 1,
  'routes/collaboration/fileAttachments.ts': 1,
  'routes/collaboration/risks.ts': 2,
  'routes/collaboration/sprints.ts': 1,
  'routes/collaboration/templates.ts': 1,
  'routes/core/exports.ts': 1,
  'routes/core/projectGroups.ts': 1,
  'routes/reporting/reportBuilder.ts': 1,
  'routes/reporting/statusReports.ts': 1,
  'routes/reporting/strategicRiskScan.ts': 1,
  'routes/resources/resources.ts': 2,
  'routes/scheduling/import.ts': 3,
  'routes/scheduling/monteCarlo.ts': 1,
  'routes/scheduling/scheduleReview.ts': 1,
  'routes/scheduling/schedules.ts': 2,
};

// ------------------------------------------------------------------------------------------------
const SERVER = join(__dirname, '..', '..');
const MIGRATION_DIRS = [join(SERVER, 'database', 'migrations'), join(SERVER, 'database', 'tenant-migrations')];

function walk(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === '__tests__' || n === 'node_modules' ? [] : walk(p, ext);
    return n.endsWith(ext) && !n.endsWith('.test.ts') && !n.endsWith('.d.ts') ? [p] : [];
  });
}
const rel = (f: string) => relative(SERVER, f).split(sep).join('/');

/** Leading column of every index (and primary key, and foreign key — InnoDB indexes those) per table */
function leadingIndexColumns(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (table: string, cols: string) => {
    const first = cols.split(',')[0].replace(/[`\s]|\(\d+\)/g, '').toLowerCase();
    if (!first) return;
    if (!out.has(table)) out.set(table, new Set());
    out.get(table)!.add(first);
  };
  const sql = MIGRATION_DIRS.flatMap(d => walk(d, '.sql')).map(f => readFileSync(f, 'utf-8').replace(/--[^\n]*/g, '')).join('\n;\n');
  for (const stmt of sql.split(';')) {
    const create = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?\s*\(([\s\S]*)\)/i.exec(stmt);
    if (create) {
      const [, table, body] = create;
      for (const m of body.matchAll(/(?:PRIMARY\s+KEY|UNIQUE\s+(?:KEY|INDEX)|KEY|INDEX|FOREIGN\s+KEY)\s*(?:`?\w+`?\s*)?\(([^)]+)\)/gi)) add(table.toLowerCase(), m[1]);
      for (const m of body.matchAll(/^\s*`?(\w+)`?\s+[^,\n]*\b(?:PRIMARY\s+KEY|UNIQUE)\b/gim)) add(table.toLowerCase(), m[1]);
    }
    for (const m of stmt.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?`?\w+`?\s+ON\s+`?(\w+)`?\s*\(([^)]+)\)/gi)) add(m[1].toLowerCase(), m[2]);
    const alter = /ALTER\s+TABLE\s+`?(\w+)`?([\s\S]*)/i.exec(stmt);
    if (alter) {
      for (const m of alter[2].matchAll(/ADD\s+(?:CONSTRAINT\s+`?\w+`?\s+)?(?:UNIQUE\s+)?(?:PRIMARY\s+KEY|KEY|INDEX|FOREIGN\s+KEY)\s*(?:IF\s+NOT\s+EXISTS\s+)?(?:`?\w+`?\s*)?\(([^)]+)\)/gi)) add(alter[1].toLowerCase(), m[1]);
    }
  }
  return out;
}

/** Every string / template literal in server code that looks like SQL, with its file */
function sqlLiterals(): Array<{ file: string; sql: string }> {
  const out: Array<{ file: string; sql: string }> = [];
  for (const f of walk(SERVER, '.ts')) {
    const text = readFileSync(f, 'utf-8');
    if (!/\b(?:SELECT|DELETE)\b/.test(text)) continue;
    const src = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, false);
    const visit = (n: ts.Node) => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) {
        const s = n.getText(src).slice(1, -1).replace(/\s+/g, ' ');
        if (/\b(?:SELECT|DELETE)\b[\s\S]*\bFROM\b/i.test(s)) out.push({ file: rel(f), sql: s });
        return; // don't descend into a template's own pieces
      }
      ts.forEachChild(n, visit);
    };
    visit(src);
  }
  return out;
}

const growing = new RegExp(`\\bFROM\\s+\`?(${GROWING.join('|')})\`?\\b`, 'i');
const isSelect = (sql: string) => /^\s*\(?\s*SELECT\b/i.test(sql);

function tally(items: string[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const i of items) t[i] = (t[i] ?? 0) + 1;
  return t;
}
function compare(found: Record<string, number>, allowed: Record<string, number>, what: string): string[] {
  const problems: string[] = [];
  for (const [file, n] of Object.entries(found)) {
    if (n > (allowed[file] ?? 0)) problems.push(`${file}: ${n} ${what} (allowed ${allowed[file] ?? 0})`);
  }
  for (const [file, n] of Object.entries(allowed)) {
    if ((found[file] ?? 0) < n) problems.push(`${file}: now ${found[file] ?? 0} ${what} — lower the allowance from ${n}`);
  }
  return problems;
}

const literals = sqlLiterals();

describe('efficiency guard', () => {
  it('reads of growing tables are bounded (WHERE, LIMIT or COUNT)', () => {
    const hits: string[] = [];
    for (const { file, sql } of literals) {
      const m = growing.exec(sql);
      if (!m || !isSelect(sql)) continue;
      if (/\bWHERE\b|\bLIMIT\b|\bCOUNT\s*\(/i.test(sql)) continue;
      hits.push(file);
      if (process.env.PRINT_EFFICIENCY) console.log(`UNBOUNDED ${file}: ${sql.slice(0, 160)}`);
    }
    expect(compare(tally(hits), UNBOUNDED_ALLOWED, 'unbounded read(s) of a growing table'),
      'Add a WHERE/LIMIT (page it), or aggregate in SQL. Never load a whole history table.').toEqual([]);
  });

  it('filters on growing tables use an indexed column', () => {
    const indexes = leadingIndexColumns();
    const hits: string[] = [];
    for (const { file, sql } of literals) {
      const m = growing.exec(sql);
      if (!m || !isSelect(sql)) continue;
      const table = m[1].toLowerCase();
      // the main table's alias: columns qualified with another alias belong to joined tables
      const alias = (/^\s+(?:AS\s+)?`?(\w+)`?/i.exec(sql.slice(m.index + m[0].length))?.[1] ?? '').toLowerCase();
      const ownAlias = alias && !/^(where|join|left|inner|right|group|order|limit|on|cross)$/i.test(alias) ? alias : '';
      const where = /\bWHERE\b([\s\S]*?)(?:\bGROUP\s+BY\b|\bORDER\s+BY\b|\bLIMIT\b|\bHAVING\b|$)/i.exec(sql.slice(m.index));
      if (!where) continue;
      const all = [...where[1].matchAll(/(?:\b(\w+)\.)?`?(\w+)`?\s*(?:=|<=|>=|<>|!=|<|>|\bIN\s*\(|\bBETWEEN\b|\bIS\b|\bLIKE\b)/gi)];
      const own = (c: RegExpMatchArray) => !c[1] || c[1].toLowerCase() === ownAlias || c[1].toLowerCase() === table;
      if (all.some(c => !own(c))) continue; // filtered through a joined table — the database can start there
      const cols = all.filter(own)
        .map(c => c[2].toLowerCase()).filter(c => !/^\d/.test(c) && c !== 'not');
      if (!cols.length) continue; // built at run time — can't tell here
      if (cols.some(c => indexes.get(table)?.has(c))) continue;
      hits.push(file);
      if (process.env.PRINT_EFFICIENCY) console.log(`UNINDEXED ${file} [${table}: ${cols.join(',')}]: ${sql.slice(0, 160)}`);
    }
    expect(compare(tally(hits), UNINDEXED_ALLOWED, 'filter(s) on a growing table with no index'),
      'Add an index (new tenant migration) that starts with the column you filter on.').toEqual([]);
  });

  it('every growing table is cleaned up, or kept on purpose', () => {
    const cleaned = new Set<string>();
    for (const { sql } of literals) {
      const m = /^\s*DELETE\s+FROM\s+`?(\w+)`?/i.exec(sql);
      if (m && /INTERVAL|<\s*(?:\?|NOW|CURDATE|DATE_SUB|UTC_TIMESTAMP)/i.test(sql)) cleaned.add(m[1].toLowerCase());
    }
    // the nightly data-retention job names its tables at run time: deleteOlderThan…('table', days)
    const retention = readFileSync(join(SERVER, 'services', 'DataRetentionService.ts'), 'utf-8');
    for (const m of retention.matchAll(/deleteOlderThan\w*\(\s*'(\w+)'/g)) cleaned.add(m[1].toLowerCase());
    const missing = GROWING.filter(t => !cleaned.has(t) && !KEEP_FOREVER[t]);
    if (process.env.PRINT_EFFICIENCY) console.log('NO CLEANUP', missing);
    const unexpected = missing.filter(t => !NO_CLEANUP_ALLOWED.includes(t));
    const fixed = NO_CLEANUP_ALLOWED.filter(t => !missing.includes(t));
    expect(unexpected, 'Add a clean-up job (DELETE … WHERE created_at < NOW() - INTERVAL …), or list it in KEEP_FOREVER with the reason').toEqual([]);
    expect(fixed, 'These are cleaned up now — remove them from NO_CLEANUP_ALLOWED').toEqual([]);
  });

  it('heavy routes check a role or the project, and are rate-limited', () => {
    const HEAVY = /\/(?:[^'`]*[-/])?(export|verify|download|docx|pdf|import|bulk|rebuild|reindex|recalculate|simulate|scan|backfill|regenerate)\b/i;
    const GATE = /requireRole\(|requireAdmin|requireSuperAdmin|requireScope\('admin'\)|checkProjectRole|requireProjectAccess|checkEntityProjectAccess|readableProjectIds|adminOrPmo|orgAdminOnly|historyAdmin|Member\b|PM\b|Reader\b|Gate\b/;
    const LIMIT = /rateLimiter\.|rateLimit\s*:/;
    const hits: string[] = [];
    for (const f of walk(join(SERVER, 'routes'), '.ts')) {
      const s = readFileSync(f, 'utf-8');
      if (rel(f) === 'routes/core/auth.ts') continue; // e-mail links: the one-time token is the gate; auth is rate-limited per IP
      const fileLevel = /addHook\(\s*['"](?:onRequest|preHandler)['"][\s\S]{0,400}(?:requireRole|requireAdmin|requireSuperAdmin)/.test(s);
      for (const m of s.matchAll(/fastify\.(get|post|put|patch|delete)\(\s*(['`])([^'`]+)\2/g)) {
        if (!HEAVY.test(m[3])) continue;
        const next = s.indexOf('fastify.', m.index! + m[0].length);
        const body = s.slice(m.index!, next > 0 ? next : s.length).slice(0, 6000);
        const gated = fileLevel || GATE.test(body);
        const limited = LIMIT.test(body);
        if (gated && limited) continue;
        hits.push(rel(f));
        if (process.env.PRINT_EFFICIENCY) console.log(`HEAVY ${rel(f)} ${m[1].toUpperCase()} ${m[3]} — ${gated ? '' : 'no gate '}${limited ? '' : 'no rate limit'}`);
      }
    }
    expect(compare(tally(hits), HEAVY_ROUTE_ALLOWED, 'heavy route(s) without gate + rate limit'),
      'Gate it by role/project and add rateLimiter.check(...) or config.rateLimit.').toEqual([]);
  });

  it('the checks themselves still see the code (not silently empty)', () => {
    expect(literals.length).toBeGreaterThan(500);
    const idx = leadingIndexColumns();
    expect(idx.get('tasks')?.has('schedule_id')).toBe(true);
    expect(idx.get('notifications')?.has('user_id')).toBe(true);
    expect(idx.get('audit_ledger')?.has('project_id')).toBe(true);
  });
});
