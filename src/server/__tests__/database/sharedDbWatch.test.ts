import { describe, it, expect, vi, beforeEach } from 'vitest';

const log = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('../../utils/logger', () => ({ default: log }));

import { tablesIn, companyTablesIn, noteSharedDbUse, SHARED_TABLES } from '../../database/sharedDbWatch';

describe('shared-database watch', () => {
  beforeEach(() => log.warn.mockClear());

  it('finds every table a statement names', () => {
    expect(tablesIn('SELECT * FROM tasks t JOIN schedules s ON s.id = t.schedule_id')).toEqual(['tasks', 'schedules']);
    expect(tablesIn('INSERT INTO notifications (id) VALUES (?)')).toEqual(['notifications']);
    expect(tablesIn('UPDATE `projects` SET name = ?')).toEqual(['projects']);
    expect(tablesIn('CREATE TABLE IF NOT EXISTS _migrations (id INT)')).toEqual(['_migrations']);
  });

  it('shared tables (accounts, companies, billing, plans) are not flagged', () => {
    expect(companyTablesIn('SELECT * FROM users u JOIN organizations o ON o.owner_user_id = u.id')).toEqual([]);
    expect(companyTablesIn('SELECT * FROM tier_features')).toEqual([]);
  });

  it('company tables used in the shared database are named, with the code that did it', () => {
    noteSharedDbUse('INSERT INTO tasks (id) VALUES (?)', 'query');
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0][0]).toMatch(/\[shared-db-watch\] company table "tasks" used in the SHARED database via query\(\) by .*sharedDbWatch\.test/);
  });

  it('person-level tables shared by design are not flagged: the bell and AI usage', () => {
    noteSharedDbUse('SELECT COUNT(*) FROM notifications WHERE user_id = ?', 'queryControlPlane');
    noteSharedDbUse('INSERT INTO ai_usage_log (id) VALUES (?)', 'queryControlPlane');
    expect(log.warn).not.toHaveBeenCalled();
  });

  // Guard: the shared database holds accounts, companies, billing and person-level data only.
  // Changing this list moves a table out of (or into) the watch — do it on purpose, here too.
  it('the shared-table list is the reviewed set', () => {
    expect([...SHARED_TABLES].sort()).toEqual([
      '_migrations', 'agent_skills', 'ai_context_config_history', 'ai_context_configs',
      'ai_conversations', 'ai_usage_log', 'api_key_usage_log', 'api_keys', 'automation_marketplace',
      'deleted_emails', 'dreaming_proposals', 'dreaming_runs', 'feedback', 'invite_tokens',
      'knowledge_base_chunks', 'memory_change_log', 'notifications', 'oauth_auth_codes',
      'oauth_clients', 'oauth_tokens', 'organizations', 'pricing_config', 'subscription_events',
      'subscriptions', 'support_sessions', 'template_marketplace', 'tier_features', 'token_top_ups',
      'users', 'waitlist',
    ]);
  });

  it('logs each table + caller once, so a busy job does not flood the log', () => {
    const run = () => noteSharedDbUse('SELECT * FROM schedules WHERE id = ?', 'query');
    run(); run(); run();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('never throws, whatever the input', () => {
    expect(() => noteSharedDbUse(undefined as any, 'query')).not.toThrow();
  });
});
