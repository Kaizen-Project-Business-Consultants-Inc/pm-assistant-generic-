import { config } from '../config';
import { issueOAuthState, finishOAuthState } from '../utils/oauthState';
import logger from '../utils/logger';
import { integrationRepository, parseConfig } from '../database/IntegrationRepository';
import { meetingAnalysisRepository } from '../database/MeetingAnalysisRepository';
import { meetingSpeakerLinkRepository, speakerKey } from '../database/MeetingSpeakerLinkRepository';
import { projectMemberService } from './ProjectMemberService';
import { teamsAdapter } from './integrations/TeamsAdapter';
import { meetingIntelligenceService } from './MeetingIntelligenceService';
import { parseVtt, segmentsToTranscript, TranscriptSegment } from '../utils/transcriptParser';
import {
  TEAMS_MEETING_SCOPES, TEAMS_MEETINGS_PROVIDER, TeamsCalendarMeeting,
  listRecentTeamsMeetings, getTeamsMeeting, findTranscript, downloadTranscriptVtt,
} from './integrations/TeamsMeetingsGraph';
import type { MeetingAnalysis } from '../schemas/meetingSchemas';

/**
 * Meeting Intelligence → From Teams (2026-09-30). Each PM connects their own Microsoft account
 * (delegated: they only ever see their own meetings); their company's IT admin approves Kovarti
 * once. Kovarti reads the transcript Teams made — it never joins or records a meeting.
 */

/** Something the PM can act on (not connected, no transcript, …) — routes answer 400/409 with it */
export class TeamsImportError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); }
}

/** Prefix of the sign-in state, so the shared Teams callback knows which connection this is */
export const TEAMS_MEETINGS_STATE = 'teams-meetings';

export const sourceRefFor = (eventId: string) => `teams:${eventId}`.slice(0, 255);

export interface SpeakerMatch {
  name: string;
  /** Kovarti user this speaker is; null = not a project member / not matched yet */
  userId: string | null;
  matchedBy: 'saved' | 'name' | 'email' | null;
  lines: number;
}

/** Distinct speakers, in order of first appearance, with how many times each spoke */
export function distinctSpeakers(segments: TranscriptSegment[]): { name: string; lines: number }[] {
  const seen = new Map<string, number>();
  for (const s of segments) if (s.speaker && s.speaker !== 'Unknown') seen.set(s.speaker, (seen.get(s.speaker) || 0) + 1);
  return [...seen].map(([name, lines]) => ({ name, lines }));
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Who is each speaker? 1) the PM's earlier choice for that name, 2) a project member with that
 * name, 3) a meeting invitee with that name whose email is a project member's.
 */
export function matchSpeakers(
  speakers: { name: string; lines: number }[],
  members: { userId: string; userName: string; email: string }[],
  attendees: { name: string; email: string }[],
  saved: Map<string, { userId: string | null }>,
): SpeakerMatch[] {
  const memberIds = new Set(members.map(m => m.userId));
  return speakers.map(({ name, lines }) => {
    const prior = saved.get(speakerKey(name));
    if (prior && (prior.userId === null || memberIds.has(prior.userId))) {
      return { name, lines, userId: prior.userId, matchedBy: 'saved' as const };
    }
    const byName = members.find(m => norm(m.userName || '') === norm(name));
    if (byName) return { name, lines, userId: byName.userId, matchedBy: 'name' as const };
    const invitee = attendees.find(a => norm(a.name) === norm(name) && a.email);
    const byEmail = invitee && members.find(m => (m.email || '').toLowerCase() === invitee.email);
    if (byEmail) return { name, lines, userId: byEmail.userId, matchedBy: 'email' as const };
    return { name, lines, userId: null, matchedBy: null };
  });
}

/** Rename speakers to the project member names the PM confirmed; others keep their Teams name, marked */
export function applySpeakerNames(
  segments: TranscriptSegment[],
  mapping: Record<string, string | null>,
  memberNames: Map<string, string>,
): TranscriptSegment[] {
  return segments.map(s => {
    if (!(s.speaker in mapping)) return s;
    const uid = mapping[s.speaker];
    const member = uid ? memberNames.get(uid) : undefined;
    return { ...s, speaker: member ?? `${s.speaker} (not a project member)` };
  });
}

