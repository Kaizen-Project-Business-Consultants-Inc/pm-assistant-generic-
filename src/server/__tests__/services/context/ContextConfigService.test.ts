import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../database/connection', () => ({
  databaseService: {
    query: vi.fn().mockResolvedValue([]),
    queryControlPlane: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('uuid', () => ({ v4: () => 'test-config-id' }));

import { ContextConfigService } from '../../../services/context/ContextConfigService';
import { databaseService } from '../../../database/connection';

const mockQuery = databaseService.queryControlPlane as ReturnType<typeof vi.fn>;

const sampleConfigRow = {
  id: 'cfg-1',
  scope: 'user',
  scope_id: 'user-1',
  config_key: 'system_instructions',
  config_value: JSON.stringify('Always be concise'),
  version: 1,
  version_hash: 'abc123',
  is_locked: 0,
  locked_by: null,
  created_by: 'user-1',
  updated_by: 'user-1',
  created_at: '2026-09-13 10:00:00',
  updated_at: '2026-09-13 10:00:00',
};

describe('ContextConfigService', () => {
  let service: ContextConfigService;

  beforeEach(() => {
    service = new ContextConfigService();
    vi.clearAllMocks();
  });

  describe('getConfig', () => {
    it('returns null when no config exists', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const result = await service.getConfig('user', 'user-1', 'system_instructions');
      expect(result).toBeNull();
    });

    it('returns config when it exists', async () => {
      mockQuery.mockResolvedValueOnce([sampleConfigRow]);
      const result = await service.getConfig('user', 'user-1', 'system_instructions');
      expect(result).not.toBeNull();
      expect(result!.configKey).toBe('system_instructions');
      expect(result!.configValue).toBe('Always be concise');
      expect(result!.isLocked).toBe(false);
    });
  });

  describe('getConfigsAtScope', () => {
    it('returns all configs at a scope', async () => {
      mockQuery.mockResolvedValueOnce([sampleConfigRow, { ...sampleConfigRow, id: 'cfg-2', config_key: 'ai_temperature', config_value: '0.7' }]);
      const results = await service.getConfigsAtScope('user', 'user-1');
      expect(results).toHaveLength(2);
    });
  });

  describe('upsertConfig', () => {
    it('creates new config when none exists', async () => {
      mockQuery
        .mockResolvedValueOnce([]) // getConfig check
        .mockResolvedValueOnce([]) // INSERT
        .mockResolvedValueOnce([]) // recordHistory INSERT
        .mockResolvedValueOnce([sampleConfigRow]); // getConfig after create

      const result = await service.upsertConfig('user', 'user-1', 'system_instructions', 'Always be concise', 'user-1');
      expect(result.conflict).toBeFalsy();
      if (!result.conflict) {
        expect(result.config.configKey).toBe('system_instructions');
      }
    });

    it('returns conflict when version hash mismatch on update', async () => {
      mockQuery.mockResolvedValueOnce([sampleConfigRow]); // getConfig returns existing
      mockQuery.mockResolvedValueOnce([{ cnt: 0 }]); // isKeyLockedAbove

      const result = await service.upsertConfig(
        'user', 'user-1', 'system_instructions', 'New value', 'user-1', 'wrong-hash',
      );
      expect(result.conflict).toBe(true);
    });

    it('updates config when version hash matches', async () => {
      mockQuery.mockResolvedValueOnce([sampleConfigRow]); // getConfig returns existing
      mockQuery.mockResolvedValueOnce([{ cnt: 0 }]); // isKeyLockedAbove
      mockQuery.mockResolvedValueOnce([]); // UPDATE
      mockQuery.mockResolvedValueOnce([]); // recordHistory
      mockQuery.mockResolvedValueOnce([{ ...sampleConfigRow, version: 2 }]); // getConfig after update

      const result = await service.upsertConfig(
        'user', 'user-1', 'system_instructions', 'Updated instructions', 'user-1', 'abc123',
      );
      expect(result.conflict).toBeFalsy();
    });

    it('throws on locked key override from lower scope', async () => {
      mockQuery.mockResolvedValueOnce([sampleConfigRow]); // getConfig
      mockQuery.mockResolvedValueOnce([{ cnt: 1 }]); // isKeyLockedAbove returns locked

      await expect(
        service.upsertConfig('user', 'user-1', 'system_instructions', 'Override', 'user-1'),
      ).rejects.toThrow(/locked/);
    });

    it('validates config value against schema', async () => {
      await expect(
        service.upsertConfig('user', 'user-1', 'ai_temperature', 5, 'user-1'),
      ).rejects.toThrow();
    });
  });

  describe('resolveContext', () => {
    it('merges org -> project -> user layers with user winning', async () => {
      const orgRow = { ...sampleConfigRow, scope: 'org', scope_id: 'org-1', config_value: JSON.stringify('Org instructions') };
      const userRow = { ...sampleConfigRow, scope: 'user', scope_id: 'user-1', config_value: JSON.stringify('User instructions') };

      // projectId=null → only 2 DB calls: org + user (no project query)
      mockQuery
        .mockResolvedValueOnce([orgRow]) // org configs
        .mockResolvedValueOnce([userRow]); // user configs

      const result = await service.resolveContext('org-1', null, 'user-1');
      expect(result.system_instructions.value).toBe('User instructions');
      expect(result.system_instructions.source).toBe('user');
    });

    it('respects locked org keys (user cannot override)', async () => {
      const orgRow = { ...sampleConfigRow, scope: 'org', scope_id: 'org-1', is_locked: 1, config_value: JSON.stringify('Locked org instructions') };
      const userRow = { ...sampleConfigRow, scope: 'user', scope_id: 'user-1', config_value: JSON.stringify('User override attempt') };

      // projectId=null → only 2 DB calls: org + user
      mockQuery
        .mockResolvedValueOnce([orgRow]) // org configs
        .mockResolvedValueOnce([userRow]); // user configs

      const result = await service.resolveContext('org-1', null, 'user-1');
      expect(result.system_instructions.value).toBe('Locked org instructions');
      expect(result.system_instructions.source).toBe('org');
      expect(result.system_instructions.isLocked).toBe(true);
    });
  });

  describe('formatForPrompt', () => {
    it('renders system instructions in XML tags', () => {
      const resolved = {
        system_instructions: { value: 'Be concise', source: 'user' as const, isLocked: false },
      };
      const prompt = service.formatForPrompt(resolved);
      expect(prompt).toContain('<custom_instructions>');
      expect(prompt).toContain('Be concise');
      expect(prompt).toContain('</custom_instructions>');
    });

    it('renders response style', () => {
      const resolved = {
        response_style: { value: { tone: 'professional', length: 'brief', format: 'bullets' }, source: 'user' as const, isLocked: false },
      };
      const prompt = service.formatForPrompt(resolved);
      expect(prompt).toContain('Tone: professional');
      expect(prompt).toContain('Length: brief');
    });

    it('renders forbidden topics', () => {
      const resolved = {
        forbidden_topics: { value: ['politics', 'religion'], source: 'org' as const, isLocked: true },
      };
      const prompt = service.formatForPrompt(resolved);
      expect(prompt).toContain('politics, religion');
    });

    it('renders domain glossary', () => {
      const resolved = {
        domain_glossary: { value: { WBS: 'Work Breakdown Structure', EVM: 'Earned Value Management' }, source: 'project' as const, isLocked: false },
      };
      const prompt = service.formatForPrompt(resolved);
      expect(prompt).toContain('WBS: Work Breakdown Structure');
    });

    it('returns empty string when no config set', () => {
      const prompt = service.formatForPrompt({});
      expect(prompt).toBe('');
    });
  });

  describe('getHistory', () => {
    it('returns version history', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'h-1', version: 2, config_value: JSON.stringify('v2'), version_hash: 'hash2', changed_by: 'user-1', change_type: 'update', created_at: '2026-09-13' },
        { id: 'h-2', version: 1, config_value: JSON.stringify('v1'), version_hash: 'hash1', changed_by: 'user-1', change_type: 'create', created_at: '2026-09-12' },
      ]);

      const history = await service.getHistory('cfg-1');
      expect(history).toHaveLength(2);
      expect(history[0].version).toBe(2);
    });
  });
});
