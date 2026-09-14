import { v4 as uuidv4 } from 'uuid';
import { databaseService } from '../../database/connection';
import logger from '../../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentSkill {
  id: string;
  skillName: string;
  category: string;
  summary: string;
  detailedProcedure: string | null;
  applicableRoles: string[] | null;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface SkillRow {
  id: string;
  skill_name: string;
  category: string;
  summary: string;
  detailed_procedure: string | null;
  applicable_roles: string | null;
  is_active: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

function rowToSkill(row: SkillRow): AgentSkill {
  return {
    id: row.id,
    skillName: row.skill_name,
    category: row.category,
    summary: row.summary,
    detailedProcedure: row.detailed_procedure,
    applicableRoles: row.applicable_roles
      ? (typeof row.applicable_roles === 'string' ? JSON.parse(row.applicable_roles) : row.applicable_roles)
      : null,
    isActive: !!row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SkillRegistryService {
  /**
   * Get all active skills filtered by user role. Returns front-matter only (no detailed procedure).
   */
  async getSkillsForRole(role: string): Promise<Omit<AgentSkill, 'detailedProcedure'>[]> {
    const rows = await databaseService.queryControlPlane<SkillRow>(
      `SELECT id, skill_name, category, summary, applicable_roles, is_active, created_by, created_at, updated_at
       FROM agent_skills WHERE is_active = 1 ORDER BY category, skill_name`,
    );

    return rows
      .map(r => rowToSkill({ ...r, detailed_procedure: null }))
      .filter(skill => {
        if (!skill.applicableRoles) return true; // null = all roles
        return skill.applicableRoles.includes(role);
      })
      .map(({ detailedProcedure, ...rest }) => rest);
  }

  /**
   * Get full skill detail including detailed procedure.
   */
  async getSkillDetail(skillId: string): Promise<AgentSkill | null> {
    const rows = await databaseService.queryControlPlane<SkillRow>(
      `SELECT * FROM agent_skills WHERE id = ?`,
      [skillId],
    );
    return rows.length > 0 ? rowToSkill(rows[0]) : null;
  }

  /**
   * Create a new skill.
   */
  async createSkill(
    data: {
      skillName: string;
      category?: string;
      summary: string;
      detailedProcedure?: string;
      applicableRoles?: string[];
    },
    userId: string,
  ): Promise<AgentSkill> {
    const id = uuidv4();
    await databaseService.queryControlPlane(
      `INSERT INTO agent_skills (id, skill_name, category, summary, detailed_procedure, applicable_roles, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.skillName,
        data.category || 'general',
        data.summary,
        data.detailedProcedure || null,
        data.applicableRoles ? JSON.stringify(data.applicableRoles) : null,
        userId,
      ],
    );

    return (await this.getSkillDetail(id))!;
  }

  /**
   * Update a skill.
   */
  async updateSkill(
    skillId: string,
    data: {
      skillName?: string;
      category?: string;
      summary?: string;
      detailedProcedure?: string;
      applicableRoles?: string[];
      isActive?: boolean;
    },
  ): Promise<AgentSkill | null> {
    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (data.skillName !== undefined) { setClauses.push('skill_name = ?'); params.push(data.skillName); }
    if (data.category !== undefined) { setClauses.push('category = ?'); params.push(data.category); }
    if (data.summary !== undefined) { setClauses.push('summary = ?'); params.push(data.summary); }
    if (data.detailedProcedure !== undefined) { setClauses.push('detailed_procedure = ?'); params.push(data.detailedProcedure); }
    if (data.applicableRoles !== undefined) { setClauses.push('applicable_roles = ?'); params.push(JSON.stringify(data.applicableRoles)); }
    if (data.isActive !== undefined) { setClauses.push('is_active = ?'); params.push(data.isActive ? 1 : 0); }

    if (setClauses.length === 0) return this.getSkillDetail(skillId);

    params.push(skillId);
    await databaseService.queryControlPlane(
      `UPDATE agent_skills SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = ?`,
      params,
    );

    return this.getSkillDetail(skillId);
  }

  /**
   * Format skill front-matter as prompt context for agents.
   */
  formatSkillCatalogForPrompt(skills: Omit<AgentSkill, 'detailedProcedure'>[]): string {
    if (skills.length === 0) return '';

    const byCategory = new Map<string, typeof skills>();
    for (const skill of skills) {
      const cat = skill.category;
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(skill);
    }

    const parts: string[] = ['## Available Skills'];
    for (const [category, categorySkills] of byCategory) {
      parts.push(`\n### ${category}`);
      for (const skill of categorySkills) {
        parts.push(`- **${skill.skillName}**: ${skill.summary}`);
      }
    }

    return parts.join('\n');
  }
}

export const skillRegistryService = new SkillRegistryService();
