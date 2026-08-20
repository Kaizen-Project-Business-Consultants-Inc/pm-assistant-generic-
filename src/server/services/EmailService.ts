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
      await this.getClient().emails.send(params as any);
      this.trackSend(true);
    } catch (err) {
      this.trackSend(false);
      throw err;
    }
  }

  private get isConfigured(): boolean {
    return !!config.RESEND_API_KEY;
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

    const bodyHtml = `
      <p style="color: #4b5563; line-height: 1.6;">
        Hi ${escapeHtml(name)}, your free trial ends ${daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`}.
      </p>
      <p style="color: #4b5563; line-height: 1.6;">
        Subscribe to the Consultant plan to keep access to all features — including AI insights, Gantt charts, EVM forecasting, and more.
      </p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${config.APP_URL}/pricing" style="background-color: #4f46e5; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
          View Plans
        </a>
      </div>
      <p style="color: #9ca3af; font-size: 14px;">
        If you choose not to subscribe, your data will be preserved and you'll retain read-only access.
      </p>
    `;

    await this.sendEmail({
      from: config.RESEND_FROM_EMAIL,
      to,
      subject,
      html: this.wrapHtml(subject, bodyHtml),
    });
  }

  async sendTrialExpiredEmail(to: string, name: string): Promise<void> {
    if (!this.isConfigured) {
      logger.info(`[EmailService] Trial expired email would be sent to ${maskPii(to)}`);
      return;
    }

    const bodyHtml = `
      <p style="color: #4b5563; line-height: 1.6;">
        Hi ${escapeHtml(name)}, your 14-day free trial has ended.
      </p>
      <p style="color: #4b5563; line-height: 1.6;">
        Your account is now in read-only mode. Subscribe to restore full access to all features.
      </p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${config.APP_URL}/pricing" style="background-color: #4f46e5; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
          Subscribe Now
        </a>
      </div>
      <p style="color: #9ca3af; font-size: 14px;">
        Your data is safe — subscribe anytime to pick up where you left off.
      </p>
    `;

    await this.sendEmail({
      from: config.RESEND_FROM_EMAIL,
      to,
      subject: 'Your Kovarti PM trial has ended',
      html: this.wrapHtml('Your trial has ended', bodyHtml),
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

  async sendOrgInviteEmail(to: string, orgName: string, inviterName: string): Promise<void> {
    if (!this.isConfigured) {
      logger.info(`[EmailService] Org invite email would be sent to ${maskPii(to)} for org "${orgName}"`);
      return;
    }

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
          <p style="color: #4b5563; line-height: 1.6;">
            Create your account to get started:
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${config.APP_URL}/register" style="background-color: #4f46e5; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
              Create Account
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
}

export const emailService = new EmailService();
