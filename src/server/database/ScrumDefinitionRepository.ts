import { BaseRepository } from './BaseRepository';
import { v4 as uuidv4 } from 'uuid';

export interface ScrumDefinitionCriterion {
  id: string;
  label: string;
  order: number;
}

export interface ScrumDefinition {
  id: string;
  projectId: string;
  type: 'dor' | 'dod';
  criteria: ScrumDefinitionCriterion[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const rowMapper = (row: any): ScrumDefinition => ({
  id: row.id,
  projectId: row.project_id,
  type: row.type,
  criteria: row.criteria ? (typeof row.criteria === 'string' ? JSON.parse(row.criteria) : row.criteria) : [],
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

class ScrumDefinitionRepository extends BaseRepository<ScrumDefinition> {
  constructor() {
    super('scrum_definitions', rowMapper);
  }

  async upsert(projectId: string, type: 'dor' | 'dod', criteria: ScrumDefinitionCriterion[], userId: string): Promise<ScrumDefinition> {
    const id = uuidv4();
    const criteriaJson = JSON.stringify(criteria);

    await this.queryRaw(
      `INSERT INTO scrum_definitions (id, project_id, type, criteria, created_by)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         criteria = VALUES(criteria),
         created_by = VALUES(created_by)`,
      [id, projectId, type, criteriaJson, userId],
    );

    const rows = await this.queryRaw(
      `SELECT * FROM scrum_definitions WHERE project_id = ? AND type = ?`,
      [projectId, type],
    );
    return rowMapper(rows[0]);
  }

  async findByProject(projectId: string): Promise<ScrumDefinition[]> {
    const rows = await this.queryRaw(
      `SELECT * FROM scrum_definitions WHERE project_id = ? ORDER BY type`,
      [projectId],
    );
    return rows.map(rowMapper);
  }

  async findByProjectAndType(projectId: string, type: 'dor' | 'dod'): Promise<ScrumDefinition | null> {
    const rows = await this.queryRaw(
      `SELECT * FROM scrum_definitions WHERE project_id = ? AND type = ?`,
      [projectId, type],
    );
    return rows.length > 0 ? rowMapper(rows[0]) : null;
  }
}

export const scrumDefinitionRepository = new ScrumDefinitionRepository();
