import { config } from '../../config';
import logger from '../../utils/logger';

const AUTH_BASE = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// ChannelMessage.Send / Team.ReadBasic.All / Channel.ReadBasic.All must be
// granted (with tenant admin consent) on the same Azure app registration
// MICROSOFT_CLIENT_ID/MICROSOFT_CLIENT_SECRET already point to for OneDrive.
// There is no webhook fallback the way Slack has one — Microsoft is retiring
// Teams' old Incoming Webhook connectors, so every customer's admin has to
// grant this consent before Teams notifications can work at all.
const SCOPES = 'ChannelMessage.Send Team.ReadBasic.All Channel.ReadBasic.All offline_access';

export interface TeamsConfig {
  teamId?: string;
  teamName?: string;
  channelId?: string;
  channelName?: string;
  notifyEvents?: string[];
  // Stored by the OAuth callback — this tenant's own credentials.
  accessToken?: string;
  refreshToken?: string;
  /** Epoch ms. Unlike Slack's long-lived bot token, this expires (~1hr). */
  expiresAt?: number;
}

export function canPostToTeams(teamsConfig: TeamsConfig): boolean {
  return !!teamsConfig.accessToken && !!teamsConfig.teamId && !!teamsConfig.channelId;
}

/**
 * Graph API error codes mean nothing to a project manager. Say what they can
 * do about it, the same way SlackAdapter's describeSlackError does.
 */
function describeTeamsError(status: number, body: string): string {
  if (status === 401) return 'Microsoft Teams no longer accepts this connection. Disconnect and connect again.';
  if (status === 403) return 'Kovarti is not allowed to post in this channel. Reconnect and re-grant the requested permissions.';
  if (status === 404) return 'This team or channel no longer exists. Reconnect and choose another.';
  if (status === 429) return 'Microsoft Teams is rate limiting us. Try again in a minute.';
  return `Microsoft Teams returned ${status}: ${body.slice(0, 200)}`;
}

