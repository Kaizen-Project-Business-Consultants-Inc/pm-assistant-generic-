/**
 * Microsoft Graph calls for "Meeting Intelligence → From Teams" (2026-09-30).
 *
 * Reads, as the signed-in PM (delegated permissions), their recent Teams meetings from their
 * calendar and the transcript Teams made of a meeting. Nothing joins or records a meeting.
 * Permissions (delegated, on the same Azure app as the Teams channel connection; the customer's
 * IT admin approves them once): Calendars.Read, OnlineMeetings.Read,
 * OnlineMeetingTranscript.Read.All, offline_access.
 */

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export const TEAMS_MEETING_SCOPES =
  'User.Read Calendars.Read OnlineMeetings.Read OnlineMeetingTranscript.Read.All offline_access';

/** Integration row provider for this connection — separate from the channel-posting 'msteams' */
export const TEAMS_MEETINGS_PROVIDER = 'msteams_meetings';

export interface TeamsCalendarMeeting {
  eventId: string;
  subject: string;
  start: string; // ISO UTC
  end: string;   // ISO UTC
  joinUrl: string;
  attendees: { name: string; email: string }[];
}

export type TranscriptLookup =
  | { status: 'ready'; meetingId: string; transcriptId: string }
  | { status: 'none' }
  | { status: 'not_allowed' };

/** A Graph failure, with a message a PM can act on */
export class TeamsGraphError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function describe(status: number): string {
  if (status === 401) return 'Microsoft no longer accepts your Teams connection. Connect again.';
  if (status === 403) return 'Microsoft did not allow Kovarti to read this. Your IT admin may still need to approve Kovarti.';
  if (status === 404) return 'Teams could not find that meeting.';
  if (status === 429) return 'Microsoft is busy. Try again in a minute.';
  return `Microsoft Teams returned an error (${status}). Try again later.`;
}

async function graph(token: string, path: string, accept = 'application/json'): Promise<Response> {
  const resp = await fetch(`${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: accept, Prefer: 'outlook.timezone="UTC"' },
  });
  if (!resp.ok) throw new TeamsGraphError(resp.status, describe(resp.status));
  return resp;
}

/** Graph returns UTC "2026-09-29T10:00:00.0000000" without a zone (we asked for UTC) */
function utcIso(dt: string | undefined): string {
  if (!dt) return '';
  return /[zZ]|[+-]\d\d:\d\d$/.test(dt) ? new Date(dt).toISOString() : new Date(`${dt.slice(0, 23)}Z`).toISOString();
}

export function toMeeting(ev: any): TeamsCalendarMeeting | null {
  const joinUrl: string | undefined = ev?.onlineMeeting?.joinUrl;
  if (!ev?.isOnlineMeeting || !joinUrl || (ev.onlineMeetingProvider && ev.onlineMeetingProvider !== 'teamsForBusiness')) return null;
  return {
    eventId: String(ev.id),
    subject: String(ev.subject || '(no title)'),
    start: utcIso(ev.start?.dateTime),
    end: utcIso(ev.end?.dateTime),
    joinUrl,
    attendees: [
      ...(ev.organizer?.emailAddress ? [ev.organizer.emailAddress] : []),
      ...((ev.attendees || []).map((a: any) => a?.emailAddress).filter(Boolean)),
    ].map((e: any) => ({ name: String(e.name || ''), email: String(e.address || '').toLowerCase() })),
  };
}

const EVENT_FIELDS = 'id,subject,start,end,isOnlineMeeting,onlineMeeting,onlineMeetingProvider,attendees,organizer';

/** Teams meetings in the signed-in user's calendar that ended in the last `days` days, newest first */
export async function listRecentTeamsMeetings(token: string, days = 30, limit = 20, now = new Date()): Promise<TeamsCalendarMeeting[]> {
  const from = new Date(now.getTime() - days * 86_400_000).toISOString();
  const q = new URLSearchParams({
    startDateTime: from, endDateTime: now.toISOString(),
    $select: EVENT_FIELDS, $orderby: 'start/dateTime desc', $top: '100',
  });
  const body = await (await graph(token, `/me/calendarView?${q}`)).json() as { value?: any[] };
  return (body.value || [])
    .map(toMeeting)
    .filter((m): m is TeamsCalendarMeeting => !!m && !!m.end && m.end <= now.toISOString())
    .slice(0, limit);
}

export async function getTeamsMeeting(token: string, eventId: string): Promise<TeamsCalendarMeeting | null> {
  const body = await (await graph(token, `/me/events/${encodeURIComponent(eventId)}?$select=${EVENT_FIELDS}`)).json();
  return toMeeting(body);
}

/**
 * Find the transcript Teams made for this meeting. A recurring series shares one online meeting,
 * so pick the transcript created during this occurrence (start → end + 3 h).
 */
export async function findTranscript(token: string, m: TeamsCalendarMeeting): Promise<TranscriptLookup> {
  try {
    const filter = encodeURIComponent(`JoinWebUrl eq '${m.joinUrl.replace(/'/g, "''")}'`);
    const om = await (await graph(token, `/me/onlineMeetings?$filter=${filter}`)).json() as { value?: { id: string }[] };
    const meetingId = om.value?.[0]?.id;
    if (!meetingId) return { status: 'none' };
    const tr = await (await graph(token, `/me/onlineMeetings/${encodeURIComponent(meetingId)}/transcripts`)).json() as
      { value?: { id: string; createdDateTime?: string }[] };
    const from = Date.parse(m.start);
    const to = Date.parse(m.end) + 3 * 3_600_000;
    const hit = (tr.value || []).find(t => {
      const at = Date.parse(t.createdDateTime || '');
      return Number.isNaN(at) || (at >= from && at <= to);
    });
    return hit ? { status: 'ready', meetingId, transcriptId: hit.id } : { status: 'none' };
  } catch (err) {
    if (err instanceof TeamsGraphError && (err.status === 403 || err.status === 404)) {
      return err.status === 403 ? { status: 'not_allowed' } : { status: 'none' };
    }
    throw err;
  }
}

export async function downloadTranscriptVtt(token: string, meetingId: string, transcriptId: string): Promise<string> {
  const resp = await graph(
    token,
    `/me/onlineMeetings/${encodeURIComponent(meetingId)}/transcripts/${encodeURIComponent(transcriptId)}/content?$format=text/vtt`,
    'text/vtt',
  );
  return resp.text();
}
