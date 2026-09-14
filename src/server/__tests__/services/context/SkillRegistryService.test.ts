import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../database/connection', () => ({
  databaseService: {
    query: vi.fn().mockResolvedValue([]),
    queryControlPlane: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('uuid', () => ({ v4: () => 'test-skill-id' }));

import { SkillRegistryService } from '../../../services/context/SkillRegistryService';
import { databaseService } from '../../../database/connection';

const mockQuery = databaseService.queryControlPlane as ReturnType<typeof vi.fn>;

const sampleSkillRow = {
  id: 'skill-1',
  skill_name: 'risk_analysis',
  category: 'analysis',
  summary: 'Analyze project risks and suggest mitigations',
  detailed_procedure: 'Step 1: Identify risks. Step 2: Assess probability...',
  applicable_roles: JSON.stringify(['admin', 'project_manager']),
  is_active: 1,
  created_by: 'user-1',
  created_at: '2026-09-13 10:00:00',
  updated_at: '2026-09-13 10:00:00',
};

describe('SkillRegistryService', () => {
  let service: SkillRegistryService;

  beforeEach(() => {
    service = new SkillRegistryService();
    vi.clearAllMocks();
  });

  describe('getSkillsForRole', () => {
    it('returns skills applicable to the role', async () => {
      mockQuery.mockResolvedValueOnce([
        sampleSkillRow,
        { ...sampleSkillRow, id: 'skill-2', skill_name: 'budget_tracking', applicable_roles: JSON.stringify(['admin']) },
      ]);

      const result = await service.getSkillsForRole('project_manager');
      expect(result).toHaveLength(1);
      expect(result[0].skillName).toBe('risk_analysis');
    });

    it('returns all skills when applicable_roles is null', async () => {
      mockQuery.mockResolvedValueOnce([
        { ...sampleSkillRow, applicable_roles: null },
      ]);

      const result = await service.getSkillsForRole('viewer');
      expect(result).toHaveLength(1);
    });

    it('excludes detailedProcedure from results', async () => {
      mockQuery.mockResolvedValueOnce([sampleSkillRow]);
      const result = await service.getSkillsForRole('admin');
      expect(result[0]).not.toHaveProperty('detailedProcedure');
    });
  });

  describe('getSkillDetail', () => {
    it('returns full skill including procedure', async () => {
      mockQuery.mockResolvedValueOnce([sampleSkillRow]);
      const result = await service.getSkillDetail('skill-1');
      expect(result).not.toBeNull();
      expect(result!.detailedProcedure).toContain('Step 1');
    });

    it('returns null for missing skill', async () => {
      mockQuery.mockResolvedValueOnce([]);
      expect(await service.getSkillDetail('missing')).toBeNull();
    });
  });

  describe('createSkill', () => {
    it('creates a skill and returns it', async () => {
      mockQuery.mockResolvedValueOnce([]); // INSERT
      mockQuery.mockResolvedValueOnce([sampleSkillRow]); // getSkillDetail

      const result = await service.createSkill({
        skillName: 'risk_analysis',
        summary: 'Analyze risks',
        category: 'analysis',
      }, 'user-1');

      expect(result.skillName).toBe('risk_analysis');
      expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO agent_skills');
    });
  });

  describe('updateSkill', () => {
    it('updates specified fields', async () => {
      mockQuery.mockResolvedValueOnce([]); // UPDATE
      mockQuery.mockResolvedValueOnce([{ ...sampleSkillRow, summary: 'Updated summary' }]); // getSkillDetail

      const result = await service.updateSkill('skill-1', { summary: 'Updated summary' });
      expect(result).not.toBeNull();
      expect(mockQuery.mock.calls[0][0]).toContain('summary = ?');
    });

    it('returns skill without changes when no fields provided', async () => {
      mockQuery.mockResolvedValueOnce([sampleSkillRow]);
      const result = await service.updateSkill('skill-1', {});
      expect(result).not.toBeNull();
    });
  });

  describe('formatSkillCatalogForPrompt', () => {
    it('groups skills by category', () => {
      const skills = [
        { id: '1', skillName: 'risk_analysis', category: 'analysis', summary: 'Analyze risks', applicableRoles: null, isActive: true, createdBy: 'u1', createdAt: '', updatedAt: '' },
        { id: '2', skillName: 'budget_report', category: 'reporting', summary: 'Generate reports', applicableRoles: null, isActive: true, createdBy: 'u1', createdAt: '', updatedAt: '' },
        { id: '3', skillName: 'scope_check', category: 'analysis', summary: 'Check scope', applicableRoles: null, isActive: true, createdBy: 'u1', createdAt: '', updatedAt: '' },
      ];

      const result = service.formatSkillCatalogForPrompt(skills);
      expect(result).toContain('## Available Skills');
      expect(result).toContain('### analysis');
      expect(result).toContain('### reporting');
      expect(result).toContain('**risk_analysis**');
      expect(result).toContain('**budget_report**');
    });

    it('returns empty string for empty skills', () => {
      expect(service.formatSkillCatalogForPrompt([])).toBe('');
    });
  });
});