class TeamsMeetingImportService {
  isConfigured(): boolean {
    return !!config.MICROSOFT_CLIENT_ID && !!config.MICROSOFT_CLIENT_SECRET;
  }

  private async connection(userId: string) {
    const rows = await integrationRepository.findByUser(userId);
    return rows.find(r => r.provider === TEAMS_MEETINGS_PROVIDER && r.isActive !== false) ?? null;
  }

  async status(userId: string): Promise<{ configured: boolean; connected: boolean }> {
    return { configured: this.isConfigured(), connected: !!(await this.connection(userId)) };
  }

  async installUrl(userId: string): Promise<string> {
    if (!this.isConfigured()) throw new TeamsImportError('not_configured', 'Teams is not set up on this site yet. Contact support and we will enable it.', 501);
    const state = await issueOAuthState(userId, TEAMS_MEETINGS_STATE);
    return teamsAdapter.buildOAuthUrl(state, TEAMS_MEETING_SCOPES);
  }

  /**
   * Microsoft redirected back. The state must be one we issued, and the person signed in to
   * Kovarti in this browser must be the one who started it (that is also what picks their company).
   */
  async completeConnection(state: string, code: string, signedInUserId: string | undefined): Promise<void> {
    let startedBy: string;
    try {
      startedBy = await finishOAuthState(state, TEAMS_MEETINGS_STATE, signedInUserId, 'Meeting Intelligence');
    } catch (err) {
      throw new TeamsImportError('state', (err as Error).message);
    }
    const token = await teamsAdapter.exchangeCode(code, TEAMS_MEETING_SCOPES);
    await this.saveConnection(startedBy, token);
  }

  /** The link the PM sends their IT admin: approve Kovarti once for the whole company */
  adminApprovalUrl(): string {
    if (!this.isConfigured()) throw new TeamsImportError('not_configured', 'Teams is not set up on this site yet. Contact support and we will enable it.', 501);
    const q = new URLSearchParams({
      client_id: config.MICROSOFT_CLIENT_ID,
      scope: 'https://graph.microsoft.com/.default',
      redirect_uri: `${config.APP_URL}/api/v1/teams/callback`,
      state: 'admin-approval',
    });
    return `https://login.microsoftonline.com/organizations/v2.0/adminconsent?${q}`;
  }

  /** Store the PM's connection (one per person; reconnecting replaces it) */
  async saveConnection(userId: string, token: { access_token: string; refresh_token: string; expires_in: number }): Promise<void> {
    const cfg = { accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + token.expires_in * 1000 };
    const existing = await this.connection(userId);
    if (existing) await integrationRepository.updateIntegration(existing.id, { config: cfg, isActive: true });
    else await integrationRepository.create(userId, TEAMS_MEETINGS_PROVIDER, cfg);
  }

  async disconnect(userId: string): Promise<void> {
    const existing = await this.connection(userId);
    if (existing) await integrationRepository.deleteIntegration(existing.id);
  }

  private async token(userId: string): Promise<string> {
    const conn = await this.connection(userId);
    if (!conn) throw new TeamsImportError('not_connected', 'Connect your Microsoft account first.', 409);
    const raw = await integrationRepository.findRawById(conn.id);
    const token = raw && await teamsAdapter.ensureFreshToken(conn.id, parseConfig(raw.config), TEAMS_MEETING_SCOPES);
    if (!token) throw new TeamsImportError('expired', 'Microsoft no longer accepts your Teams connection. Connect again.', 409);
    return token;
  }

