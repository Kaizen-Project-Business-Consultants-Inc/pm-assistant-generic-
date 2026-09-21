import crypto from 'crypto';
import { config } from '../../config';

export interface SlackConfig {
  /** Present on webhook-style integrations; OAuth installs also receive one. */
  webhookUrl: string;
  /** Display name of the channel, e.g. "#project-updates". */
  channel?: string;
  /**
   * The channel the customer picked in the app. A webhook always posts to the
   * channel it was created for, so honouring a different choice needs the bot
   * token — which is why a picked channel is delivered via chat.postMessage.
   */
  channelId?: string;
  notifyEvents?: string[];
  // Stored by the OAuth callback — this workspace's own credentials.
  botToken?: string;
  teamId?: string;
  teamName?: string;
  botUserId?: string;
}

/** True when we can post to a channel of the customer's choosing. */
export function canPostAsBot(config: SlackConfig): boolean {
  return !!config.botToken && !!(config.channelId || config.channel);
}

/**
 * Slack's error codes mean nothing to a project manager. Say what they can do
 * about it instead; anything unrecognised falls through as-is so it still shows
 * up in a support conversation.
 */
function describeSlackError(code: string | undefined, channel: string): string {
  switch (code) {
    case 'not_in_channel':
    case 'channel_not_found':
      return `Kovarti can't post to ${channel}. If it's a private channel, type "/invite @Kovarti" in it, then test again.`;
    case 'is_archived':
      return `${channel} is archived. Pick a different channel.`;
    case 'invalid_auth':
    case 'token_revoked':
    case 'account_inactive':
      return 'Slack no longer accepts this connection. Disconnect and install again.';
    case 'missing_scope':
      return 'This connection was made before we asked for permission to post. Disconnect and install again.';
    case 'rate_limited':
      return 'Slack is rate limiting us. Try again in a minute.';
    default:
      return code || 'Slack API error';
  }
}

function isValidSlackWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'hooks.slack.com';
  } catch {
    return false;
  }
}

export class SlackAdapter {
  buildOAuthUrl(state: string): string {
    const clientId = config.SLACK_CLIENT_ID;
    if (!clientId) throw new Error('SLACK_CLIENT_ID not configured');
    const redirectUri = `${config.APP_URL}/api/v1/slack/callback`;
    // groups:read lets the channel picker show private channels too; installs
    // that predate it still work (listChannels falls back to public-only).
    // channels:join lets us add ourselves to a public channel the customer picks,
    // so they don't have to remember to invite the bot first.
    const scopes = 'chat:write,channels:read,groups:read,channels:join,commands,incoming-webhook';
    const params = new URLSearchParams({
      client_id: clientId,
      scope: scopes,
      redirect_uri: redirectUri,
      state,
    });
    return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<{ access_token: string; team: { id: string; name: string }; bot_user_id: string; incoming_webhook?: { url: string; channel: string } }> {
    const clientId = config.SLACK_CLIENT_ID;
    const clientSecret = config.SLACK_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('Slack OAuth not configured');

    const redirectUri = `${config.APP_URL}/api/v1/slack/callback`;
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    });

