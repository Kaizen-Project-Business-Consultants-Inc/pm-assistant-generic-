import { Resend } from 'resend';
import { config } from '../config';
import logger, { maskPii } from '../utils/logger';
import { redisService } from './RedisService';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class EmailService {
  private resend: Resend | null = null;
  private sentCount = 0;
  private failedCount = 0;

  private getClient(): Resend {
    if (!this.resend) {
      if (!config.RESEND_API_KEY) {
        throw new Error('RESEND_API_KEY is not configured');
      }
      this.resend = new Resend(config.RESEND_API_KEY);
    }
    return this.resend;
  }

  private async sendEmail(params: { from: string; to: string | string[]; subject: string; html: string; attachments?: any[] }): Promise<void> {
    try {
      const result = await this.getClient().emails.send(params as any);
      if (result.error) {
        this.trackSend(false);
        const errMsg = `Resend API error: ${(result.error as any).message || JSON.stringify(result.error)}`;
        logger.error(errMsg);
        throw new Error(errMsg);
      }
      this.trackSend(true);
    } catch (err) {
      this.trackSend(false);
      throw err;
    }
  }

  private get isConfigured(): boolean {
    return !!config.RESEND_API_KEY;
  }

  /** Call on startup to verify the Resend API key is valid */
  async verifyConnection(): Promise<void> {
    if (!this.isConfigured) {
      logger.warn('[EmailService] RESEND_API_KEY not set — email sending is disabled');
      return;
    }
    try {
      const client = this.getClient();
      const result = await (client as any).domains.list();
      if (result.error) {
        logger.error(`[EmailService] *** RESEND API KEY IS INVALID *** — ${(result.error as any).message || JSON.stringify(result.error)}. No emails will be delivered!`);
      } else {
        const domainNames = (result.data?.data || []).map((d: any) => d.name).join(', ');
        logger.info(`[EmailService] Resend connection verified — domains: ${domainNames || 'none'}`);
      }
    } catch (err: any) {
      logger.error(`[EmailService] *** RESEND CONNECTION FAILED *** — ${err.message}. No emails will be delivered!`);
    }
  }

  private async trackSend(success: boolean): Promise<void> {
    if (success) this.sentCount++; else this.failedCount++;
    if (redisService.isConnected()) {
      const month = new Date().toISOString().slice(0, 7);
      const key = success ? `email:sent:${month}` : `email:failed:${month}`;
      redisService.getClient()?.incr(key).catch(() => {});
      redisService.getClient()?.expire(key, 86400 * 60).catch(() => {});
    }
  }

  getStats(): { sent: number; failed: number } {
    return { sent: this.sentCount, failed: this.failedCount };
  }

  static async getMonthlyStats(): Promise<{ sent: number; failed: number }> {
    if (!redisService.isConnected()) return { sent: 0, failed: 0 };
    const month = new Date().toISOString().slice(0, 7);
    const [sent, failed] = await Promise.all([
      redisService.get(`email:sent:${month}`),
      redisService.get(`email:failed:${month}`),
    ]);
    return { sent: parseInt(sent || '0', 10), failed: parseInt(failed || '0', 10) };
  }

  async sendVerificationEmail(to: string, token: string): Promise<void> {
    if (!this.isConfigured) {
      logger.warn(`[EmailService] RESEND_API_KEY not set — skipping verification email to ${maskPii(to)}`);
      return;
    }
    logger.info(`[EmailService] Sending verification email to ${maskPii(to)}`);

    const verifyUrl = `${config.APP_URL}/verify-email?token=${token}`;

    await this.sendEmail({
      from: config.RESEND_FROM_EMAIL,
      to,
      subject: 'Verify your Kovarti PM Assistant account',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #4f46e5; margin: 0;">Kovarti PM Assistant</h1>
          </div>
          <h2 style="color: #1f2937;">Verify your email address</h2>
          <p style="color: #4b5563; line-height: 1.6;">
            Thanks for signing up! Please verify your email address by clicking the button below.
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${verifyUrl}" style="background-color: #4f46e5; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
              Verify Email
            </a>
          </div>
          <p style="color: #9ca3af; font-size: 14px;">
            This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.
          </p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;" />
          <p style="color: #9ca3af; font-size: 12px; text-align: center;">
            Kovarti PM Assistant - AI-Powered Project Management
          </p>
        </div>
      `,
    });
  }

  async sendPasswordResetEmail(to: string, token: string): Promise<void> {
    if (!this.isConfigured) {
      logger.warn(`[EmailService] RESEND_API_KEY not set — skipping password reset email to ${maskPii(to)}`);
      return;
    }
    logger.info(`[EmailService] Sending password reset email to ${maskPii(to)}`);

    const resetUrl = `${config.APP_URL}/reset-password?token=${token}`;

    await this.sendEmail({
      from: config.RESEND_FROM_EMAIL,
      to,
      subject: 'Reset your Kovarti PM Assistant password',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #4f46e5; margin: 0;">Kovarti PM Assistant</h1>
          </div>
          <h2 style="color: #1f2937;">Reset your password</h2>
          <p style="color: #4b5563; line-height: 1.6;">
            We received a request to reset your password. Click the button below to choose a new password.
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${resetUrl}" style="background-color: #4f46e5; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
              Reset Password
            </a>
          </div>
          <p style="color: #9ca3af; font-size: 14px;">
            This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.
          </p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;" />
          <p style="color: #9ca3af; font-size: 12px; text-align: center;">
            Kovarti PM Assistant - AI-Powered Project Management
          </p>
        </div>
      `,
    });
  }

  private wrapHtml(title: string, bodyHtml: string): string {
    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="color: #4f46e5; margin: 0;">Kovarti PM Assistant</h1>
        </div>
        <h2 style="color: #1f2937;">${escapeHtml(title)}</h2>
        ${bodyHtml}
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;" />
        <p style="color: #9ca3af; font-size: 12px; text-align: center;">
          Kovarti PM Assistant - AI-Powered Project Management
        </p>
      </div>
    `;
  }

  async sendNotificationEmail(to: string, subject: string, title: string, message: string, ctaUrl?: string, ctaLabel?: string): Promise<void> {
    if (!this.isConfigured) {
      logger.info(`[EmailService] Notification email would be sent to ${maskPii(to)}: ${subject}`);
      return;
    }

    let bodyHtml = `<p style="color: #4b5563; line-height: 1.6;">${escapeHtml(message)}</p>`;
    if (ctaUrl) {
      bodyHtml += `
        <div style="text-align: center; margin: 32px 0;">
          <a href="${escapeHtml(ctaUrl)}" style="background-color: #4f46e5; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
            ${escapeHtml(ctaLabel || 'View Details')}
          </a>
        </div>
      `;
    }

    await this.sendEmail({
      from: config.RESEND_FROM_EMAIL,
      to,
      subject,
      html: this.wrapHtml(title, bodyHtml),
    });
  }

  async sendDigestEmail(to: string, name: string, digest: {
    overdueTasks: Array<{ name: string; dueDate: string }>;
    upcomingDeadlines: Array<{ name: string; dueDate: string }>;
    unreadCount: number;
    recentChanges: Array<{ category: string; action: string; count: number }> | number;
    actionItems?: Array<{ title: string; dueDate: string; meetingTitle: string }>;
    upcomingMeetings?: Array<{ title: string; scheduledDate: string; meetingType: string }>;
    activeSprints?: Array<{ name: string; pending: number; inProgress: number; completed: number; total: number }>;
  }): Promise<void> {
    if (!this.isConfigured) {
      logger.info(`[EmailService] Digest email would be sent to ${maskPii(to)}`);
      return;
    }

    const sectionStyle = 'margin-top: 24px; padding: 16px; border-radius: 8px;';

    let bodyHtml = `<p style="color: #4b5563; line-height: 1.6;">Hi ${escapeHtml(name)}, here's your project digest:</p>`;

    // Overdue Tasks
    if (digest.overdueTasks.length > 0) {
      bodyHtml += `<div style="${sectionStyle} background: #fef2f2; border-left: 4px solid #dc2626;">`;
      bodyHtml += `<h3 style="color: #dc2626; margin: 0 0 8px 0;">Overdue Tasks (${digest.overdueTasks.length})</h3><ul style="color: #4b5563; margin: 0;">`;
      for (const t of digest.overdueTasks.slice(0, 10)) {
        bodyHtml += `<li>${escapeHtml(t.name)} <span style="color: #9ca3af;">(due ${escapeHtml(t.dueDate)})</span></li>`;
      }
      bodyHtml += '</ul></div>';
    }

    // Upcoming Deadlines
    if (digest.upcomingDeadlines.length > 0) {
      bodyHtml += `<div style="${sectionStyle} background: #fffbeb; border-left: 4px solid #f59e0b;">`;
      bodyHtml += `<h3 style="color: #d97706; margin: 0 0 8px 0;">Upcoming Deadlines (${digest.upcomingDeadlines.length})</h3><ul style="color: #4b5563; margin: 0;">`;
      for (const t of digest.upcomingDeadlines.slice(0, 10)) {
        bodyHtml += `<li>${escapeHtml(t.name)} <span style="color: #9ca3af;">(due ${escapeHtml(t.dueDate)})</span></li>`;
      }
      bodyHtml += '</ul></div>';
    }

    // Meeting Action Items
    if (digest.actionItems && digest.actionItems.length > 0) {
      bodyHtml += `<div style="${sectionStyle} background: #faf5ff; border-left: 4px solid #7c3aed;">`;
      bodyHtml += `<h3 style="color: #7c3aed; margin: 0 0 8px 0;">Overdue Action Items (${digest.actionItems.length})</h3><ul style="color: #4b5563; margin: 0;">`;
      for (const a of digest.actionItems.slice(0, 10)) {
        bodyHtml += `<li>${escapeHtml(a.title)} <span style="color: #9ca3af;">(due ${escapeHtml(a.dueDate)}${a.meetingTitle ? ` — ${escapeHtml(a.meetingTitle)}` : ''})</span></li>`;
      }
      bodyHtml += '</ul></div>';
    }

    // Upcoming Meetings
    if (digest.upcomingMeetings && digest.upcomingMeetings.length > 0) {
      bodyHtml += `<div style="${sectionStyle} background: #eff6ff; border-left: 4px solid #3b82f6;">`;
      bodyHtml += `<h3 style="color: #2563eb; margin: 0 0 8px 0;">Upcoming Meetings (${digest.upcomingMeetings.length})</h3><ul style="color: #4b5563; margin: 0;">`;
      for (const m of digest.upcomingMeetings.slice(0, 10)) {
        const typeLabel = m.meetingType.replace(/_/g, ' ');
        bodyHtml += `<li>${escapeHtml(m.title)} <span style="color: #9ca3af;">(${escapeHtml(m.scheduledDate)} — ${escapeHtml(typeLabel)})</span></li>`;
      }
      bodyHtml += '</ul></div>';
    }

    // Active Sprint Summary
    if (digest.activeSprints && digest.activeSprints.length > 0) {
      bodyHtml += `<div style="${sectionStyle} background: #ecfdf5; border-left: 4px solid #059669;">`;
      bodyHtml += `<h3 style="color: #059669; margin: 0 0 8px 0;">Active Sprints</h3>`;
      for (const s of digest.activeSprints) {
        const pct = s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0;
        bodyHtml += `<p style="color: #4b5563; margin: 4px 0;"><strong>${escapeHtml(s.name)}</strong> — ${pct}% complete (${s.completed}/${s.total} tasks)</p>`;
        bodyHtml += `<div style="background: #d1d5db; border-radius: 4px; height: 8px; margin: 4px 0 8px 0;">`;
        bodyHtml += `<div style="background: #059669; border-radius: 4px; height: 8px; width: ${pct}%;"></div></div>`;
      }
      bodyHtml += '</div>';
    }

    // Recent changes section
    const changes = Array.isArray(digest.recentChanges) ? digest.recentChanges : [];
    if (changes.length > 0) {
      const grouped = new Map<string, Array<{ action: string; count: number }>>();
      for (const c of changes) {
        const cat = c.category;
        if (!grouped.has(cat)) grouped.set(cat, []);
        grouped.get(cat)!.push({ action: c.action, count: c.count });
      }

      bodyHtml += `<div style="${sectionStyle} background: #f0f9ff; border-left: 4px solid #0ea5e9;">`;
      bodyHtml += `<h3 style="color: #0284c7; margin: 0 0 8px 0;">Recent Activity</h3>`;
      for (const [category, items] of grouped) {
        const total = items.reduce((s, i) => s + i.count, 0);
        bodyHtml += `<p style="color: #4b5563; margin: 8px 0 4px 0;"><strong>${escapeHtml(category)}</strong> (${total} change${total > 1 ? 's' : ''})</p>`;
        bodyHtml += `<ul style="color: #6b7280; margin-top: 0;">`;
        for (const item of items.slice(0, 5)) {
          bodyHtml += `<li>${escapeHtml(item.action)}: ${item.count}</li>`;
        }
        bodyHtml += '</ul>';
      }
      bodyHtml += '</div>';
    }

    if (digest.unreadCount > 0) {
      bodyHtml += `<p style="color: #4b5563; margin-top: 16px;">You have <strong>${digest.unreadCount}</strong> unread notification${digest.unreadCount > 1 ? 's' : ''}.</p>`;
    }

    bodyHtml += `
      <div style="text-align: center; margin: 32px 0;">
        <a href="${config.APP_URL}/dashboard" style="background-color: #4f46e5; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
          Open Dashboard
        </a>
      </div>
    `;

    await this.sendEmail({
      from: config.RESEND_FROM_EMAIL,
      to,
      subject: `Your PM Assistant Digest`,
      html: this.wrapHtml(`Your Digest`, bodyHtml),
    });
  }

  async sendReportEmail(recipients: string[], reportName: string, csvContent: string): Promise<void> {
    if (!this.isConfigured) {
      logger.info(`[EmailService] Report email would be sent to ${recipients.map(r => maskPii(r)).join(', ')}: ${reportName}`);
      return;
    }

    const bodyHtml = `
      <p style="color: #4b5563; line-height: 1.6;">
        Your scheduled report <strong>${escapeHtml(reportName)}</strong> is attached as a CSV file.
      </p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${config.APP_URL}/report-builder" style="background-color: #4f46e5; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
          View Reports
        </a>
      </div>
    `;

    await this.sendEmail({
      from: config.RESEND_FROM_EMAIL,
      to: recipients,
      subject: `Scheduled Report: ${reportName}`,
      html: this.wrapHtml('Scheduled Report', bodyHtml),
      attachments: [
        {
          filename: `${reportName.replace(/[^a-zA-Z0-9-_]/g, '_')}.csv`,
          content: Buffer.from(csvContent).toString('base64'),
        },
      ],
    });
  }

  async sendStatusReportEmail(recipients: string[], projectName: string, htmlContent: string): Promise<void> {
    if (!this.isConfigured) {
      logger.info(`[EmailService] Status report email would be sent to ${recipients.map(r => maskPii(r)).join(', ')}: ${escapeHtml(projectName)}`);
      return;
    }

    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    // htmlContent is pre-rendered styled HTML from statusReportRenderer
    const bodyHtml = `
      ${htmlContent}
      <div style="text-align: center; margin: 32px 0;">
        <a href="${config.APP_URL}/dashboard" style="background-color: #4f46e5; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
          Open Dashboard
        </a>
      </div>
    `;

    await this.sendEmail({
      from: config.RESEND_FROM_EMAIL,
      to: recipients,
      subject: `Status Report: ${projectName} — ${date}`,
      html: this.wrapHtml(`Status Report: ${projectName}`, bodyHtml),
    });
  }

  async sendRAIDReportEmail(recipients: string[], projectName: string, htmlContent: string): Promise<void> {
    if (!this.isConfigured) {
      logger.info(`[EmailService] RAID report email would be sent to ${recipients.map(r => maskPii(r)).join(', ')}: ${escapeHtml(projectName)}`);
      return;
    }

    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const bodyHtml = `
      ${htmlContent}
      <div style="text-align: center; margin: 32px 0;">
        <a href="${config.APP_URL}/dashboard" style="background-color: #4f46e5; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
          Open Dashboard
        </a>
      </div>
    `;

    await this.sendEmail({
      from: config.RESEND_FROM_EMAIL,
      to: recipients,
      subject: `RAID Report: ${projectName} — ${date}`,
      html: this.wrapHtml(`RAID Report: ${projectName}`, bodyHtml),
    });
  }

  async sendStandupEmail(to: string, changes: any, narrative: string | null): Promise<void> {
    if (!this.isConfigured) {
      logger.info(`[EmailService] Standup email would be sent to ${maskPii(to)}`);
      return;
    }

    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    let bodyHtml = '';

    if (narrative) {
      bodyHtml += `<p style="color: #4b5563; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(narrative)}</p><hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />`;
    }

    const sections: Array<{ title: string; items: string[]; color: string }> = [
      { title: 'Completed', items: (changes.completions || []).map((c: any) => `${c.taskName} (by ${c.completedBy})`), color: '#059669' },
      { title: 'Status Changes', items: (changes.statusChanges || []).map((c: any) => `${c.taskName}: ${c.fromStatus} → ${c.toStatus}`), color: '#3b82f6' },
      { title: 'New Tasks', items: (changes.newTasks || []).map((c: any) => c.taskName), color: '#6366f1' },
      { title: 'New Risks', items: (changes.newRisks || []).map((c: any) => `${c.title} (${c.severity})`), color: '#f59e0b' },
      { title: 'Blockers', items: (changes.blockers || []).map((c: any) => c.taskName), color: '#dc2626' },
    ];

    for (const section of sections) {
      if (section.items.length > 0) {
        bodyHtml += `<h3 style="color: ${section.color}; margin-top: 16px;">${section.title} (${section.items.length})</h3><ul style="color: #4b5563;">`;
        for (const item of section.items.slice(0, 15)) {
          bodyHtml += `<li>${escapeHtml(item)}</li>`;
        }
        bodyHtml += '</ul>';
      }
    }

    if (!bodyHtml) {
      bodyHtml = '<p style="color: #6b7280;">No notable changes yesterday.</p>';
    }

    bodyHtml += `
      <div style="text-align: center; margin: 32px 0;">
        <a href="${config.APP_URL}/dashboard" style="background-color: #4f46e5; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
          Open Dashboard
        </a>
      </div>
    `;

    await this.sendEmail({
      from: config.RESEND_FROM_EMAIL,
      to,
      subject: `Standup Summary — ${date}`,
      html: this.wrapHtml('Daily Standup Summary', bodyHtml),
    });
  }

  async sendLoginVerificationEmail(to: string, token: string, username: string): Promise<void> {
    if (!this.isConfigured) {
      logger.warn(`[EmailService] RESEND_API_KEY not set — skipping login verification email to ${maskPii(to)}`);
      return;
    }
    logger.info(`[EmailService] Sending login verification email to ${maskPii(to)}`);

    const verifyUrl = `${config.APP_URL}/api/v1/auth/verify-login?token=${token}`;

    const bodyHtml = `
      <p style="color: #4b5563; line-height: 1.6;">
        Hi ${escapeHtml(username)}, someone is trying to sign in to your account. Click the button below to confirm this login.
      </p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${verifyUrl}" style="background-color: #4f46e5; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
          Confirm Login
        </a>
      </div>
      <p style="color: #9ca3af; font-size: 14px;">
        This link expires in 10 minutes. If you didn't try to log in, you can safely ignore this email.
      </p>
    `;

    await this.sendEmail({
      from: config.RESEND_FROM_EMAIL,
      to,
      subject: 'Confirm your Kovarti PM login',
      html: this.wrapHtml('Confirm your login', bodyHtml),
    });
  }

  async sendWelcomeEmail(to: string, name: string): Promise<void> {
    if (!this.isConfigured) {
      logger.info(`[EmailService] Welcome email would be sent to ${maskPii(to)}`);
      return;
    }

    await this.sendEmail({
      from: config.RESEND_FROM_EMAIL,
      to,
      subject: 'Welcome to Kovarti PM Assistant!',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #4f46e5; margin: 0;">Kovarti PM Assistant</h1>
          </div>
          <h2 style="color: #1f2937;">Welcome, ${escapeHtml(name)}!</h2>
          <p style="color: #4b5563; line-height: 1.6;">
            Your email has been verified and your account is ready to use. Start managing your projects with AI-powered insights.
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${config.APP_URL}/login" style="background-color: #4f46e5; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
              Sign In
            </a>
          </div>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;" />
          <p style="color: #9ca3af; font-size: 12px; text-align: center;">
            Kovarti PM Assistant - AI-Powered Project Management
          </p>
        </div>
      `,
    });
  }
  async sendTrialReminderEmail(to: string, name: string, daysLeft: number): Promise<void> {
    if (!this.isConfigured) {
      logger.info(`[EmailService] Trial reminder email would be sent to ${maskPii(to)} (${daysLeft} days left)`);
      return;
    }

    const subject = daysLeft === 1
      ? 'Your Kovarti PM trial ends tomorrow'
      : `Your Kovarti PM trial ends in ${daysLeft} days`;

    const escapedName = escapeHtml(name);
    const daysText = daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`;
    const pricingUrl = `${config.APP_URL}/pricing`;
    const preheader = `Your Kovarti PM trial ends ${daysText}. Upgrade now to keep your projects, AI assistant, and dashboards running.`;

    const html = this.buildTrialEmailHtml({
      preheader,
      badgeText: 'Trial ending soon',
      badgeColor: '#f59e0b',
      accentGradient: 'linear-gradient(90deg,#0d9488,#14b8a6,#0d9488)',
      headline: `Your trial ends ${daysText}`,
      bodyParagraphs: [
        `Hi ${escapedName}, your <strong style="color:#e8ecf1;">Kovarti PM</strong> free trial expires ${daysText}.`,
        'After your trial ends, your projects, dashboards, and AI features will become read-only. Your data and settings will be preserved — but you\'ll need an active plan to keep working.',
        'Upgrade now to lock in your setup and avoid any interruption.',
      ],
      ctaText: 'View Plans &amp; Upgrade →',
      ctaUrl: pricingUrl,
      ctaGradient: 'linear-gradient(135deg,#14b8a6,#0d9488)',
      ctaShadow: 'rgba(20,184,166,0.3)',
      infoPoints: [
        { emoji: '⚡', title: 'What you\'ll keep', text: 'All your projects, schedules, RAID logs, reports, and team settings carry over. Zero setup needed.' },
        { emoji: '💰', title: 'No surprise charges', text: 'You only pay when you choose to. Your trial is completely free until the end date.' },
        { emoji: '💬', title: 'Questions?', text: `Reply to this email or reach us at support@kovarti.com. We're happy to help you find the right plan.` },
      ],
    });

    await this.sendEmail({ from: config.RESEND_FROM_EMAIL, to, subject, html });
  }

  async sendTrialExpiredEmail(to: string, name: string): Promise<void> {
    if (!this.isConfigured) {
      logger.info(`[EmailService] Trial expired email would be sent to ${maskPii(to)}`);
      return;
    }

    const escapedName = escapeHtml(name);
    const pricingUrl = `${config.APP_URL}/pricing`;
    const preheader = 'Your Kovarti PM trial has ended. Subscribe now to restore full access to your projects and AI features.';

    const html = this.buildTrialEmailHtml({
      preheader,
      badgeText: 'Trial ended',
      badgeColor: '#ef4444',
      accentGradient: 'linear-gradient(90deg,#78716c,#dc2626,#78716c)',
      headline: 'Your free trial has ended',
      bodyParagraphs: [
        `Hi ${escapedName}, your 14-day <strong style="color:#e8ecf1;">Kovarti PM</strong> free trial has expired.`,
        'Your account is now in read-only mode — your projects, schedules, and data are all safely preserved. Subscribe to restore full access and pick up right where you left off.',
        'Plans start at just $19/month for core PM features, or $29/month with AI insights, Mjuzi assistant, and advanced forecasting.',
      ],
      ctaText: 'Subscribe Now →',
      ctaUrl: pricingUrl,
      ctaGradient: 'linear-gradient(135deg,#14b8a6,#0d9488)',
      ctaShadow: 'rgba(20,184,166,0.3)',
      infoPoints: [
        { emoji: '🔒', title: 'Your data is safe', text: 'All projects, schedules, RAID logs, reports, and settings are preserved. Subscribe anytime to unlock them.' },
        { emoji: '⚡', title: 'Instant reactivation', text: 'The moment you subscribe, everything is live again — no re-setup, no data loss, no waiting.' },
        { emoji: '💬', title: 'Need help deciding?', text: `Reply to this email or contact support@kovarti.com. We'll help you pick the right plan.` },
      ],
    });

    await this.sendEmail({ from: config.RESEND_FROM_EMAIL, to, subject: 'Your Kovarti PM trial has ended', html });
  }

  private buildTrialEmailHtml(opts: {
    preheader: string;
    badgeText: string;
    badgeColor: string;
    accentGradient: string;
    headline: string;
    bodyParagraphs: string[];
    ctaText: string;
    ctaUrl: string;
    ctaGradient: string;
    ctaShadow: string;
    infoPoints: Array<{ emoji: string; title: string; text: string }>;
  }): string {
    const infoRows = opts.infoPoints.map(p => `
      <tr><td style="padding-bottom:14px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:top;padding-right:12px;font-size:16px;line-height:22px;">${p.emoji}</td>
        <td><p style="margin:0;font-size:13px;line-height:20px;color:#5c6577;"><strong style="color:#8b95a5;">${p.title}</strong> — ${p.text}</p></td>
      </tr></table></td></tr>
    `).join('');

    const bodyParas = opts.bodyParagraphs.map(p =>
      `<p style="margin:0 0 12px 0;font-size:16px;line-height:26px;color:#8b95a5;">${p}</p>`
    ).join('');

    return `<!DOCTYPE html><html lang="en" xmlns="http://www.w3.org/1999/xhtml"><head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Kovarti PM</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}img{-ms-interpolation-mode:bicubic;border:0;height:auto;line-height:100%;outline:none;text-decoration:none}body{margin:0;padding:0;width:100%!important;height:100%!important}a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}
@media(prefers-color-scheme:dark){.email-bg{background-color:#0f1117!important}.email-card{background-color:#181b23!important}.text-primary{color:#e8ecf1!important}.text-secondary{color:#8b95a5!important}.divider{border-color:rgba(255,255,255,0.08)!important}}
@media only screen and (max-width:600px){.email-container{width:100%!important;padding:16px!important}.email-card{padding:32px 24px!important}.heading{font-size:24px!important;line-height:32px!important}.body-text{font-size:15px!important;line-height:24px!important}.cta-btn{padding:16px 32px!important;font-size:16px!important}.footer-text{font-size:12px!important}}
</style>
</head>
<body style="margin:0;padding:0;background-color:#0f1117;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;font-size:1px;color:#0f1117;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${opts.preheader}</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" class="email-bg" style="background-color:#0f1117;"><tr><td align="center" style="padding:40px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" width="560" class="email-container" style="max-width:560px;width:100%;">

<!-- Logo -->
<tr><td align="center" style="padding-bottom:32px;">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:middle;padding-right:10px;">
      <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#14b8a6,#0d9488);display:inline-block;text-align:center;line-height:36px;font-size:18px;color:#ffffff;">K</div>
    </td>
    <td style="font-family:'Inter',-apple-system,sans-serif;font-size:24px;font-weight:700;color:#e8ecf1;letter-spacing:-0.02em;">Kovarti <span style="color:#2dd4bf;">PM</span></td>
  </tr></table>
</td></tr>

<!-- Card -->
<tr><td>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" class="email-card" style="background-color:#181b23;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">
  <!-- Accent bar -->
  <tr><td style="height:5px;background:${opts.accentGradient};font-size:0;line-height:0;">&nbsp;</td></tr>
  <tr><td style="padding:48px 40px;">
    <!-- Badge -->
    <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-bottom:20px;">
      <div style="display:inline-block;padding:6px 14px;border-radius:20px;background:rgba(${opts.badgeColor === '#f59e0b' ? '245,158,11' : '239,68,68'},0.1);border:1px solid rgba(${opts.badgeColor === '#f59e0b' ? '245,158,11' : '239,68,68'},0.2);color:${opts.badgeColor};font-size:12px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;">${opts.badgeText}</div>
    </td></tr></table>

    <!-- Headline -->
    <h1 class="heading" style="margin:0 0 16px 0;font-family:'Inter',-apple-system,sans-serif;font-size:28px;font-weight:700;line-height:36px;color:#e8ecf1;letter-spacing:-0.02em;">${opts.headline}</h1>

    <!-- Body -->
    ${bodyParas}

    <!-- CTA -->
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:20px;"><tr><td align="center" style="padding-bottom:32px;">
      <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${opts.ctaUrl}" style="height:52px;v-text-anchor:middle;width:280px;" arcsize="50%" fillcolor="#14b8a6"><w:anchorlock /><center style="color:#ffffff;font-family:sans-serif;font-size:16px;font-weight:bold;">${opts.ctaText}</center></v:roundrect><![endif]-->
      <!--[if !mso]><!-->
      <a href="${opts.ctaUrl}" target="_blank" class="cta-btn" style="display:inline-block;padding:16px 40px;background:${opts.ctaGradient};color:#ffffff;font-family:'Inter',-apple-system,sans-serif;font-size:16px;font-weight:600;text-decoration:none;border-radius:50px;letter-spacing:0.02em;box-shadow:0 4px 20px ${opts.ctaShadow};mso-hide:all;">${opts.ctaText}</a>
      <!--<![endif]-->
    </td></tr></table>

    <!-- Divider + info points -->
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td class="divider" style="border-top:1px solid rgba(255,255,255,0.06);padding-top:24px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
        ${infoRows}
      </table>
    </td></tr></table>
  </td></tr>
</table>
</td></tr>

<!-- Footer -->
<tr><td style="padding:32px 0;text-align:center;">
  <p style="margin:0 0 8px 0;font-size:13px;color:#5c6577;">
    <a href="${config.APP_URL}" style="color:#2dd4bf;text-decoration:none;font-weight:500;">Website</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="${config.APP_URL}/pricing" style="color:#2dd4bf;text-decoration:none;font-weight:500;">Pricing</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="${config.APP_URL}/guide" style="color:#2dd4bf;text-decoration:none;font-weight:500;">Guide</a>
  </p>
  <p style="margin:0;font-size:11px;line-height:18px;color:#3d4555;">
    &copy; ${new Date().getFullYear()} Kovarti PM &middot; <a href="${config.APP_URL}/terms" style="color:#3d4555;text-decoration:underline;">Terms</a> &middot; <a href="${config.APP_URL}/privacy" style="color:#3d4555;text-decoration:underline;">Privacy</a>
  </p>
</td></tr>

</table>
</td></tr></table>
</body></html>`;
  }

  async sendProjectInviteEmail(to: string, params: {
    projectName: string;
    projectId: string;
    inviterName: string;
    role: string;
    isRegistered: boolean;
  }): Promise<void> {
    if (!this.isConfigured) {
      logger.info(`[EmailService] Project invite email would be sent to ${maskPii(to)} for project "${params.projectName}"`);
      return;
    }

    const { projectName, projectId, inviterName, role, isRegistered } = params;

    const ctaUrl = isRegistered
      ? `${config.APP_URL}/projects/${projectId}`
      : `${config.APP_URL}/register`;
    const ctaLabel = isRegistered ? 'View Project' : 'Create Account';

    const bodyHtml = `
      <p style="color: #4b5563; line-height: 1.6;">
        ${escapeHtml(inviterName)} has added you to <strong>${escapeHtml(projectName)}</strong> as <strong>${escapeHtml(role)}</strong>.
      </p>
      ${isRegistered
        ? '<p style="color: #4b5563; line-height: 1.6;">Click below to view the project.</p>'
        : '<p style="color: #4b5563; line-height: 1.6;">Create your free account to access the project and start collaborating.</p>'
      }
      <div style="text-align: center; margin: 32px 0;">
        <a href="${ctaUrl}" style="background-color: #4f46e5; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
          ${ctaLabel}
        </a>
      </div>
    `;

    await this.sendEmail({
      from: config.RESEND_FROM_EMAIL,
      to,
      subject: `You've been added to ${escapeHtml(projectName)} on Kovarti PM`,
      html: this.wrapHtml('You\'re invited!', bodyHtml),
    });
  }

  async sendResourceInviteEmail(to: string, params: {
    resourceName: string;
    role: string;
    inviterName: string;
    isRegistered: boolean;
    inviteToken?: string;
  }): Promise<void> {
    if (!this.isConfigured) {
      logger.info(`[EmailService] Resource invite email would be sent to ${maskPii(to)} (role: ${params.role})`);
      return;
    }

    const { resourceName, role, inviterName, isRegistered, inviteToken } = params;

    const ctaUrl = isRegistered
      ? `${config.APP_URL}/login`
      : `${config.APP_URL}/register${inviteToken ? `?invite=${inviteToken}` : ''}`;
    const ctaLabel = isRegistered ? 'Log In' : 'Create Account';

    const bodyHtml = `
      <p style="color: #4b5563; line-height: 1.6;">
        ${escapeHtml(inviterName)} has added you as a resource on <strong>Kovarti PM</strong> with the role <strong>${escapeHtml(role)}</strong>.
      </p>
      ${isRegistered
        ? '<p style="color: #4b5563; line-height: 1.6;">Log in to view your assignments and workload.</p>'
        : '<p style="color: #4b5563; line-height: 1.6;">Create your free account to view your assignments and start collaborating.</p>'
      }
      <div style="text-align: center; margin: 32px 0;">
        <a href="${ctaUrl}" style="background-color: #4f46e5; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
          ${ctaLabel}
        </a>
      </div>
    `;

    await this.sendEmail({
      from: config.RESEND_FROM_EMAIL,
      to,
      subject: `You've been added as ${escapeHtml(role)} on Kovarti PM`,
      html: this.wrapHtml('You\'re on the team!', bodyHtml),
    });
  }

  async sendViewerInviteEmail(to: string, orgName: string, inviterName: string, projectName: string | null, token: string): Promise<void> {
    if (!this.isConfigured) {
      logger.info(`[EmailService] Viewer invite email would be sent to ${maskPii(to)} for org "${orgName}"`);
      return;
    }

    const registerUrl = `${config.APP_URL}/register?invite=${token}`;
    const projectLine = projectName
      ? `<p style="color: #4b5563; line-height: 1.6;">You'll have access to the project: <strong>${escapeHtml(projectName)}</strong></p>`
      : '';

    const bodyHtml = `
      <p style="color: #4b5563; line-height: 1.6;">
        ${escapeHtml(inviterName)} has invited you to view projects on <strong>${escapeHtml(orgName)}</strong>.
      </p>
      ${projectLine}
      <p style="color: #4b5563; line-height: 1.6;">
        As a viewer, you can see project status, timelines, and update items assigned to you — all at no cost.
      </p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${registerUrl}" style="background-color: #4f46e5; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
          Accept Invitation
        </a>
      </div>
      <p style="color: #9ca3af; font-size: 14px;">
        This invitation expires in 7 days.
      </p>
    `;

    await this.sendEmail({
      from: config.RESEND_FROM_EMAIL,
      to,
      subject: `${escapeHtml(inviterName)} invited you to ${escapeHtml(orgName)} on Kovarti PM`,
      html: this.wrapHtml('You\'re invited!', bodyHtml),
    });
  }

  async sendApprovalActionEmail(to: string, crTitle: string, action: string, stepName: string, comment?: string, ctaUrl?: string): Promise<void> {
    if (!this.isConfigured) {
      logger.info(`[EmailService] Approval action email would be sent to ${maskPii(to)}: ${action}`);
      return;
    }

    const actionColors: Record<string, string> = {
      approved: '#059669',
      rejected: '#dc2626',
      returned: '#f59e0b',
    };
    const color = actionColors[action] || '#4b5563';
    const actionLabel = action.charAt(0).toUpperCase() + action.slice(1);

    let bodyHtml = `
      <p style="color: #4b5563; line-height: 1.6;">
        Your change request <strong>${escapeHtml(crTitle)}</strong> has been
        <span style="color: ${color}; font-weight: 600;">${escapeHtml(actionLabel)}</span>
        at step <strong>${escapeHtml(stepName)}</strong>.
      </p>
    `;

    if (comment) {
      bodyHtml += `
        <div style="margin: 16px 0; padding: 12px 16px; background: #f9fafb; border-left: 4px solid ${color}; border-radius: 4px;">
          <p style="color: #6b7280; font-size: 13px; margin: 0 0 4px 0;">Reviewer comment:</p>
          <p style="color: #374151; margin: 0;">${escapeHtml(comment)}</p>
        </div>
      `;
    }

    if (ctaUrl) {
      bodyHtml += `
        <div style="text-align: center; margin: 32px 0;">
          <a href="${escapeHtml(ctaUrl)}" style="background-color: #4f46e5; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
            View Change Request
          </a>
        </div>
      `;
    }

    await this.sendEmail({
      from: config.RESEND_FROM_EMAIL,
      to,
      subject: `Change Request ${actionLabel}: ${crTitle}`,
      html: this.wrapHtml(`Change Request ${actionLabel}`, bodyHtml),
    });
  }

  async sendMeetingMinutes(
    recipients: string[],
    meetingTitle: string,
    meetingDate: string,
    summary: string,
    actionItems: Array<{ description: string; assignee: string; dueDate?: string; priority: string }>,
    decisions: Array<{ decision: string; madeBy?: string }>,
    attendees: string[],
  ): Promise<void> {
    if (!this.isConfigured) {
      logger.info(`[EmailService] Meeting minutes email would be sent to ${recipients.map(r => maskPii(r)).join(', ')}: ${meetingTitle}`);
      return;
    }

    let bodyHtml = '';

    // Meeting header
    bodyHtml += `
      <div style="margin-bottom: 20px; padding: 16px; background: #f9fafb; border-radius: 8px;">
        <p style="color: #6b7280; margin: 0 0 4px 0; font-size: 13px;">Date: <strong style="color: #374151;">${escapeHtml(meetingDate)}</strong></p>
        <p style="color: #6b7280; margin: 0; font-size: 13px;">Attendees: ${attendees.map(a => escapeHtml(a)).join(', ')}</p>
      </div>
    `;

    // Summary
    bodyHtml += `
      <h3 style="color: #1f2937; margin: 24px 0 8px 0;">Summary</h3>
      <p style="color: #4b5563; line-height: 1.6;">${escapeHtml(summary)}</p>
    `;

    // Action items
    if (actionItems.length > 0) {
      const priorityColors: Record<string, string> = {
        critical: '#dc2626', high: '#f59e0b', medium: '#3b82f6', low: '#6b7280',
      };
      bodyHtml += `<h3 style="color: #1f2937; margin: 24px 0 8px 0;">Action Items (${actionItems.length})</h3>`;
      bodyHtml += `<table style="width: 100%; border-collapse: collapse; font-size: 14px;">`;
      bodyHtml += `<tr style="background: #f3f4f6;"><th style="text-align: left; padding: 8px; border: 1px solid #e5e7eb;">Action</th><th style="text-align: left; padding: 8px; border: 1px solid #e5e7eb;">Assignee</th><th style="text-align: left; padding: 8px; border: 1px solid #e5e7eb;">Due</th><th style="text-align: left; padding: 8px; border: 1px solid #e5e7eb;">Priority</th></tr>`;
      for (const item of actionItems) {
        const pColor = priorityColors[item.priority] || '#6b7280';
        bodyHtml += `<tr>`;
        bodyHtml += `<td style="padding: 8px; border: 1px solid #e5e7eb; color: #374151;">${escapeHtml(item.description)}</td>`;
        bodyHtml += `<td style="padding: 8px; border: 1px solid #e5e7eb; color: #374151;">${escapeHtml(item.assignee)}</td>`;
        bodyHtml += `<td style="padding: 8px; border: 1px solid #e5e7eb; color: #6b7280;">${item.dueDate ? escapeHtml(item.dueDate) : '-'}</td>`;
        bodyHtml += `<td style="padding: 8px; border: 1px solid #e5e7eb;"><span style="color: ${pColor}; font-weight: 600;">${escapeHtml(item.priority)}</span></td>`;
        bodyHtml += `</tr>`;
      }
      bodyHtml += `</table>`;
    }

    // Decisions
    if (decisions.length > 0) {
      bodyHtml += `<h3 style="color: #1f2937; margin: 24px 0 8px 0;">Decisions (${decisions.length})</h3>`;
      bodyHtml += `<ul style="color: #4b5563; line-height: 1.8;">`;
      for (const d of decisions) {
        bodyHtml += `<li>${escapeHtml(d.decision)}${d.madeBy ? ` <span style="color: #9ca3af;">— ${escapeHtml(d.madeBy)}</span>` : ''}</li>`;
      }
      bodyHtml += `</ul>`;
    }

    // CTA
    bodyHtml += `
      <div style="text-align: center; margin: 32px 0;">
        <a href="${config.APP_URL}/meetings" style="background-color: #4f46e5; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
          View in PM Assistant
        </a>
      </div>
    `;

    await this.sendEmail({
      from: config.RESEND_FROM_EMAIL,
      to: recipients,
      subject: `Meeting Minutes: ${meetingTitle} — ${meetingDate}`,
      html: this.wrapHtml(`Meeting Minutes: ${meetingTitle}`, bodyHtml),
    });
  }

  async sendOrgInviteEmail(to: string, orgName: string, inviterName: string, autoCreated?: { tempPassword: string; loginUrl: string }): Promise<void> {
    if (!this.isConfigured) {
      logger.info(`[EmailService] Org invite email would be sent to ${maskPii(to)} for org "${orgName}"${autoCreated ? ' (auto-created)' : ''}`);
      return;
    }

    const credentialsBlock = autoCreated ? `
          <p style="color: #4b5563; line-height: 1.6;">
            An account has been created for you. Log in with the following credentials:
          </p>
          <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <p style="margin: 4px 0; color: #1f2937;"><strong>Email:</strong> ${escapeHtml(to)}</p>
            <p style="margin: 4px 0; color: #1f2937;"><strong>Temporary Password:</strong> <code style="background: #e5e7eb; padding: 2px 6px; border-radius: 4px;">${escapeHtml(autoCreated.tempPassword)}</code></p>
          </div>
          <p style="color: #6b7280; font-size: 13px;">
            You will be asked to change your password on first login.
          </p>
    ` : `
          <p style="color: #4b5563; line-height: 1.6;">
            Create your account to get started:
          </p>
    `;

    const ctaUrl = autoCreated ? autoCreated.loginUrl : `${config.APP_URL}/register`;
    const ctaLabel = autoCreated ? 'Log In' : 'Create Account';

    await this.sendEmail({
      from: config.RESEND_FROM_EMAIL,
      to,
      subject: `You've been invited to join ${orgName} on Kovarti PM`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #4f46e5; margin: 0;">Kovarti PM Assistant</h1>
          </div>
          <h2 style="color: #1f2937;">You're invited!</h2>
          <p style="color: #4b5563; line-height: 1.6;">
            ${escapeHtml(inviterName)} has invited you to join <strong>${escapeHtml(orgName)}</strong> on Kovarti PM Assistant.
          </p>
          ${credentialsBlock}
          <div style="text-align: center; margin: 32px 0;">
            <a href="${ctaUrl}" style="background-color: #4f46e5; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
              ${ctaLabel}
            </a>
          </div>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;" />
          <p style="color: #9ca3af; font-size: 12px; text-align: center;">
            Kovarti PM Assistant - AI-Powered Project Management
          </p>
        </div>
      `,
    });
  }
  async sendWaitlistNotification(subscriberEmail: string): Promise<void> {
    if (!this.isConfigured) {
      logger.info(`[EmailService] Waitlist notification would be sent for ${maskPii(subscriberEmail)}`);
      return;
    }

    await this.sendEmail({
      from: config.RESEND_FROM_EMAIL,
      to: 'sales@kovarti.com',
      subject: `Early Bird Waitlist: ${subscriberEmail}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <h2 style="color: #4f46e5;">New Early Bird Signup</h2>
          <p style="color: #4b5563; line-height: 1.6;">
            A new visitor has joined the Kovarti PM waitlist:
          </p>
          <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <strong style="color: #1f2937;">${escapeHtml(subscriberEmail)}</strong>
          </div>
          <p style="color: #9ca3af; font-size: 12px;">
            Signed up at ${new Date().toISOString()}
          </p>
        </div>
      `,
    });
  }

  async sendLaunchAnnouncementEmail(to: string): Promise<void> {
    if (!this.isConfigured) {
      logger.info(`[EmailService] Launch announcement would be sent to ${maskPii(to)}`);
      return;
    }

    const signupUrl = `${config.APP_URL}/register`;

    await this.sendEmail({
      from: config.RESEND_FROM_EMAIL,
      to,
      subject: 'Kovarti PM is Live — Your Early Access Awaits',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #4f46e5; font-size: 28px; margin: 0;">Kovarti PM is Live!</h1>
            <p style="color: #6b7280; font-size: 16px; margin-top: 8px;">The wait is over.</p>
          </div>

          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            You signed up for early access to Kovarti PM, and we're excited to let you know — <strong>we just launched!</strong>
          </p>

          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            As a thank you for being an early supporter, here's what you get:
          </p>

          <ul style="color: #374151; font-size: 15px; line-height: 1.8; padding-left: 20px;">
            <li><strong>14-day free trial</strong> — full access, no credit card required</li>
            <li><strong>20% off</strong> your first year of Pro (annual plan)</li>
            <li><strong>Founders badge</strong> — exclusive to launch-week subscribers</li>
          </ul>

          <div style="text-align: center; margin: 32px 0;">
            <a href="${signupUrl}" style="display: inline-block; background: #4f46e5; color: white; font-weight: 600; font-size: 16px; padding: 14px 32px; border-radius: 8px; text-decoration: none;">
              Create Your Account
            </a>
          </div>

          <p style="color: #6b7280; font-size: 14px; line-height: 1.6;">
            The 20% launch discount expires one week after launch, so don't wait too long.
          </p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;" />

          <p style="color: #9ca3af; font-size: 12px; text-align: center;">
            You received this email because you joined the Kovarti PM waitlist.
            <br />If you no longer wish to receive emails, simply ignore this message.
          </p>
        </div>
      `,
    });
  }
}

export const emailService = new EmailService();
