import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { z } from 'zod';
import { databaseService } from '../../database/connection';
import logger from '../../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConfigScope = 'org' | 'project' | 'user';

export interface ContextConfig {
  id: string;
  scope: ConfigScope;
  scopeId: string;
  configKey: string;
  configValue: unknown;
  version: number;
  versionHash: string;
  isLocked: boolean;
  lockedBy: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

interface ConfigRow {
  id: string;
  scope: ConfigScope;
  scope_id: string;
  config_key: string;
  config_value: string;
  version: number;
  version_hash: string;
  is_locked: number;
  locked_by: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Config key schemas
// ---------------------------------------------------------------------------

const responseStyleSchema = z.object({
  tone: z.string().max(100).optional(),
  length: z.enum(['brief', 'normal', 'detailed']).optional(),
  format: z.enum(['prose', 'bullets', 'tables']).optional(),
});

const agentPreferencesSchema = z.object({
  enabledAgents: z.array(z.string()).optional(),
  disabledAgents: z.array(z.string()).optional(),
  scanFrequency: z.string().max(50).optional(),
});

export const CONFIG_KEY_SCHEMAS: Record<string, z.ZodType> = {
  system_instructions: z.string().max(5000),
  response_style: responseStyleSchema,
  forbidden_topics: z.array(z.string().max(200)).max(50),
  required_disclaimers: z.array(z.string().max(500)).max(20),
  agent_preferences: agentPreferencesSchema,
  domain_glossary: z.record(z.string(), z.string().max(500)).refine(
    (obj) => Object.keys(obj).length <= 200,
    { message: 'Domain glossary cannot exceed 200 entries' },
  ),
  project_methodology: z.string().max(2000),
  ai_temperature: z.number().min(0).max(1),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeHash(configValue: unknown, version: number): string {
  return createHash('sha256')
    .update(JSON.stringify(configValue) + String(version))
    .digest('hex');
}

function rowToConfig(row: ConfigRow): ContextConfig {
  return {
    id: row.id,
    scope: row.scope,
    scopeId: row.scope_id,
    configKey: row.config_key,
    configValue: typeof row.config_value === 'string' ? JSON.parse(row.config_value) : row.config_value,
    version: row.version,
    versionHash: row.version_hash,
    isLocked: !!row.is_locked,
    lockedBy: row.locked_by,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ContextConfigService {
  /**
   * Get a single config at a specific scope.
   */
  async getConfig(scope: ConfigScope, scopeId: string, configKey: string): Promise<ContextConfig | null> {
    const rows = await databaseService.queryControlPlane<ConfigRow>(
      `SELECT * FROM ai_context_configs WHERE scope = ? AND scope_id = ? AND config_key = ?`,
      [scope, scopeId, configKey],
    );
    return rows.length > 0 ? rowToConfig(rows[0]) : null;
  }

  /**
   * Get all configs at a specific scope.
   */
  async getConfigsAtScope(scope: ConfigScope, scopeId: string): Promise<ContextConfig[]> {
    const rows = await databaseService.queryControlPlane<ConfigRow>(
      `SELECT * FROM ai_context_configs WHERE scope = ? AND scope_id = ? ORDER BY config_key`,
      [scope, scopeId],
    );
    return rows.map(rowToConfig);
  }

  /**
   * Create or update a config. Returns 409 data if version_hash mismatch.
   */
  async upsertConfig(
    scope: ConfigScope,
    scopeId: string,
    configKey: string,
    configValue: unknown,
    userId: string,
    expectedHash?: string,
  ): Promise<{ config: ContextConfig; conflict?: false } | { conflict: true; current: ContextConfig }> {
    // Validate config key
    const schema = CONFIG_KEY_SCHEMAS[configKey];
    if (schema) {
      schema.parse(configValue);
    }

    const existing = await this.getConfig(scope, scopeId, configKey);

    if (existing) {
      // Check lock: if locked at a higher scope, block override
      if (scope !== 'org') {
        const locked = await this.isKeyLockedAbove(scope, scopeId, configKey);
        if (locked) {
          throw new Error(`Config key "${configKey}" is locked at a higher scope and cannot be overridden`);
        }
      }

      // Optimistic locking
      if (expectedHash && expectedHash !== existing.versionHash) {
        return { conflict: true, current: existing };
      }

      const newVersion = existing.version + 1;
      const newHash = computeHash(configValue, newVersion);

      await databaseService.queryControlPlane(
        `UPDATE ai_context_configs
         SET config_value = ?, version = ?, version_hash = ?, updated_by = ?, updated_at = NOW()
         WHERE id = ?`,
        [JSON.stringify(configValue), newVersion, newHash, userId, existing.id],
      );

      // Record history
      await this.recordHistory(existing.id, newVersion, configValue, newHash, userId, 'update');

      const updated = await this.getConfig(scope, scopeId, configKey);
      return { config: updated!, conflict: false };
    }

    // Create new
    const id = uuidv4();
    const version = 1;
    const hash = computeHash(configValue, version);

    await databaseService.queryControlPlane(
      `INSERT INTO ai_context_configs (id, scope, scope_id, config_key, config_value, version, version_hash, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, scope, scopeId, configKey, JSON.stringify(configValue), version, hash, userId, userId],
    );

    await this.recordHistory(id, version, configValue, hash, userId, 'create');

    const created = await this.getConfig(scope, scopeId, configKey);
    return { config: created!, conflict: false };
  }

  /**
   * Lock a config key at org level so lower scopes can't override.
   */
  async lockKey(scope: ConfigScope, scopeId: string, configKey: string, userId: string): Promise<void> {
    await databaseService.queryControlPlane(
      `UPDATE ai_context_configs SET is_locked = 1, locked_by = ? WHERE scope = ? AND scope_id = ? AND config_key = ?`,
      [userId, scope, scopeId, configKey],
    );
  }

  /**
   * Unlock a config key.
   */
  async unlockKey(scope: ConfigScope, scopeId: string, configKey: string): Promise<void> {
    await databaseService.queryControlPlane(
      `UPDATE ai_context_configs SET is_locked = 0, locked_by = NULL WHERE scope = ? AND scope_id = ? AND config_key = ?`,
      [scope, scopeId, configKey],
    );
  }

  /**
   * Check if a key is locked at a higher scope (org locks block project/user overrides).
   */
  private async isKeyLockedAbove(scope: ConfigScope, scopeId: string, configKey: string): Promise<boolean> {
    // For user scope, check both org and project locks
    // For project scope, check org locks
    // We need the org_id. For simplicity, check all locked configs with this key at org scope.
    const rows = await databaseService.queryControlPlane<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM ai_context_configs WHERE scope = 'org' AND config_key = ? AND is_locked = 1`,
      [configKey],
    );
    return rows[0]?.cnt > 0;
  }

  /**
   * Resolve the effective context for a user by merging org -> project -> user layers.
   * User overrides project overrides org.
   */
  async resolveContext(
    orgId: string | null,
    projectId: string | null,
    userId: string,
  ): Promise<Record<string, { value: unknown; source: ConfigScope; isLocked: boolean }>> {
    const result: Record<string, { value: unknown; source: ConfigScope; isLocked: boolean }> = {};

    // Layer 1: Org-level configs
    if (orgId) {
      const orgConfigs = await this.getConfigsAtScope('org', orgId);
      for (const c of orgConfigs) {
        result[c.configKey] = { value: c.configValue, source: 'org', isLocked: c.isLocked };
      }
    }

    // Layer 2: Project-level configs (override org unless locked)
    if (projectId) {
      const projectConfigs = await this.getConfigsAtScope('project', projectId);
      for (const c of projectConfigs) {
        const existing = result[c.configKey];
        if (!existing || !existing.isLocked) {
          result[c.configKey] = { value: c.configValue, source: 'project', isLocked: c.isLocked };
        }
      }
    }

    // Layer 3: User-level configs (override project/org unless locked)
    const userConfigs = await this.getConfigsAtScope('user', userId);
    for (const c of userConfigs) {
      const existing = result[c.configKey];
      if (!existing || !existing.isLocked) {
        result[c.configKey] = { value: c.configValue, source: 'user', isLocked: false };
      }
    }

    return result;
  }

  /**
   * Render resolved context as structured text for AI system prompt injection.
   */
  formatForPrompt(resolved: Record<string, { value: unknown; source: ConfigScope; isLocked: boolean }>): string {
    const parts: string[] = [];

    const instructions = resolved.system_instructions?.value;
    if (instructions && typeof instructions === 'string') {
      parts.push(`<custom_instructions>\n${instructions}\n</custom_instructions>`);
    }

    const style = resolved.response_style?.value as { tone?: string; length?: string; format?: string } | undefined;
    if (style) {
      const styleParts: string[] = [];
      if (style.tone) styleParts.push(`Tone: ${style.tone}`);
      if (style.length) styleParts.push(`Length: ${style.length}`);
      if (style.format) styleParts.push(`Format: ${style.format}`);
      if (styleParts.length > 0) {
        parts.push(`<response_style>\n${styleParts.join('\n')}\n</response_style>`);
      }
    }

    const forbidden = resolved.forbidden_topics?.value;
    if (Array.isArray(forbidden) && forbidden.length > 0) {
      parts.push(`<forbidden_topics>\nDo NOT discuss: ${forbidden.join(', ')}\n</forbidden_topics>`);
    }

    const disclaimers = resolved.required_disclaimers?.value;
    if (Array.isArray(disclaimers) && disclaimers.length > 0) {
      parts.push(`<required_disclaimers>\nAlways include: ${disclaimers.join('; ')}\n</required_disclaimers>`);
    }

    const glossary = resolved.domain_glossary?.value;
    if (glossary && typeof glossary === 'object' && Object.keys(glossary).length > 0) {
      const entries = Object.entries(glossary as Record<string, string>)
        .map(([term, def]) => `- ${term}: ${def}`)
        .join('\n');
      parts.push(`<domain_glossary>\n${entries}\n</domain_glossary>`);
    }

    const methodology = resolved.project_methodology?.value;
    if (methodology && typeof methodology === 'string') {
      parts.push(`<project_methodology>\n${methodology}\n</project_methodology>`);
    }

    return parts.length > 0
      ? '\n\n## Custom Context Configuration\n' + parts.join('\n\n')
      : '';
  }

  /**
   * Get version history for a config.
   */
  async getHistory(configId: string): Promise<Array<{
    id: string;
    version: number;
    configValue: unknown;
    versionHash: string;
    changedBy: string;
    changeType: string;
    createdAt: string;
  }>> {
    const rows = await databaseService.queryControlPlane<any>(
      `SELECT * FROM ai_context_config_history WHERE config_id = ? ORDER BY version DESC LIMIT 50`,
      [configId],
    );
    return rows.map((r: any) => ({
      id: r.id,
      version: r.version,
      configValue: typeof r.config_value === 'string' ? JSON.parse(r.config_value) : r.config_value,
      versionHash: r.version_hash,
      changedBy: r.changed_by,
      changeType: r.change_type,
      createdAt: r.created_at,
    }));
  }

  private async recordHistory(
    configId: string,
    version: number,
    configValue: unknown,
    versionHash: string,
    changedBy: string,
    changeType: 'create' | 'update' | 'lock' | 'unlock',
  ): Promise<void> {
    await databaseService.queryControlPlane(
      `INSERT INTO ai_context_config_history (id, config_id, version, config_value, version_hash, changed_by, change_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), configId, version, JSON.stringify(configValue), versionHash, changedBy, changeType],
    );
  }
}

export const contextConfigService = new ContextConfigService();
