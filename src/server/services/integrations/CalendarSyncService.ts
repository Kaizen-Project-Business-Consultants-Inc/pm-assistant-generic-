import { v4 as uuidv4 } from 'uuid';
import { googleCalendarAdapter, CalendarEvent } from './GoogleCalendarAdapter';
import { integrationRepository, parseConfig } from '../../database/IntegrationRepository';
import { databaseService } from '../../database/connection';
import { chunksOf } from '../../utils/chunksOf';
import logger from '../../utils/logger';

interface SyncMapping {
  id: string;
  userId: string;
  integrationId: string;
  taskId: string | null;
  calendarEventId: string;
  calendarId: string;
  syncDirection: 'push' | 'pull' | 'both';
  lastSyncedAt: string | null;
  etag: string | null;
}

class CalendarSyncService {
  async pushTaskToCalendar(task: { id: string; name: string; description?: string; startDate?: string; endDate?: string; dueDate?: string }, userId: string): Promise<void> {
    const integrations = await this.getActiveCalendarIntegrations(userId);
    if (integrations.length === 0) return;

    for (const integ of integrations) {
      try {
        const cfg = parseConfig(integ.config);
        // eslint-disable-next-line no-await-in-loop -- one user's calendar connections (usually one); each needs its own access token before calling Google
        const accessToken = await this.getAccessToken(integ.id, cfg);
        const calendarId = cfg.calendarId || 'primary';

        // Check for existing mapping
        // eslint-disable-next-line no-await-in-loop -- one user's calendar connections (usually one); this mapping lookup decides update vs create below
        const [existing] = await databaseService.query(
          'SELECT * FROM calendar_sync_mappings WHERE integration_id = ? AND task_id = ?',
          [integ.id, task.id],
        ) as SyncMapping[];

        const event = googleCalendarAdapter.taskToEvent(task);

        if (existing) {
          // eslint-disable-next-line no-await-in-loop -- Google Calendar API is rate-limited; calls go one by one
          const updated = await googleCalendarAdapter.updateEvent(accessToken, calendarId, existing.calendarEventId, event);
          // eslint-disable-next-line no-await-in-loop -- stores the etag Google just returned for this event
          await databaseService.query(
            'UPDATE calendar_sync_mappings SET etag = ?, last_synced_at = NOW() WHERE id = ?',
            [updated.etag || null, existing.id],
          );
        } else {
          // eslint-disable-next-line no-await-in-loop -- Google Calendar API is rate-limited; calls go one by one
          const created = await googleCalendarAdapter.createEvent(accessToken, calendarId, event);
          const id = uuidv4();
          // eslint-disable-next-line no-await-in-loop -- records the event id Google just returned for this task
          await databaseService.query(
            `INSERT INTO calendar_sync_mappings (id, user_id, integration_id, task_id, calendar_event_id, calendar_id, sync_direction, etag, last_synced_at)
             VALUES (?, ?, ?, ?, ?, ?, 'both', ?, NOW())`,
            [id, userId, integ.id, task.id, created.id, calendarId, created.etag || null],
          );
        }
      } catch (err) {
        logger.error('[CalendarSync] Push to calendar failed', { taskId: task.id, integrationId: integ.id, error: err });
      }
    }
  }

  async syncUserCalendar(userId: string): Promise<{ pushed: number; pulled: number }> {
    const integrations = await this.getActiveCalendarIntegrations(userId);
    let pushed = 0;
    let pulled = 0;

    for (const integ of integrations) {
      try {
        const cfg = parseConfig(integ.config);
        // eslint-disable-next-line no-await-in-loop -- one user's calendar connections (usually one); each needs its own access token before calling Google
        const accessToken = await this.getAccessToken(integ.id, cfg);
        const calendarId = cfg.calendarId || 'primary';
        const syncToken = cfg.syncToken;

        // eslint-disable-next-line no-await-in-loop -- Google Calendar API is rate-limited; calls go one by one
        const { events, nextSyncToken } = await googleCalendarAdapter.listEvents(accessToken, calendarId, syncToken);

        // Update sync token
        if (nextSyncToken && nextSyncToken !== syncToken) {
          cfg.syncToken = nextSyncToken;
          // eslint-disable-next-line no-await-in-loop -- saves this connection's new sync token before processing its events
          await integrationRepository.updateIntegration(integ.id, { config: cfg });
        }

        // Process pulled events: this connection's mappings for all of them in one read (per 200
        // events) and the changed etags in one UPDATE, not a read + update per event (2026-10-09)
        // eslint-disable-next-line no-restricted-syntax -- small: one pass over this connection's events to list their ids (not a search)
        const eventIds = events.map(e => e.id).filter(Boolean) as string[];
        // eslint-disable-next-line no-await-in-loop -- one user's calendar connections (usually one); reads this connection's mappings
        const mappings = await this.mappingsForEvents(integ.id, eventIds);
        const changedEtag = new Map<string, string | null>();
        for (const event of events) {
          if (!event.id) continue;
          const mapping = mappings.get(event.id);

          if (mapping && mapping.taskId && mapping.syncDirection !== 'push') {
            if (event.status === 'cancelled') continue;
            if (event.etag !== mapping.etag) {
              // Event changed — update task dates (fire-and-forget, no circular push)
              pulled++;
              changedEtag.set(mapping.id, event.etag ?? null);
              mapping.etag = event.etag ?? null; // a repeat of this event compares with what was just saved
            }
          }
        }
        // eslint-disable-next-line no-await-in-loop -- one user's calendar connections (usually one); saves this connection's changed etags
        await this.saveEtags(changedEtag);

        // eslint-disable-next-line no-await-in-loop -- marks this connection synced after its own events are processed
        await integrationRepository.updateLastSyncAt(integ.id);
      } catch (err) {
        logger.error('[CalendarSync] Sync failed', { userId, integrationId: integ.id, error: err });
      }
    }

    return { pushed, pulled };
  }

