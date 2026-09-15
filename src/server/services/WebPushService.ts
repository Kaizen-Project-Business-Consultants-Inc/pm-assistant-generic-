import webpush from 'web-push';
import { v4 as uuidv4 } from 'uuid';
import { databaseService } from '../database/connection';
import { config } from '../config';
import logger from '../utils/logger';

interface PushSubscriptionRecord {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

class WebPushService {
  private configured = false;

  constructor() {
    if (config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY && config.VAPID_EMAIL) {
      try {
        webpush.setVapidDetails(
          `mailto:${config.VAPID_EMAIL}`,
          config.VAPID_PUBLIC_KEY,
          config.VAPID_PRIVATE_KEY,
        );
        this.configured = true;
      } catch (err) {
        logger.warn('[WebPushService] Failed to configure VAPID', { error: err });
      }
    }
  }

  get isConfigured(): boolean {
    return this.configured;
  }

  async subscribe(userId: string, subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent?: string): Promise<void> {
    const id = uuidv4();
    await databaseService.query(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE p256dh = VALUES(p256dh), auth = VALUES(auth), user_agent = VALUES(user_agent)`,
      [id, userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, userAgent || null],
    );
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await databaseService.query(
      'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?',
      [userId, endpoint],
    );
  }

  async sendPush(userId: string, payload: { title: string; body: string; url?: string; tag?: string }): Promise<void> {
    if (!this.configured) return;

    const rows = await databaseService.query(
      'SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
      [userId],
    ) as PushSubscriptionRecord[];

    if (rows.length === 0) return;

    const jsonPayload = JSON.stringify(payload);
    const staleIds: string[] = [];

    for (const row of rows) {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          jsonPayload,
          { TTL: 86400 },
        );
      } catch (err: any) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          staleIds.push(row.id);
        } else {
          logger.error('[WebPushService] Push failed', { userId, endpoint: row.endpoint.slice(0, 60), error: err.message });
        }
      }
    }

    if (staleIds.length > 0) {
      const placeholders = staleIds.map(() => '?').join(',');
      await databaseService.query(
        `DELETE FROM push_subscriptions WHERE id IN (${placeholders})`,
        staleIds,
      );
    }
  }
}

export const webPushService = new WebPushService();
