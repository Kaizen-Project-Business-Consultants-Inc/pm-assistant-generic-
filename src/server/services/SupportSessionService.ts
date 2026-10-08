import { v4 as uuidv4 } from 'uuid';
import { databaseService } from '../database/connection';
import { organizationRepository } from '../database/OrganizationRepository';
import { runWithTenantContext } from '../middleware/requestContext';
import { auditLedgerService } from './AuditLedgerService';
import logger from '../utils/logger';

/**
 * Support view: the platform admin's read-only, recorded visit into ONE company, for
 * troubleshooting (product owner, 2026-09-30: "admin must not change customer data").
 *
 * - A visit needs a reason and lasts 30 minutes.
 * - It is recorded in the shared support_sessions table AND in that company's own audit
 *   trail, so the company's admin can see who looked, when and why.
 * - While it's active the server treats the admin as a read-only executive inside that
 *   company and refuses every change (tenantResolver + authMiddleware).
 */
export const SUPPORT_SESSION_MINUTES = 30;
export const SUPPORT_COOKIE = 'support_session';

export interface SupportSession {
  id: string;
  adminUserId: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  dbName: string;
  reason: string;
  startedAt: string;
  expiresAt: string;
}

export class SupportSessionError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

async function recordInCompanyAudit(s: SupportSession, action: 'support.view.started' | 'support.view.ended'): Promise<void> {
  // The company's own audit trail — this is what makes the visit visible to the customer.
  // Must succeed for a start: an unrecorded visit is not allowed.
  await runWithTenantContext(s.dbName, s.organizationId, () =>
    auditLedgerService.append({
      actorId: s.adminUserId,
      actorType: 'user',
      action,
      entityType: 'organization',
      entityId: s.organizationId,
      payload: { by: 'Kovarti platform support (read-only)', reason: s.reason, visitId: s.id, expiresAt: s.expiresAt },
      source: 'web',
    }),
  );
}

export class SupportSessionService {
  async start(input: { adminUserId: string; organizationId: string; reason: string; ipAddress?: string | null }): Promise<SupportSession> {
    const reason = input.reason.trim();
    if (reason.length < 10) throw new SupportSessionError('Say why you need to look (at least 10 characters) — the company sees this reason.');
    const org = await organizationRepository.findById(input.organizationId);
    if (!org) throw new SupportSessionError('That company no longer exists.', 404);
    if (!org.isActive || !org.isProvisioned || !org.dbName) throw new SupportSessionError("That company's workspace isn't active, so there's nothing to view.", 409);

    // One visit at a time per admin: starting a new one ends any other
    await this.endAllFor(input.adminUserId);

    const id = uuidv4();
    const minutes = SUPPORT_SESSION_MINUTES;
    await databaseService.queryControlPlane(
      `INSERT INTO support_sessions (id, admin_user_id, organization_id, reason, ip_address, expires_at)
       VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ${minutes} MINUTE))`,
      [id, input.adminUserId, org.id, reason, input.ipAddress ?? null],
    );
    const session = (await this.findActive(id, input.adminUserId))!;
    try {
      await recordInCompanyAudit(session, 'support.view.started');
    } catch (err) {
      // Not recorded in the company's trail = not allowed to start
      await databaseService.queryControlPlane('UPDATE support_sessions SET ended_at = NOW() WHERE id = ?', [id]);
      logger.error('[support] could not record the visit in the company audit trail — visit cancelled', { error: err instanceof Error ? err.message : String(err) });
      throw new SupportSessionError("The visit couldn't be recorded in the company's audit trail, so it wasn't started.", 500);
    }
    logger.info(`[support] ${input.adminUserId} started a read-only visit to ${org.slug}: ${reason}`);
    return session;
  }

  /** The admin's visit if it exists, belongs to them, hasn't ended and hasn't expired */
  async findActive(id: string | undefined, adminUserId: string): Promise<SupportSession | null> {
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    const rows = await databaseService.queryControlPlane<any>(
      `SELECT s.*, UNIX_TIMESTAMP(s.started_at) AS start_ts, UNIX_TIMESTAMP(s.expires_at) AS exp_ts,
              o.name AS org_name, o.slug AS org_slug, o.db_name AS org_db
       FROM support_sessions s JOIN organizations o ON o.id = s.organization_id
       WHERE s.id = ? AND s.admin_user_id = ? AND s.ended_at IS NULL AND s.expires_at > NOW()
         AND o.is_active = 1 AND o.is_provisioned = 1`,
      [id, adminUserId],
    );
    const r = rows[0];
    if (!r) return null;
    // Epoch seconds from the database itself: no guessing about its timezone
    const iso = (epochSeconds: unknown) => new Date(Number(epochSeconds) * 1000).toISOString();
    return {
      id: r.id, adminUserId: r.admin_user_id, organizationId: r.organization_id,
      organizationName: r.org_name, organizationSlug: r.org_slug, dbName: r.org_db,
      reason: r.reason, startedAt: iso(r.start_ts), expiresAt: iso(r.exp_ts),
    };
  }

  async end(id: string | undefined, adminUserId: string): Promise<void> {
    const s = await this.findActive(id, adminUserId);
    if (!s) return;
    await databaseService.queryControlPlane('UPDATE support_sessions SET ended_at = NOW() WHERE id = ? AND ended_at IS NULL', [s.id]);
    await recordInCompanyAudit(s, 'support.view.ended').catch(err =>
      logger.warn('[support] visit ended but the end could not be written to the company audit trail', { error: err instanceof Error ? err.message : String(err) }));
  }

  /** Every support visit into one company, newest first — what the company's owner sees */
  async listForOrganization(organizationId: string, limit = 100): Promise<Array<{ id: string; reason: string; startedAt: string; endedAt: string | null; expiresAt: string; active: boolean }>> {
    const rows = await databaseService.queryControlPlane<any>(
      `SELECT id, reason, UNIX_TIMESTAMP(started_at) AS start_ts, UNIX_TIMESTAMP(ended_at) AS end_ts,
              UNIX_TIMESTAMP(expires_at) AS exp_ts, (ended_at IS NULL AND expires_at > NOW()) AS active
       FROM support_sessions WHERE organization_id = ? ORDER BY started_at DESC LIMIT ?`,
      [organizationId, Math.min(Math.max(limit, 1), 500)],
    );
    const iso = (s: unknown) => (s == null ? null : new Date(Number(s) * 1000).toISOString());
    return rows.map(r => ({
      id: r.id, reason: r.reason, startedAt: iso(r.start_ts)!, endedAt: iso(r.end_ts), expiresAt: iso(r.exp_ts)!, active: !!Number(r.active),
    }));
  }

  private async endAllFor(adminUserId: string): Promise<void> {
    const open = await databaseService.queryControlPlane<{ id: string }>(
      'SELECT id FROM support_sessions WHERE admin_user_id = ? AND ended_at IS NULL AND expires_at > NOW()', [adminUserId]);
    // eslint-disable-next-line no-await-in-loop -- an admin has at most one open support session, so this ends zero or one
    for (const o of open) await this.end(o.id, adminUserId);
  }
}

export const supportSessionService = new SupportSessionService();
