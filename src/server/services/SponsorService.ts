import { databaseService } from '../database/connection';
import { riskRepository, type ProjectRisk } from '../database/RiskRepository';
import { projectMemberService } from './ProjectMemberService';
import { notificationService } from './NotificationService';
import { emailService } from './EmailService';
import { userService } from './UserService';
import { riskService } from './RiskService';
import { config } from '../config';
import { isExamplePerson } from '../utils/sampleData';
import logger from '../utils/logger';
import { needsEscalationPrompt } from '../utils/escalationPrompt';

// The prompt rule lives in utils/escalationPrompt.ts (pure, so the parity test can load it)
export { needsEscalationPrompt };

/**
 * Project sponsor + RAID escalation (Oct 2026, agreed with the user: the PM is in total control).
 *
 * A project names its sponsor — a person with a login, or one without (emailed). Nothing goes
 * to the sponsor automatically: when a risk or issue is Critical the PM sees a prompt on the
 * item ("Escalate to sponsor?" / "Not now"); only the project's Manager/Owner escalates, with
 * their own note. The sponsor reads — with a login they are a Viewer on the project; they never
 * edit the RAID log.
 */
export interface Sponsor {
  kind: 'user' | 'person';
  id: string;
  name: string;
  /** Shown only to the PM (choosing a sponsor); a viewer sees the name */
  email?: string;
}

export class SponsorError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

class SponsorService {
  async get(projectId: string, withEmail = false): Promise<Sponsor | null> {
    const rows = await databaseService.query<{ u: string | null; r: string | null }>(
      'SELECT sponsor_user_id AS u, sponsor_resource_id AS r FROM projects WHERE id = ?', [projectId]);
    const row = rows[0];
    if (!row) return null;
    if (row.u) {
      const user = await userService.findById(row.u).catch(() => null);
      if (!user) return null;
      return { kind: 'user', id: user.id, name: user.fullName || user.username, ...(withEmail ? { email: user.email } : {}) };
    }
    if (row.r) {
      const res = await databaseService.query<{ id: string; name: string; email: string | null }>(
        'SELECT id, name, email FROM resources WHERE id = ?', [row.r]);
      if (!res[0]) return null;
      return { kind: 'person', id: res[0].id, name: res[0].name, ...(withEmail ? { email: res[0].email || undefined } : {}) };
    }
    return null;
  }

  /** Who the PM can pick: the company's people with a login, then people without one (with an email) */
  async candidates(orgId: string | null): Promise<Sponsor[]> {
    const users = orgId ? await userService.listByOrganization(orgId) : [];
    const withLogin: Sponsor[] = users
      .filter(u => u.isActive && !u.isGuest)
      .map(u => ({ kind: 'user' as const, id: u.id, name: u.fullName || u.username, email: u.email }));
    const loginIds = new Set(withLogin.map(u => u.id));
    const people = await databaseService.query<{ id: string; name: string; email: string; user_id: string | null }>(
      `SELECT id, name, email, user_id FROM resources
        WHERE COALESCE(is_generic, 0) = 0 AND COALESCE(is_active, 1) = 1 AND email IS NOT NULL AND TRIM(email) <> ''
        ORDER BY name`, []);
    const withoutLogin: Sponsor[] = people
      .filter(p => !isExamplePerson(p) && !(p.user_id && loginIds.has(p.user_id)))
      .map(p => ({ kind: 'person' as const, id: p.id, name: p.name, email: p.email }));
    return [...withLogin.sort((a, b) => a.name.localeCompare(b.name)), ...withoutLogin];
  }

  /** Set or clear the sponsor. A sponsor with a login becomes a Viewer so they can read what is escalated. */
  async set(projectId: string, choice: { userId?: string | null; resourceId?: string | null }, orgId: string | null): Promise<Sponsor | null> {
    let userId: string | null = null;
    let resourceId: string | null = null;
    if (choice.userId) {
      const user = await userService.findById(choice.userId);
      const inCompany = orgId ? (await userService.listByOrganization(orgId)).some(u => u.id === choice.userId) : false;
      if (!user || !inCompany || user.isGuest) throw new SponsorError(400, 'Pick a sponsor from your company.');
      userId = user.id;
    } else if (choice.resourceId) {
      const res = await databaseService.query<{ id: string; email: string | null }>('SELECT id, email FROM resources WHERE id = ? AND COALESCE(is_generic, 0) = 0', [choice.resourceId]);
      if (!res[0] || isExamplePerson(res[0])) throw new SponsorError(400, 'Pick a sponsor from your people list.');
      if (!res[0].email?.trim()) throw new SponsorError(400, 'This person has no email address, so escalations could not reach them. Add their email in Resources first.');
      resourceId = res[0].id;
    }
    await databaseService.query('UPDATE projects SET sponsor_user_id = ?, sponsor_resource_id = ? WHERE id = ?', [userId, resourceId, projectId]);

    if (userId) {
      const member = await projectMemberService.findMembership(projectId, userId);
      if (!member) {
        const user = await userService.findById(userId);
        if (user) await projectMemberService.addMember(projectId, { userId, userName: user.fullName || user.username, email: user.email, role: 'viewer' });
      }
    }
    return this.get(projectId, true);
  }

  /** The PM escalates one RAID item to the sponsor, with a note */
  async escalate(projectId: string, item: ProjectRisk, note: string, byUserId: string, projectName: string): Promise<ProjectRisk | null> {
    const sponsor = await this.get(projectId, true);
    if (!sponsor) throw new SponsorError(400, 'Set a sponsor in the project details first.');

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const updated = await riskRepository.update(item.id, { escalatedAt: now, escalatedBy: byUserId });
    const pm = await userService.findById(byUserId).catch(() => null);
    const pmName = pm?.fullName || pm?.username || 'The project manager';
    // Recorded in the item's updates (the PM and the item's owner see it there)
    await riskService.addUpdate(item.id, projectId, byUserId, `Escalated to sponsor ${sponsor.name}: "${note}"`);

    const label = item.recordId || item.id;
    const typeLabel = item.type.charAt(0).toUpperCase() + item.type.slice(1);
    const subject = `Escalated to you: ${label} ${item.title} — ${projectName}`;
    const message = `${pmName} (project manager) has escalated this ${item.type} to you as sponsor. "${note}" — Severity ${item.severity}${item.dueDate ? `, due ${String(item.dueDate).slice(0, 10)}` : ''}.`;
    if (sponsor.kind === 'user' && sponsor.id !== byUserId) {
      await notificationService.create({
        userId: sponsor.id, type: 'raid_item', severity: item.severity === 'critical' ? 'critical' : 'high',
        title: `${typeLabel} escalated to you: ${item.title}`, message, projectId, linkType: 'raid', linkId: item.id,
      }).catch(err => logger.warn('Sponsor notification failed', { projectId, err: (err as Error).message }));
    }
    if (sponsor.email && sponsor.id !== byUserId) {
      const cta = sponsor.kind === 'user' ? `${config.APP_URL}/project/${projectId}?tab=raid` : undefined;
      await emailService.sendNotificationEmail(sponsor.email, subject, `${typeLabel} ${label} escalated to you`, message, cta, cta ? 'Open the item' : undefined)
        .catch(err => logger.warn('Sponsor email failed', { projectId, err: (err as Error).message }));
    }
    return updated;
  }

  async dismissPrompt(itemId: string): Promise<ProjectRisk | null> {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    return riskRepository.update(itemId, { escalationPromptDismissedAt: now });
  }
}

export const sponsorService = new SponsorService();