export class TeamsAdapter {
  buildOAuthUrl(state: string): string {
    const clientId = config.MICROSOFT_CLIENT_ID;
    if (!clientId) throw new Error('MICROSOFT_CLIENT_ID not configured');
    const redirectUri = `${config.APP_URL}/api/v1/teams/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: SCOPES,
      state,
      prompt: 'select_account',
    });
    return `${AUTH_BASE}/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
    const clientId = config.MICROSOFT_CLIENT_ID;
    const clientSecret = config.MICROSOFT_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('Microsoft OAuth not configured');
    const redirectUri = `${config.APP_URL}/api/v1/teams/callback`;

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      scope: SCOPES,
    });

    const resp = await fetch(`${AUTH_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!resp.ok) {
      const text = await resp.text();
      logger.error('Teams token exchange failed', { status: resp.status, body: text });
      throw new Error(`Token exchange failed: ${resp.status}`);
    }
    return resp.json() as Promise<any>;
  }

  async refreshAccessToken(refreshTokenValue: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
    const clientId = config.MICROSOFT_CLIENT_ID;
    const clientSecret = config.MICROSOFT_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('Microsoft OAuth not configured');

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshTokenValue,
      grant_type: 'refresh_token',
      scope: SCOPES,
    });

    const resp = await fetch(`${AUTH_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!resp.ok) {
      const text = await resp.text();
      logger.error('Teams token refresh failed', { status: resp.status, body: text });
      throw new Error(`Token refresh failed: ${resp.status}`);
    }
    return resp.json() as Promise<any>;
  }

  async listTeams(accessToken: string): Promise<{ id: string; name: string }[]> {
    const resp = await fetch(`${GRAPH_BASE}/me/joinedTeams`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) throw new Error(`Failed to list teams: ${resp.status}`);
    const data: any = await resp.json();
    return (data.value || []).map((t: any) => ({ id: t.id, name: t.displayName }));
  }

  async listChannels(accessToken: string, teamId: string): Promise<{ id: string; name: string }[]> {
    const resp = await fetch(`${GRAPH_BASE}/teams/${teamId}/channels`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) throw new Error(`Failed to list channels: ${resp.status}`);
    const data: any = await resp.json();
    return (data.value || []).map((c: any) => ({ id: c.id, name: c.displayName }));
  }

  /**
   * Every Graph call for a stored integration must go through this first.
   * A stale access token would otherwise fail the whole notification instead
   * of transparently refreshing — Slack's bot token never expires, so this
   * has no equivalent there; it is new behaviour, not a copy of anything.
   */
  async ensureFreshToken(integrationId: string, teamsConfig: TeamsConfig): Promise<string | null> {
    const REFRESH_SKEW_MS = 60_000; // refresh a minute before actual expiry
    if (teamsConfig.accessToken && teamsConfig.expiresAt && teamsConfig.expiresAt - Date.now() > REFRESH_SKEW_MS) {
      return teamsConfig.accessToken;
    }
    if (!teamsConfig.refreshToken) return null;

    try {
      const token = await this.refreshAccessToken(teamsConfig.refreshToken);
      const updated: TeamsConfig = {
        ...teamsConfig,
        accessToken: token.access_token,
        refreshToken: token.refresh_token || teamsConfig.refreshToken,
        expiresAt: Date.now() + token.expires_in * 1000,
      };
      const { integrationRepository } = await import('../../database/IntegrationRepository');
      await integrationRepository.updateIntegration(integrationId, { config: updated });
      return updated.accessToken!;
    } catch (err: any) {
      logger.warn('TeamsAdapter: token refresh failed', { integrationId, error: err.message });
      return null;
    }
  }

  async testConnection(integrationId: string, teamsConfig: TeamsConfig): Promise<{ success: boolean; message: string }> {
    if (!canPostToTeams(teamsConfig)) {
      return { success: false, message: 'Choose a team and channel first, then test again.' };
    }
    const accessToken = await this.ensureFreshToken(integrationId, teamsConfig);
    if (!accessToken) {
      return { success: false, message: 'Microsoft Teams no longer accepts this connection. Disconnect and connect again.' };
    }
    const card = this.simpleCard('Kovarti is connected.', 'Project notifications will appear here.');
    return this.post(accessToken, teamsConfig.teamId!, teamsConfig.channelId!, card, 'Kovarti is connected. Project notifications will appear here.');
  }

  /** The one way notifications leave the product, mirroring SlackAdapter.deliver. */
  async deliver(integrationId: string, teamsConfig: TeamsConfig, message: { text: string; card?: any }): Promise<{ success: boolean; message: string }> {
    if (!canPostToTeams(teamsConfig)) return { success: false, message: 'No channel configured' };
    const accessToken = await this.ensureFreshToken(integrationId, teamsConfig);
    if (!accessToken) return { success: false, message: 'Microsoft Teams connection expired. Reconnect to resume notifications.' };
    return this.post(accessToken, teamsConfig.teamId!, teamsConfig.channelId!, message.card, message.text);
  }

  private async post(accessToken: string, teamId: string, channelId: string, card: any, text: string): Promise<{ success: boolean; message: string }> {
    try {
      const body = card
        ? { body: { contentType: 'html', content: text }, attachments: [{ id: '1', contentType: 'application/vnd.microsoft.card.adaptive', content: JSON.stringify(card) }] }
        : { body: { contentType: 'text', content: text } };

      const resp = await fetch(`${GRAPH_BASE}/teams/${teamId}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(body),
      });

      if (resp.ok) return { success: true, message: 'Message sent' };
      const errText = await resp.text();
      return { success: false, message: describeTeamsError(resp.status, errText) };
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to post message' };
    }
  }

  private simpleCard(title: string, subtitle: string): any {
    return {
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.4',
      body: [
        { type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium' },
        { type: 'TextBlock', text: subtitle, wrap: true },
      ],
    };
  }

  private facts(pairs: [string, string][]): any {
    return { type: 'FactSet', facts: pairs.map(([title, value]) => ({ title, value })) };
  }

  /**
   * Mirrors SlackAdapter.buildEventBlocks — same 12 event types, rendered as
   * an Adaptive Card instead of Slack Block Kit. Interactive approve/reject
   * buttons are not built for v1: Teams Adaptive Card actions need a bot
   * framework registration beyond this OAuth-only integration's scope.
   */
  buildEventCards(event: string, payload: Record<string, any>): { text: string; card?: any } | null {
    switch (event) {
      case 'task.completed':
      case 'task.updated': {
        const task = payload.task;
        if (!task) return null;
        if (event === 'task.updated' && task.status !== 'completed') return null;
        const text = `Task completed: ${task.name}`;
        return {
          text,
          card: {
            type: 'AdaptiveCard', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', version: '1.4',
            body: [
              { type: 'TextBlock', text: '✅ Task Completed', weight: 'Bolder' },
              { type: 'TextBlock', text: task.name, wrap: true },
              this.facts([['Assignee', task.assigneeName || 'Unassigned']]),
            ],
          },
        };
      }
      case 'risk.created': {
        const risk = payload.risk;
        if (!risk) return null;
        const kind = (risk.type || 'risk');
        const kindLabel = kind.charAt(0).toUpperCase() + kind.slice(1);
        const owner = risk.ownerName || 'Unassigned';
        const ref = risk.recordId ? `${risk.recordId} · ` : '';
        const due = risk.dueDate ? String(risk.dueDate).slice(0, 10) : 'N/A';
        const url = payload.projectId ? `${config.APP_URL}/project/${payload.projectId}?tab=raid` : undefined;
        const project = payload.projectName || 'N/A';
        const text = `New ${kind} (${owner}): ${risk.title}`;
        return {
          text,
          card: {
            type: 'AdaptiveCard', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', version: '1.4',
            body: [
              { type: 'TextBlock', text: `⚠️ New ${kindLabel}`, weight: 'Bolder' },
              { type: 'TextBlock', text: `${ref}${risk.title}`, wrap: true },
              this.facts([
                ['Project', project],
                ['Owner', owner],
                ['Severity', risk.severity || 'N/A'],
                ['Category', risk.category || 'N/A'],
                ['Due', due],
              ]),
            ],
            actions: url ? [{ type: 'Action.OpenUrl', title: 'View in Kovarti', url }] : undefined,
          },
        };
      }
      case 'sprint.started': {
        const sprint = payload.sprint;
        if (!sprint) return null;
        return {
          text: `Sprint started: ${sprint.name}`,
          card: {
            type: 'AdaptiveCard', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', version: '1.4',
            body: [
              { type: 'TextBlock', text: '🏃 Sprint Started', weight: 'Bolder' },
              { type: 'TextBlock', text: sprint.name, wrap: true },
              this.facts([['Dates', `${sprint.startDate || ''} → ${sprint.endDate || ''}`]]),
            ],
          },
        };
      }
      case 'sprint.completed': {
        const sprint = payload.sprint;
        if (!sprint) return null;
        return {
          text: `Sprint completed: ${sprint.name}`,
          card: {
            type: 'AdaptiveCard', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', version: '1.4',
            body: [
              { type: 'TextBlock', text: '🎉 Sprint Completed', weight: 'Bolder' },
              { type: 'TextBlock', text: sprint.name, wrap: true },
              this.facts([['Velocity', `${sprint.velocityCommitment || 'N/A'} points`]]),
            ],
          },
        };
      }
      case 'project.updated': {
        const project = payload.project;
        if (!project) return null;
        return {
          text: `Project updated: ${project.name} — ${project.status}`,
          card: {
            type: 'AdaptiveCard', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', version: '1.4',
            body: [
              { type: 'TextBlock', text: 'Project Updated', weight: 'Bolder' },
              { type: 'TextBlock', text: project.name, wrap: true },
              this.facts([['Status', project.status], ['Priority', project.priority]]),
            ],
          },
        };
      }
      case 'proposal.created': {
        const proposal = payload.proposal;
        if (!proposal) return null;
        const text = `New agent proposal: ${proposal.title || proposal.actionType}`;
        return {
          text,
          card: {
            type: 'AdaptiveCard', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', version: '1.4',
            body: [
              { type: 'TextBlock', text: '🤖 Agent Proposal', weight: 'Bolder' },
              { type: 'TextBlock', text: proposal.title || proposal.actionType, wrap: true },
              { type: 'TextBlock', text: proposal.description || '', wrap: true, isSubtle: true },
            ],
          },
        };
      }
      case 'budget_alert': {
        const n = payload.notification;
        if (!n) return null;
        return this.simpleNotificationCard('💰 Budget Alert', n);
      }
      case 'deadline_approaching': {
        const n = payload.notification;
        if (!n) return null;
        return this.simpleNotificationCard('⏰ Deadline Approaching', n);
      }
      case 'task_assigned': {
        const n = payload.notification;
        if (!n) return null;
        return this.simpleNotificationCard('📋 Task Assigned', n);
      }
      case 'member_added': {
        const n = payload.notification;
        if (!n) return null;
        return this.simpleNotificationCard('👥 Member Added', n);
      }
      case 'meeting_followup': {
        const n = payload.notification;
        if (!n) return null;
        return this.simpleNotificationCard('🗓️ Meeting Follow-up', n);
      }
      case 'notification': {
        const n = payload.notification;
        if (!n) return null;
        return {
          text: n.title,
          card: {
            type: 'AdaptiveCard', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', version: '1.4',
            body: [
              { type: 'TextBlock', text: n.title, weight: 'Bolder', wrap: true },
              { type: 'TextBlock', text: n.message || '', wrap: true },
            ],
          },
        };
      }
      default:
        return null;
    }
  }

  private simpleNotificationCard(heading: string, n: { title: string; message?: string }): { text: string; card: any } {
    return {
      text: `${heading.replace(/^\S+\s/, '')}: ${n.title}`,
      card: {
        type: 'AdaptiveCard', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', version: '1.4',
        body: [
          { type: 'TextBlock', text: heading, weight: 'Bolder' },
          { type: 'TextBlock', text: n.title, wrap: true },
          { type: 'TextBlock', text: n.message || '', wrap: true, isSubtle: true },
        ],
      },
    };
  }
}

export const teamsAdapter = new TeamsAdapter();
