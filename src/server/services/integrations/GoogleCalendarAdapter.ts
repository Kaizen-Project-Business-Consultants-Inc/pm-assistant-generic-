import logger from '../../utils/logger';
import { config } from '../../config';

const AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CAL_API = 'https://www.googleapis.com/calendar/v3';

export interface CalendarToken {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export interface CalendarEvent {
  id?: string;
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  etag?: string;
  status?: string;
}

export interface CalendarInfo {
  id: string;
  summary: string;
  primary?: boolean;
}

class GoogleCalendarAdapter {
  get isConfigured(): boolean {
    return !!(config.GOOGLE_CALENDAR_CLIENT_ID && config.GOOGLE_CALENDAR_CLIENT_SECRET);
  }

  buildAuthUrl(params: { redirectUri: string; state: string }): string {
    const query = new URLSearchParams({
      client_id: config.GOOGLE_CALENDAR_CLIENT_ID,
      response_type: 'code',
      redirect_uri: params.redirectUri,
      scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly',
      state: params.state,
      access_type: 'offline',
      prompt: 'consent',
    });
    return `${AUTH_BASE}?${query.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<CalendarToken> {
    const body = new URLSearchParams({
      client_id: config.GOOGLE_CALENDAR_CLIENT_ID,
      client_secret: config.GOOGLE_CALENDAR_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!resp.ok) {
      const text = await resp.text();
      logger.error('Google Calendar token exchange failed', { status: resp.status, body: text });
      throw new Error(`Token exchange failed: ${resp.status}`);
    }
    return resp.json() as Promise<CalendarToken>;
  }

  async refreshToken(refreshToken: string): Promise<CalendarToken> {
    const body = new URLSearchParams({
      client_id: config.GOOGLE_CALENDAR_CLIENT_ID,
      client_secret: config.GOOGLE_CALENDAR_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!resp.ok) throw new Error(`Token refresh failed: ${resp.status}`);
    const data: any = await resp.json();
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshToken,
      expires_in: data.expires_in,
    };
  }

  async listCalendars(accessToken: string): Promise<CalendarInfo[]> {
    const resp = await fetch(`${CAL_API}/users/me/calendarList`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) throw new Error(`List calendars failed: ${resp.status}`);
    const data: any = await resp.json();
    return (data.items || []).map((c: any) => ({
      id: c.id,
      summary: c.summary,
      primary: c.primary,
    }));
  }

  async listEvents(accessToken: string, calendarId: string, syncToken?: string): Promise<{ events: CalendarEvent[]; nextSyncToken?: string }> {
    const params = new URLSearchParams({ maxResults: '250', singleEvents: 'true' });
    if (syncToken) {
      params.set('syncToken', syncToken);
    } else {
      params.set('timeMin', new Date().toISOString());
      params.set('timeMax', new Date(Date.now() + 365 * 86400000).toISOString());
    }

    const resp = await fetch(`${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (resp.status === 410) {
      // Sync token expired — do a full sync
      return this.listEvents(accessToken, calendarId);
    }
    if (!resp.ok) throw new Error(`List events failed: ${resp.status}`);
    const data: any = await resp.json();
    return {
      events: (data.items || []).map((e: any) => ({
        id: e.id,
        summary: e.summary || '',
        description: e.description,
        start: e.start || {},
        end: e.end || {},
        etag: e.etag,
        status: e.status,
      })),
      nextSyncToken: data.nextSyncToken,
    };
  }

  async createEvent(accessToken: string, calendarId: string, event: CalendarEvent): Promise<CalendarEvent> {
    const resp = await fetch(`${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    });
    if (!resp.ok) throw new Error(`Create event failed: ${resp.status}`);
    return resp.json() as Promise<CalendarEvent>;
  }

  async updateEvent(accessToken: string, calendarId: string, eventId: string, event: CalendarEvent): Promise<CalendarEvent> {
    const resp = await fetch(`${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    });
    if (!resp.ok) throw new Error(`Update event failed: ${resp.status}`);
    return resp.json() as Promise<CalendarEvent>;
  }

  async deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
    const resp = await fetch(`${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok && resp.status !== 410) throw new Error(`Delete event failed: ${resp.status}`);
  }

  taskToEvent(task: { name: string; description?: string; startDate?: string; endDate?: string; dueDate?: string }): CalendarEvent {
    const startStr = task.startDate || task.dueDate || new Date().toISOString().split('T')[0];
    const endStr = task.endDate || task.dueDate || startStr;
    return {
      summary: task.name,
      description: task.description || '',
      start: { date: startStr },
      end: { date: endStr },
    };
  }

  eventToTaskUpdate(event: CalendarEvent): { name?: string; startDate?: string; endDate?: string } {
    const update: { name?: string; startDate?: string; endDate?: string } = {};
    if (event.summary) update.name = event.summary;
    if (event.start?.date) update.startDate = event.start.date;
    else if (event.start?.dateTime) update.startDate = event.start.dateTime.split('T')[0];
    if (event.end?.date) update.endDate = event.end.date;
    else if (event.end?.dateTime) update.endDate = event.end.dateTime.split('T')[0];
    return update;
  }
}

export const googleCalendarAdapter = new GoogleCalendarAdapter();
