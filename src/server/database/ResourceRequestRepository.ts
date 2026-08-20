import { v4 as uuidv4 } from 'uuid';
import { databaseService } from './connection';

export interface ResourceRequest {
  id: string;
  projectId: string;
  requestedBy: string;
  resourceRole: string;
  resourceGroup: string | null;
  hoursNeeded: number;
  startDate: string;
  endDate: string;
  justification: string | null;
  skillsRequired: string[] | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'fulfilled' | 'cancelled';
  approvedBy: string | null;
  approvedAt: string | null;
  fulfilledResourceId: string | null;
  reviewerComment: string | null;
  createdAt: string;
  updatedAt: string;
  // Enrichment fields (from JOINs)
  projectName?: string;
  requestedByName?: string;
}

function mapRow(row: any): ResourceRequest {
  let skills: string[] | null = null;
  if (row.skills_required) {
    try {
      skills = typeof row.skills_required === 'string' ? JSON.parse(row.skills_required) : row.skills_required;
    } catch { skills = null; }
  }
  return {
    id: row.id,
    projectId: row.project_id,
    requestedBy: row.requested_by,
    resourceRole: row.resource_role,
    resourceGroup: row.resource_group,
    hoursNeeded: Number(row.hours_needed),
    startDate: row.start_date ? String(row.start_date).slice(0, 10) : '',
    endDate: row.end_date ? String(row.end_date).slice(0, 10) : '',
    justification: row.justification,
    skillsRequired: skills,
    priority: row.priority,
    status: row.status,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at ? String(row.approved_at) : null,
    fulfilledResourceId: row.fulfilled_resource_id,
    reviewerComment: row.reviewer_comment,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    projectName: row.project_name ?? undefined,
    requestedByName: row.requested_by_name ?? undefined,
  };
}

class ResourceRequestRepository {
  async findByProject(projectId: string, filters?: { status?: string; priority?: string }): Promise<ResourceRequest[]> {
    let where = 'rr.project_id = ?';
    const params: any[] = [projectId];
    if (filters?.status) { where += ' AND rr.status = ?'; params.push(filters.status); }
    if (filters?.priority) { where += ' AND rr.priority = ?'; params.push(filters.priority); }

    const rows = await databaseService.query<any>(
      `SELECT rr.*, p.name AS project_name
       FROM resource_requests rr
       JOIN projects p ON rr.project_id = p.id
       WHERE ${where}
       ORDER BY rr.created_at DESC`,
      params,
    );
    return rows.map(mapRow);
  }

  async findAll(filters?: { projectId?: string; status?: string; priority?: string }): Promise<ResourceRequest[]> {
    let where = '1=1';
    const params: any[] = [];
    if (filters?.projectId) { where += ' AND rr.project_id = ?'; params.push(filters.projectId); }
    if (filters?.status) { where += ' AND rr.status = ?'; params.push(filters.status); }
    if (filters?.priority) { where += ' AND rr.priority = ?'; params.push(filters.priority); }

    const rows = await databaseService.query<any>(
      `SELECT rr.*, p.name AS project_name
       FROM resource_requests rr
       JOIN projects p ON rr.project_id = p.id
       WHERE ${where}
       ORDER BY rr.created_at DESC
       LIMIT 200`,
      params,
    );
    return rows.map(mapRow);
  }

  async findPendingForApproval(): Promise<ResourceRequest[]> {
    const rows = await databaseService.query<any>(
      `SELECT rr.*, p.name AS project_name
       FROM resource_requests rr
       JOIN projects p ON rr.project_id = p.id
       WHERE rr.status = 'pending'
       ORDER BY rr.created_at ASC`,
    );
    return rows.map(mapRow);
  }

  async findById(id: string): Promise<ResourceRequest | null> {
    const rows = await databaseService.query<any>(
      `SELECT rr.*, p.name AS project_name
       FROM resource_requests rr
       JOIN projects p ON rr.project_id = p.id
       WHERE rr.id = ?`,
      [id],
    );
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async create(data: {
    projectId: string;
    requestedBy: string;
    resourceRole: string;
    resourceGroup?: string;
    hoursNeeded: number;
    startDate: string;
    endDate: string;
    justification?: string;
    skillsRequired?: string[];
    priority?: string;
  }): Promise<ResourceRequest> {
    const id = uuidv4();
    await databaseService.query(
      `INSERT INTO resource_requests (id, project_id, requested_by, resource_role, resource_group,
         hours_needed, start_date, end_date, justification, skills_required, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, data.projectId, data.requestedBy, data.resourceRole,
        data.resourceGroup || null, data.hoursNeeded, data.startDate, data.endDate,
        data.justification || null,
        data.skillsRequired ? JSON.stringify(data.skillsRequired) : null,
        data.priority || 'medium',
      ],
    );
    return (await this.findById(id))!;
  }

  async update(id: string, data: {
    resourceRole?: string;
    resourceGroup?: string;
    hoursNeeded?: number;
    startDate?: string;
    endDate?: string;
    justification?: string;
    skillsRequired?: string[];
    priority?: string;
  }): Promise<ResourceRequest> {
    const sets: string[] = [];
    const params: any[] = [];
    if (data.resourceRole !== undefined) { sets.push('resource_role = ?'); params.push(data.resourceRole); }
    if (data.resourceGroup !== undefined) { sets.push('resource_group = ?'); params.push(data.resourceGroup || null); }
    if (data.hoursNeeded !== undefined) { sets.push('hours_needed = ?'); params.push(data.hoursNeeded); }
    if (data.startDate !== undefined) { sets.push('start_date = ?'); params.push(data.startDate); }
    if (data.endDate !== undefined) { sets.push('end_date = ?'); params.push(data.endDate); }
    if (data.justification !== undefined) { sets.push('justification = ?'); params.push(data.justification); }
    if (data.skillsRequired !== undefined) { sets.push('skills_required = ?'); params.push(JSON.stringify(data.skillsRequired)); }
    if (data.priority !== undefined) { sets.push('priority = ?'); params.push(data.priority); }

    if (sets.length > 0) {
      params.push(id);
      await databaseService.query(
        `UPDATE resource_requests SET ${sets.join(', ')} WHERE id = ?`,
        params,
      );
    }
    return (await this.findById(id))!;
  }

  async updateStatus(id: string, status: string, extra?: { approvedBy?: string; fulfilledResourceId?: string; reviewerComment?: string }): Promise<ResourceRequest> {
    const sets = ['status = ?'];
    const params: any[] = [status];
    if (extra?.approvedBy) { sets.push('approved_by = ?', 'approved_at = NOW()'); params.push(extra.approvedBy); }
    if (extra?.fulfilledResourceId) { sets.push('fulfilled_resource_id = ?'); params.push(extra.fulfilledResourceId); }
    if (extra?.reviewerComment !== undefined) { sets.push('reviewer_comment = ?'); params.push(extra.reviewerComment); }
    params.push(id);
    await databaseService.query(
      `UPDATE resource_requests SET ${sets.join(', ')} WHERE id = ?`,
      params,
    );
    return (await this.findById(id))!;
  }

  async countByStatus(): Promise<Record<string, number>> {
    const rows = await databaseService.query<any>(
      'SELECT status, COUNT(*) AS cnt FROM resource_requests GROUP BY status',
    );
    const result: Record<string, number> = {};
    for (const r of rows) result[r.status] = Number(r.cnt);
    return result;
  }
}

export const resourceRequestRepository = new ResourceRequestRepository();
