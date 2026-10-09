import logger from '../utils/logger';

/**
 * Tables that genuinely belong in the shared (control-plane) database: accounts, companies,
 * billing, sign-in, plans, platform-wide libraries. Every other table is company data and
 * lives in each company's own database.
 *
 * The shared database still holds old copies of ~70 company tables from before each company
 * had its own database (Jul 2026). Code that runs with no company selected (scheduled jobs,
 * alerts, some admin and AI paths) and uses query() lands there silently — e.g. chats and
 * audit entries that no one can ever see. This watch names the code that does it (2026-09-30
 * clean-up).
 *
 * Reviewed set: a guard test pins it, so adding or removing a table is always a deliberate change.
 */
export const SHARED_TABLES = new Set([
  '_migrations',
  // The bell belongs to a person, not a company (also the platform admin's system alerts) — 2026-10-09
  'notifications',
  // Per-person AI usage: the monthly AI budget and billing follow the account — 2026-10-09
  'ai_usage_log',
  'agent_skills', 'ai_context_configs', 'ai_context_config_history', 'ai_conversations',
  'api_keys', 'api_key_usage_log', 'automation_marketplace', 'deleted_emails',
  'dreaming_proposals', 'dreaming_runs', 'feedback', 'invite_tokens', 'knowledge_base_chunks',
  'memory_change_log', 'oauth_auth_codes', 'oauth_clients', 'oauth_tokens', 'organizations',
  'pricing_config', 'subscriptions', 'subscription_events', 'template_marketplace',
  'tier_features', 'token_top_ups', 'users', 'waitlist', 'support_sessions',
]);

const TABLE_RE = /(?:\bFROM|\bINTO|\bUPDATE|\bJOIN|\bTABLE(?:\s+IF\s+(?:NOT\s+)?EXISTS)?)\s+`?(\w+)`?/gi;

/** Every table a statement names (FROM, INTO, UPDATE, JOIN, TABLE) */
export function tablesIn(sql: string): string[] {
  const out = new Set<string>();
  for (const m of sql.matchAll(TABLE_RE)) out.add(m[1].toLowerCase());
  return [...out];
}

/** Company tables a statement names — the ones that must never be used in the shared database */
export function companyTablesIn(sql: string): string[] {
  return tablesIn(sql).filter(t => !SHARED_TABLES.has(t) && !t.startsWith('information_schema') && t !== 'dual');
}

const seen = new Set<string>();

/** The first stack frame outside the database layer: the code that asked */
function caller(): string {
  const frames = (new Error().stack ?? '').split('\n').slice(2).map(l => l.trim());
  const own = /database[\\/](connection|BaseRepository|sharedDbWatch)\.[jt]s|node:internal|node_modules/;
  return (frames.find(f => !own.test(f)) ?? frames[0] ?? 'unknown').replace(/^at\s+/, '').slice(0, 200);
}

/**
 * Log (once per table + caller per process) a statement that uses company tables in the
 * shared database. Never throws — this is a watch, not a gate.
 */
export function noteSharedDbUse(sql: string, via: 'query' | 'queryControlPlane'): void {
  try {
    const tables = companyTablesIn(sql);
    if (tables.length === 0) return;
    const who = caller();
    for (const table of tables) {
      const key = `${table}|${who}`;
      if (seen.has(key)) continue;
      seen.add(key);
      logger.warn(`[shared-db-watch] company table "${table}" used in the SHARED database via ${via}() by ${who} — SQL: ${sql.replace(/\s+/g, ' ').slice(0, 140)}`);
    }
  } catch { /* never interfere with the query */ }
}
