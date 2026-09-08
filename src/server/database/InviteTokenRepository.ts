import { databaseService } from './connection';

export interface InviteToken {
  id: string;
  token: string;
  inviterUserId: string;
  organizationId: string;
  projectId: string | null;
  email: string;
  role: string;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedByUserId: string | null;
  createdAt: Date;
}

function mapRow(row: any): InviteToken {
  return {
    id: row.id,
    token: row.token,
    inviterUserId: row.inviter_user_id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    email: row.email,
    role: row.role,
    status: row.status,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    acceptedByUserId: row.accepted_by_user_id,
    createdAt: row.created_at,
  };
}

class InviteTokenRepository {
  async create(
    id: string, token: string, inviterUserId: string, organizationId: string,
    projectId: string | null, email: string, role: string, expiresAt: Date,
  ): Promise<void> {
    await databaseService.queryControlPlane(
      `INSERT INTO invite_tokens (id, token, inviter_user_id, organization_id, project_id, email, role, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, token, inviterUserId, organizationId, projectId, email, role, expiresAt],
    );
  }

  async findByToken(token: string): Promise<InviteToken | null> {
    const rows = await databaseService.queryControlPlane(
      `SELECT * FROM invite_tokens WHERE token = ? AND status = 'pending' AND expires_at > NOW()`,
      [token],
    );
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async findById(id: string): Promise<InviteToken | null> {
    const rows = await databaseService.queryControlPlane(
      'SELECT * FROM invite_tokens WHERE id = ?',
      [id],
    );
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async findByOrg(organizationId: string): Promise<InviteToken[]> {
    const rows = await databaseService.queryControlPlane(
      'SELECT * FROM invite_tokens WHERE organization_id = ? ORDER BY created_at DESC',
      [organizationId],
    );
    return rows.map(mapRow);
  }

  async markAccepted(id: string, userId: string): Promise<void> {
    await databaseService.queryControlPlane(
      `UPDATE invite_tokens SET status = 'accepted', accepted_at = NOW(), accepted_by_user_id = ? WHERE id = ?`,
      [userId, id],
    );
  }

  async revoke(id: string): Promise<void> {
    await databaseService.queryControlPlane(
      `UPDATE invite_tokens SET status = 'revoked' WHERE id = ?`,
      [id],
    );
  }

  async findPendingByEmailAndOrg(email: string, organizationId: string): Promise<InviteToken | null> {
    const rows = await databaseService.queryControlPlane(
      `SELECT * FROM invite_tokens WHERE LOWER(email) = LOWER(?) AND organization_id = ? AND status = 'pending' AND expires_at > NOW() LIMIT 1`,
      [email, organizationId],
    );
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async countActiveViewersByOrg(organizationId: string): Promise<number> {
    const rows = await databaseService.queryControlPlane(
      `SELECT COUNT(*) AS cnt FROM users WHERE organization_id = ? AND role = 'viewer'`,
      [organizationId],
    );
    return Number(rows[0].cnt);
  }
}

export const inviteTokenRepository = new InviteTokenRepository();