  /** The PM's Teams meetings from the last 30 days, with whether a transcript exists */
  async listMeetings(userId: string, projectId: string) {
    const token = await this.token(userId);
    const meetings = await listRecentTeamsMeetings(token);
    const analyzed = await meetingAnalysisRepository.findBySourceRefs(projectId, meetings.map(m => sourceRefFor(m.eventId)));
    // A few at a time — each meeting needs two small Graph calls
    const out: any[] = [];
    for (let i = 0; i < meetings.length; i += 5) {
      const batch = meetings.slice(i, i + 5);
      // eslint-disable-next-line no-await-in-loop -- five meetings at a time; Microsoft Graph is rate-limited
      const lookups = await Promise.all(batch.map(m => findTranscript(token, m)));
      batch.forEach((m, j) => out.push({
        eventId: m.eventId, subject: m.subject, start: m.start, end: m.end,
        transcript: lookups[j].status,
        analysisId: analyzed.get(sourceRefFor(m.eventId)) ?? null,
      }));
    }
    return out;
  }

  private async loadTranscript(token: string, eventId: string): Promise<{ meeting: TeamsCalendarMeeting; segments: TranscriptSegment[] }> {
    const meeting = await getTeamsMeeting(token, eventId);
    if (!meeting) throw new TeamsImportError('not_teams', 'That is not a Teams meeting.');
    const t = await findTranscript(token, meeting);
    if (t.status === 'not_allowed') throw new TeamsImportError('not_allowed', 'Teams did not let Kovarti read this transcript. Usually only the meeting organizer can, or your IT admin still needs to approve Kovarti.', 409);
    if (t.status !== 'ready') throw new TeamsImportError('no_transcript', 'This meeting has no transcript. Transcription has to be switched on in Teams during the meeting.', 409);
    const vtt = await downloadTranscriptVtt(token, t.meetingId, t.transcriptId);
    const segments = parseVtt(vtt);
    if (segments.length === 0) throw new TeamsImportError('empty', 'The Teams transcript for this meeting is empty.', 409);
    return { meeting, segments };
  }

  /** Step 3 — who's who */
  async speakers(userId: string, projectId: string, eventId: string) {
    const token = await this.token(userId);
    const { meeting, segments } = await this.loadTranscript(token, eventId);
    const members = (await projectMemberService.findByProjectId(projectId)).filter(m => !m.userId.startsWith('pending_'));
    const found = distinctSpeakers(segments);
    const saved = await meetingSpeakerLinkRepository.findByNames(found.map(s => s.name));
    return {
      meeting: { eventId, subject: meeting.subject, start: meeting.start },
      speakers: matchSpeakers(found, members, meeting.attendees, saved),
      members: members.map(m => ({ userId: m.userId, name: m.userName })),
    };
  }

  /** Step 4 — analyze with the confirmed names; remembers the PM's choices */
  async analyze(userId: string, projectId: string, scheduleId: string, eventId: string, mapping: Record<string, string | null>): Promise<MeetingAnalysis> {
    const token = await this.token(userId);
    const { meeting, segments } = await this.loadTranscript(token, eventId);
    const members = (await projectMemberService.findByProjectId(projectId)).filter(m => !m.userId.startsWith('pending_'));
    const memberNames = new Map(members.map(m => [m.userId, m.userName]));
    // Only names that are really in this transcript, and only this project's members
    const speakerNames = new Set(distinctSpeakers(segments).map(s => s.name));
    const clean: Record<string, string | null> = {};
    for (const [name, uid] of Object.entries(mapping)) {
      if (speakerNames.has(name)) clean[name] = uid && memberNames.has(uid) ? uid : null;
    }
    await meetingSpeakerLinkRepository.save(Object.entries(clean).map(([speakerName, uid]) => ({ speakerName, userId: uid })), userId);

    const day = meeting.start.slice(0, 10);
    const transcript = `Meeting: ${meeting.subject} (${day}, Microsoft Teams)\n\n${segmentsToTranscript(applySpeakerNames(segments, clean, memberNames))}`;
    const analysis = await meetingIntelligenceService.analyzeTranscript(transcript, projectId, scheduleId, userId, undefined, day);
    await meetingAnalysisRepository.setSourceRef(analysis.id, sourceRefFor(eventId)).catch(err =>
      logger.warn('Teams import: could not record source meeting', { error: (err as Error).message }));
    return analysis;
  }
}

export const teamsMeetingImportService = new TeamsMeetingImportService();
