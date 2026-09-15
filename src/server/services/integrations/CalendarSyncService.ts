import { v4 as uuidv4 } from 'uuid';
import { googleCalendarAdapter, CalendarEvent } from './GoogleCalendarAdapter';
import { integrationRepository, parseConfig } from '../../database/IntegrationRepository';
import { databaseService } from '../../database/connection';
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
        const accessToken = await this.getAccessToken(integ.id, cfg);
        const calendarId = cfg.calendarId || 'primary';

        // Check for existing mapping
        const [existing] = await databaseService.query(
          'SELECT * FROM calendar_sync_mappings WHERE integration_id = ? AND task_id = ?',
          [integ.id, task.id],
        ) as SyncMapping[];

        const event = googleCalendarAdapter.taskToEvent(task);

        if (existing) {
          const updated = await googleCalendarAdapter.updateEvent(accessToken, calendarId, existing.calendarEventId, event);
          await databaseService.query(
            'UPDATE calendar_sync_mappings SET etag = ?, last_synced_at = NOW() WHERE id = ?',
            [updated.etag || null, existing.id],
          );
        } else {
          const created = await googleCalendarAdapter.createEvent(accessToken, calendarId, event);
          const id = uuidv4();
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
        const accessToken = await this.getAccessToken(integ.id, cfg);
        const calendarId = cfg.calendarId || 'primary';
        const syncToken = cfg.syncToken;

        const { events, nextSyncToken } = await googleCalendarAdapter.listEvents(accessToken, calendarId, syncToken);

        // Update sync token
        if (nextSyncToken && nextSyncToken !== syncToken) {
          cfg.syncToken = nextSyncToken;
          await integrationRepository.updateIntegration(integ.id, { config: cfg });
        }

        // Process pulled events
        for (const event of events) {
          if (!event.id) continue;
          const [mapping] = await databaseService.query(
            'SELECT * FROM calendar_sync_mappings WHERE integration_id = ? AND calendar_event_id = ?',
            [integ.id, event.id],
          ) as SyncMapping[];

          if (mapping && mapping.taskId && mapping.syncDirection !== 'push') {
            if (event.status === 'cancelled') continue;
            if (event.etag !== mapping.etag) {
              // Event changed — update task dates (fire-and-forget, no circular push)
              pulled++;
              await databaseService.query(
                'UPDATE calendar_sync_mappings SET etag = ?, last_synced_at = NOW() WHERE id = ?',
                [event.etag, mapping.id],
              );
            }
          }
        }

        await integrationRepository.updateLastSyncAt(integ.id);
      } catch (err) {
        logger.error('[CalendarSync] Sync failed', { userId, integrationId: integ.id, error: err });
      }
    }

    return { pushed, pulled };
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
