import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../services/RedisService', () => {
  const store = new Map<string, string>();
  return {
    redisService: {
      isConnected: () => true,
      set: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      del: vi.fn(async (k: string) => { store.delete(k); }),
    },
  };
});

import { distinctSpeakers, matchSpeakers, applySpeakerNames, sourceRefFor } from '../../../services/TeamsMeetingImportService';
import { toMeeting, listRecentTeamsMeetings, findTranscript, TeamsCalendarMeeting } from '../../../services/integrations/TeamsMeetingsGraph';
import { issueOAuthState, consumeOAuthState, finishOAuthState } from '../../../utils/oauthState';
import { parseVtt, segmentsToTranscript } from '../../../utils/transcriptParser';

const VTT = `WEBVTT

00:00:05.000 --> 00:00:09.000
<v Michaela Brown>Morning all, let's start.</v>

00:12:41.000 --> 00:12:47.000
<v Dev Patel>I'll send the revised spec to the vendor by Friday.</v>

00:18:22.000 --> 00:18:30.000
<v J. Lindqvist (Guest)>The bureau API has a rate limit.</v>

00:20:00.000 --> 00:20:04.000
<v Dev Patel>Noted.</v>
`;

const members = [
  { userId: 'u-mb', userName: 'Michaela Brown', email: 'michaela@dbj.example' },
  { userId: 'u-dp', userName: 'Devendra Patel', email: 'dev.patel@dbj.example' },
];
const attendees = [
  { name: 'Dev Patel', email: 'dev.patel@dbj.example' },
  { name: 'J. Lindqvist (Guest)', email: 'jl@bureau.example' },
];

describe('who is who', () => {
  const segments = parseVtt(VTT);

  it('lists each speaker once, in order of first appearance', () => {
    expect(distinctSpeakers(segments)).toEqual([
      { name: 'Michaela Brown', lines: 1 },
      { name: 'Dev Patel', lines: 2 },
      { name: 'J. Lindqvist (Guest)', lines: 1 },
    ]);
  });

  it('matches by member name, then by the invitee email; guests stay unmatched', () => {
    const m = matchSpeakers(distinctSpeakers(segments), members, attendees, new Map());
    expect(m.map(s => [s.name, s.userId, s.matchedBy])).toEqual([
      ['Michaela Brown', 'u-mb', 'name'],
      ['Dev Patel', 'u-dp', 'email'], // Teams says "Dev", Kovarti says "Devendra" — the invite's email links them
      ['J. Lindqvist (Guest)', null, null],
    ]);
  });

  it("the PM's earlier choice wins — including 'not a project member'", () => {
    const saved = new Map<string, { userId: string | null }>([
      ['michaela brown', { userId: null }],
      ['j. lindqvist (guest)', { userId: 'u-dp' }],
    ]);
    const m = matchSpeakers(distinctSpeakers(segments), members, attendees, saved);
    expect(m[0]).toMatchObject({ userId: null, matchedBy: 'saved' });
    expect(m[2]).toMatchObject({ userId: 'u-dp', matchedBy: 'saved' });
  });

  it('a remembered person who is not on this project is ignored', () => {
    const saved = new Map([['j. lindqvist (guest)', { userId: 'u-someone-else' }]]);
    expect(matchSpeakers(distinctSpeakers(segments), members, attendees, saved)[2]).toMatchObject({ userId: null, matchedBy: null });
  });

  it('the transcript sent to the AI carries the confirmed names; guests are marked', () => {
    const names = new Map(members.map(m => [m.userId, m.userName]));
    const out = segmentsToTranscript(applySpeakerNames(segments, {
      'Michaela Brown': 'u-mb', 'Dev Patel': 'u-dp', 'J. Lindqvist (Guest)': null,
    }, names));
    expect(out).toContain('[Devendra Patel] (0:12:41)');
    expect(out).toContain('[J. Lindqvist (Guest) (not a project member)] (0:18:22)');
    expect(out).not.toContain('[Dev Patel]');
  });

  it('a source reference fits the column', () => {
    expect(sourceRefFor('x'.repeat(400)).length).toBe(255);
  });
});