    const response = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await response.json() as any;
    if (!data.ok) throw new Error(data.error || 'OAuth exchange failed');
    return data;
  }

  async listChannels(botToken: string): Promise<{ id: string; name: string; isPrivate: boolean }[]> {
    // Private channels need groups:read, which an older install may not have
    // granted. Rather than failing the whole listing, fall back to public only.
    const fetchTypes = async (types: string) => {
      const res = await fetch(`https://slack.com/api/conversations.list?types=${types}&limit=200`, {
        headers: { Authorization: `Bearer ${botToken}` },
      });
      return res.json() as Promise<any>;
    };

    let data = await fetchTypes('public_channel,private_channel');
    if (!data.ok && data.error === 'missing_scope') {
      data = await fetchTypes('public_channel');
    }
    if (!data.ok) throw new Error(data.error || 'Failed to list channels');
    return (data.channels || []).map((ch: any) => ({
      id: ch.id,
      name: ch.name,
      isPrivate: ch.is_private,
    }));
  }

  /**
   * Prove the connection end to end by posting the way real notifications will
   * be posted. Testing the webhook when events actually go out over the bot
   * token (or the reverse) tells the customer nothing useful.
   */
  async testConnection(config: SlackConfig): Promise<{ success: boolean; message: string }> {
    if (canPostAsBot(config)) {
      const target = config.channel || config.channelId!;
      const result = await this.postWithBotToken(
        config.botToken!,
        config.channelId || config.channel!,
        [{ type: 'section', text: { type: 'mrkdwn', text: ':white_check_mark: *Kovarti is connected.* Project notifications will appear here.' } }],
        'Kovarti is connected. Project notifications will appear here.',
      );
      return result.success
        ? { success: true, message: `Test message posted to ${target}` }
        : result;
    }

    if (!isValidSlackWebhookUrl(config.webhookUrl)) {
      return {
        success: false,
        message: config.botToken
          ? 'Choose a channel first, then test again.'
          : 'This connection has no channel set. Disconnect and install again to fix it.',
      };
    }
    try {
      const response = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Kovarti PM Assistant integration test - connection successful!',
          ...(config.channel ? { channel: config.channel } : {}),
        }),
      });
      if (response.ok) return { success: true, message: 'Connected to Slack successfully' };
      return { success: false, message: `Slack returned ${response.status}` };
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to connect' };
    }
  }

  /**
   * The one way notifications leave the product. If the customer picked a
   * channel we post as the bot so that choice is honoured; otherwise we fall
   * back to the webhook, which always posts to the channel it was created for.
   */
  async deliver(
    config: SlackConfig,
    message: { text: string; blocks?: any[] },
  ): Promise<{ success: boolean; message: string }> {
    if (canPostAsBot(config)) {
      return this.postWithBotToken(
        config.botToken!,
        config.channelId || config.channel!,
        message.blocks || [],
        message.text,
      );
    }
    return this.sendNotification(config, message);
  }

  async sendNotification(
    config: SlackConfig,
    message: {
      text: string;
      blocks?: any[];
    },
  ): Promise<{ success: boolean; message: string }> {
    if (!isValidSlackWebhookUrl(config.webhookUrl)) {
      return { success: false, message: 'Invalid Slack webhook URL. Must be https://hooks.slack.com/...' };
    }
    try {
      const payload: Record<string, any> = {
        text: message.text,
        ...(config.channel ? { channel: config.channel } : {}),
      };
      if (message.blocks) {
        payload.blocks = message.blocks;
      }

      const response = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (response.ok) return { success: true, message: 'Notification sent' };
      return { success: false, message: `Slack returned ${response.status}` };
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to send notification' };
    }
  }

  async sendFormattedProjectUpdate(
    config: SlackConfig,
    data: {
      projectName: string;
      status: string;
      summary: string;
      url?: string;
    },
  ): Promise<{ success: boolean; message: string }> {
    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `Project Update: ${data.projectName}` },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Status:*\n${data.status}` },
          { type: 'mrkdwn', text: `*Summary:*\n${data.summary}` },
        ],
      },
    ];

    if (data.url) {
      blocks.push({
        type: 'section',
        fields: [{ type: 'mrkdwn', text: `<${data.url}|View Project>` }],
      });
    }

    return this.sendNotification(config, {
      text: `Project Update: ${data.projectName} - ${data.status}`,
      blocks,
    });
  }

  verifySignature(signingSecret: string, timestamp: string, rawBody: string, signature: string): boolean {
    if (!signingSecret || !timestamp || !signature) return false;

    // Reject requests older than 5 minutes
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(timestamp)) > 300) return false;

    const baseString = `v0:${timestamp}:${rawBody}`;
    const expected = 'v0=' + crypto.createHmac('sha256', signingSecret).update(baseString).digest('hex');

    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  }

  /**
   * Post as the bot using the token from THAT customer's own Slack install.
   * There is deliberately no global/app-wide token fallback — every workspace
   * must post with its own OAuth token (Slack requires this for distributed
   * apps, and a shared token would send one customer's data to another's Slack).
   */
  async postWithBotToken(botToken: string, channel: string, blocks: any[], text: string): Promise<{ success: boolean; message: string }> {
    if (!botToken) {
      return { success: false, message: 'No Slack bot token for this workspace' };
    }

    const post = async () => {
      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${botToken}`,
        },
        body: JSON.stringify({ channel, text, blocks }),
      });
      return response.json() as Promise<{ ok: boolean; error?: string }>;
    };

    try {
      let data = await post();

      // Slack refuses to post into a channel the app isn't a member of. Join it
      // and retry once — the customer picked this channel, so being told to go
      // and invite a bot is a pointless detour.
      if (!data.ok && data.error === 'not_in_channel') {
        await this.joinChannel(botToken, channel);
        data = await post();
      }

      if (data.ok) return { success: true, message: 'Message sent' };
      return { success: false, message: describeSlackError(data.error, channel) };
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to post message' };
    }
  }

  /** Best effort — a private channel can only be joined by invitation. */
  private async joinChannel(botToken: string, channel: string): Promise<void> {
    try {
      await fetch('https://slack.com/api/conversations.join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${botToken}`,
        },
        body: JSON.stringify({ channel }),
      });
    } catch { /* the retry will report the real problem */ }
  }

  /** `canUseInteractive` should be true only when that workspace has its own bot token. */
  buildEventBlocks(event: string, payload: Record<string, any>, canUseInteractive = false): { text: string; blocks?: any[] } | null {
    switch (event) {
      case 'task.completed':
      case 'task.updated': {
        const task = payload.task;
        if (!task) return null;
        // Only notify on task completion
        if (event === 'task.updated' && task.status !== 'completed') return null;
        const text = `Task completed: ${task.name}`;
        return {
          text,
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: `*Task Completed* :white_check_mark:\n*${task.name}*` } },
            { type: 'context', elements: [
              { type: 'mrkdwn', text: `Assignee: ${task.assigneeName || 'Unassigned'}` },
            ] },
          ],
        };
      }
      case 'risk.created': {
        const risk = payload.risk;
        if (!risk) return null;
        const severityEmoji: Record<string, string> = { critical: ':red_circle:', high: ':large_orange_circle:', medium: ':large_yellow_circle:', low: ':white_circle:' };
        const emoji = severityEmoji[risk.severity] || ':warning:';
        const kind = (risk.type || 'risk');
        const kindLabel = kind.charAt(0).toUpperCase() + kind.slice(1);
        // Who it lands on matters most in a notification — say so explicitly
        // rather than leaving the reader to open the app to find out.
        const owner = risk.ownerName || 'Unassigned';
        const ref = risk.recordId ? `${risk.recordId} · ` : '';
        const due = risk.dueDate ? ` | Due: ${String(risk.dueDate).slice(0, 10)}` : '';
        // Link straight to the project's RAID tab, and name the project — one
        // channel often watches several.
        const url = payload.projectId ? `${config.APP_URL}/project/${payload.projectId}?tab=raid` : '';
        const heading = url ? `<${url}|${ref}${risk.title}>` : `${ref}${risk.title}`;
        const project = payload.projectName ? `Project: *${payload.projectName}* | ` : '';
        const text = `New ${kind} (${owner}): ${risk.title}`;
        return {
          text,
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: `*New ${kindLabel}* ${emoji}\n*${heading}*` } },
            { type: 'context', elements: [
              { type: 'mrkdwn', text: `${project}Owner: *${owner}* | Severity: *${risk.severity || 'N/A'}* | Category: ${risk.category || 'N/A'}${due}` },
            ] },
          ],
        };
      }
      case 'sprint.started': {
        const sprint = payload.sprint;
        if (!sprint) return null;
        const text = `Sprint started: ${sprint.name}`;
        return {
          text,
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: `*Sprint Started* :runner:\n*${sprint.name}*` } },
            { type: 'context', elements: [
              { type: 'mrkdwn', text: `${sprint.startDate || ''} → ${sprint.endDate || ''}` },
            ] },
          ],
        };
      }
      case 'sprint.completed': {
        const sprint = payload.sprint;
        if (!sprint) return null;
        const text = `Sprint completed: ${sprint.name}`;
        return {
          text,
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: `*Sprint Completed* :tada:\n*${sprint.name}*` } },
            { type: 'context', elements: [
              { type: 'mrkdwn', text: `Velocity: ${sprint.velocityCommitment || 'N/A'} points` },
            ] },
          ],
        };
      }
      case 'project.updated': {
        const project = payload.project;
        if (!project) return null;
        const text = `Project updated: ${project.name} — ${project.status}`;
        return {
          text,
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: `*Project Updated*\n*${project.name}*` } },
            { type: 'context', elements: [
              { type: 'mrkdwn', text: `Status: *${project.status}* | Priority: ${project.priority}` },
            ] },
          ],
        };
      }
      case 'proposal.created': {
        const proposal = payload.proposal;
        if (!proposal) return null;
        const text = `New agent proposal: ${proposal.title || proposal.actionType}`;
        const blocks: any[] = [
          { type: 'section', text: { type: 'mrkdwn', text: `*Agent Proposal* :robot_face:\n*${proposal.title || proposal.actionType}*\n${proposal.description || ''}` } },
        ];
        // Interactive buttons need a bot token, which only OAuth installs have
        if (canUseInteractive) {
          blocks.push({
            type: 'actions',
            elements: [
              { type: 'button', text: { type: 'plain_text', text: 'Approve' }, style: 'primary', action_id: 'proposal_approve', value: proposal.id },
              { type: 'button', text: { type: 'plain_text', text: 'Reject' }, style: 'danger', action_id: 'proposal_reject', value: proposal.id },
            ],
          });
        }
        return { text, blocks };
      }
      case 'budget_alert': {
        const n = payload.notification;
        if (!n) return null;
        const text = `Budget Alert: ${n.title}`;
        return {
          text,
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: `*Budget Alert* :money_with_wings:\n*${n.title}*\n${n.message || ''}` } },
          ],
        };
      }
      case 'deadline_approaching': {
        const n = payload.notification;
        if (!n) return null;
        const text = `Deadline Approaching: ${n.title}`;
        return {
          text,
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: `*Deadline Approaching* :alarm_clock:\n*${n.title}*\n${n.message || ''}` } },
          ],
        };
      }
      case 'task_assigned': {
        const n = payload.notification;
        if (!n) return null;
        const text = `Task Assigned: ${n.title}`;
        return {
          text,
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: `*Task Assigned* :clipboard:\n*${n.title}*\n${n.message || ''}` } },
          ],
        };
      }
      case 'member_added': {
        const n = payload.notification;
        if (!n) return null;
        const text = `Member Added: ${n.title}`;
        return {
          text,
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: `*Member Added* :busts_in_silhouette:\n*${n.title}*\n${n.message || ''}` } },
          ],
        };
      }
      case 'meeting_followup': {
        const n = payload.notification;
        if (!n) return null;
        const text = `Meeting Follow-up: ${n.title}`;
        return {
          text,
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: `*Meeting Follow-up* :spiral_calendar_pad:\n*${n.title}*\n${n.message || ''}` } },
          ],
        };
      }
      case 'notification': {
        const n = payload.notification;
        if (!n) return null;
        const text = n.title;
        return {
          text,
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: `*${n.title}*\n${n.message || ''}` } },
          ],
        };
      }
      default:
        return null;
    }
  }

  buildStatusBlocks(project: { name: string; status: string; priority: string; startDate?: string; endDate?: string; budgetAllocated?: number; budgetSpent?: number; methodology?: string }): any[] {
    return [
      { type: 'header', text: { type: 'plain_text', text: project.name } },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Status:*\n${project.status}` },
          { type: 'mrkdwn', text: `*Priority:*\n${project.priority}` },
          { type: 'mrkdwn', text: `*Methodology:*\n${project.methodology || 'N/A'}` },
          { type: 'mrkdwn', text: `*Dates:*\n${project.startDate || '?'} → ${project.endDate || '?'}` },
        ],
      },
    ];
  }
}

export const slackAdapter = new SlackAdapter();