  /** A connection's mappings for these event ids, by event id — one read per 200 ids */
  private async mappingsForEvents(integrationId: string, eventIds: string[]): Promise<Map<string, SyncMapping>> {
    const out = new Map<string, SyncMapping>();
    for (const chunk of chunksOf([...new Set(eventIds)], 200)) {
      // eslint-disable-next-line no-await-in-loop -- one read per 200 events
      const rows = await databaseService.query(
        `SELECT * FROM calendar_sync_mappings WHERE integration_id = ? AND calendar_event_id IN (${chunk.map(() => '?').join(',')})`,
        [integrationId, ...chunk],
      ) as Array<SyncMapping & { calendar_event_id: string }>;
      for (const row of rows) out.set(row.calendar_event_id, row);
    }
    return out;
  }

  /** New etags (mapping id → etag), stamped as synced now — one UPDATE per 200 */
  private async saveEtags(etagById: Map<string, string | null>): Promise<void> {
    for (const chunk of chunksOf([...etagById], 200)) {
      // eslint-disable-next-line no-await-in-loop -- one statement per 200 mappings
      await databaseService.query(
        `UPDATE calendar_sync_mappings SET etag = CASE id ${chunk.map(() => 'WHEN ? THEN ?').join(' ')} END, last_synced_at = NOW()
          WHERE id IN (${chunk.map(() => '?').join(',')})`,
        [...chunk.flat(), ...chunk.map(([id]) => id)],
      );
    }
  }

  async syncAllUsers(): Promise<{ synced: number; errors: number }> {
    let synced = 0;
    let errors = 0;
    try {
      const rows = await databaseService.query(
        "SELECT DISTINCT user_id FROM integrations WHERE provider = 'google_calendar' AND is_active = 1",
      ) as any[];

      for (const row of rows) {
        try {
          // eslint-disable-next-line no-await-in-loop -- one user at a time: each sync calls the rate-limited Google Calendar API
          await this.syncUserCalendar(row.user_id);
          synced++;
        } catch {
          errors++;
        }
      }
    } catch {
      // integrations table may not exist yet
    }
    return { synced, errors };
  }

  async unlinkTask(taskId: string): Promise<void> {
    await databaseService.query('DELETE FROM calendar_sync_mappings WHERE task_id = ?', [taskId]);
  }

  private async getActiveCalendarIntegrations(userId: string) {
    const rows = await databaseService.query(
      "SELECT * FROM integrations WHERE user_id = ? AND provider = 'google_calendar' AND is_active = 1",
      [userId],
    ) as any[];
    return rows;
  }

  private async getAccessToken(integrationId: string, cfg: Record<string, any>): Promise<string> {
    if (cfg.accessToken && cfg.tokenExpiresAt && Date.now() < Number(cfg.tokenExpiresAt) - 60000) {
      return cfg.accessToken;
    }

    if (!cfg.refreshToken) throw new Error('No refresh token available');
    const token = await googleCalendarAdapter.refreshToken(cfg.refreshToken);
    cfg.accessToken = token.access_token;
    cfg.tokenExpiresAt = Date.now() + token.expires_in * 1000;
    if (token.refresh_token) cfg.refreshToken = token.refresh_token;
    await integrationRepository.updateIntegration(integrationId, { config: cfg });
    return token.access_token;
  }
}

export const calendarSyncService = new CalendarSyncService();