describe('Teams calendar and transcripts (Microsoft Graph)', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => vi.unstubAllGlobals());
  const json = (body: any, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

  const ev = (over: any = {}) => ({
    id: 'ev1', subject: 'DBJ Loans weekly status', isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness',
    onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc' },
    start: { dateTime: '2026-09-29T10:00:00.0000000' }, end: { dateTime: '2026-09-29T11:00:00.0000000' },
    organizer: { emailAddress: { name: 'Michaela Brown', address: 'Michaela@DBJ.example' } },
    attendees: [{ emailAddress: { name: 'Dev Patel', address: 'dev.patel@dbj.example' } }],
    ...over,
  });

  it('keeps only Teams meetings, with times in UTC and lower-case emails', () => {
    expect(toMeeting(ev({ isOnlineMeeting: false }))).toBeNull();
    expect(toMeeting(ev({ onlineMeetingProvider: 'skypeForBusiness' }))).toBeNull();
    const m = toMeeting(ev())!;
    expect(m.start).toBe('2026-09-29T10:00:00.000Z');
    expect(m.attendees[0]).toEqual({ name: 'Michaela Brown', email: 'michaela@dbj.example' });
  });

  it('lists only meetings that have ended', async () => {
    fetchMock.mockResolvedValueOnce(json({ value: [
      ev({ id: 'later', start: { dateTime: '2026-09-30T15:00:00' }, end: { dateTime: '2026-09-30T16:00:00' } }),
      ev(),
    ] }));
    const list = await listRecentTeamsMeetings('tok', 30, 20, new Date('2026-09-30T12:00:00Z'));
    expect(list.map(m => m.eventId)).toEqual(['ev1']);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/me/calendarView?');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });

  const meeting: TeamsCalendarMeeting = toMeeting(ev())!;

  it('a recurring meeting: picks the transcript made during this occurrence', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ value: [{ id: 'om1' }] }))
      .mockResolvedValueOnce(json({ value: [
        { id: 't-last-week', createdDateTime: '2026-09-22T11:01:00Z' },
        { id: 't-this-week', createdDateTime: '2026-09-29T11:01:00Z' },
      ] }));
    expect(await findTranscript('tok', meeting)).toEqual({ status: 'ready', meetingId: 'om1', transcriptId: 't-this-week' });
    expect(decodeURIComponent(String(fetchMock.mock.calls[0][0]))).toContain("JoinWebUrl eq 'https://teams.microsoft.com/l/meetup-join/abc'");
  });

  it('no transcript, and not allowed, are told apart', async () => {
    fetchMock.mockResolvedValueOnce(json({ value: [{ id: 'om1' }] })).mockResolvedValueOnce(json({ value: [] }));
    expect(await findTranscript('tok', meeting)).toEqual({ status: 'none' });
    fetchMock.mockResolvedValueOnce(json({ value: [{ id: 'om1' }] })).mockResolvedValueOnce(json({}, 403));
    expect(await findTranscript('tok', meeting)).toEqual({ status: 'not_allowed' });
  });

  it('an expired connection is reported in plain words', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 401));
    await expect(listRecentTeamsMeetings('tok')).rejects.toThrow('Microsoft no longer accepts your Teams connection. Connect again.');
  });
});

describe('sign-in state', () => {
  it('can be used once, by the flow that issued it', async () => {
    const s = await issueOAuthState('user-1', 'teams-meetings');
    expect(await consumeOAuthState(s, 'slack')).toBeNull();
    expect(await consumeOAuthState(s, 'teams-meetings')).toBe('user-1');
    expect(await consumeOAuthState(s, 'teams-meetings')).toBeNull();
  });

  it('finishing: only the person who started it, signed in, and only once', async () => {
    const s1 = await issueOAuthState('user-1', 'slack');
    await expect(finishOAuthState(s1, 'slack', 'user-2', 'Integrations')).rejects.toThrow('Sign in to Kovarti in this browser, then connect again from Integrations.');
    await expect(finishOAuthState(s1, 'slack', 'user-1', 'Integrations')).rejects.toThrow('This sign-in link has expired'); // the failed try used it up
    const s2 = await issueOAuthState('user-1', 'slack');
    await expect(finishOAuthState(s2, 'slack', undefined, 'Integrations')).rejects.toThrow('Sign in to Kovarti');
    const s3 = await issueOAuthState('user-1', 'gcal');
    expect(await finishOAuthState(s3, 'gcal', 'user-1', 'Integrations')).toBe('user-1');
    await expect(finishOAuthState(`x:user-1`, 'gcal', 'user-1', 'Integrations')).rejects.toThrow('expired');
  });

  it('a forged state that just names a user is refused', async () => {
    expect(await consumeOAuthState('abc123:user-1:meetings', 'teams-meetings')).toBeNull();
    expect(await consumeOAuthState('teams-meetings.guess', 'teams-meetings')).toBeNull();
  });
});
