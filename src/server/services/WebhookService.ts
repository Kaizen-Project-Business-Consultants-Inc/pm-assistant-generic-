import crypto from 'crypto';
import { webhookRepository, Webhook } from '../database/WebhookRepository';
import { webhookDeliveryRepository } from '../database/WebhookDeliveryRepository';
import logger from '../utils/logger';
import type { WebhookEvent } from '../constants/webhookEvents';

export type { Webhook } from '../database/WebhookRepository';

function maskSecret(webhook: Webhook): Webhook {
  return { ...webhook, secret: webhook.secret.substring(0, 8) + '...' };
}

/** Block SSRF: reject URLs targeting private/internal networks. */
function isPrivateUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    if (!['http:', 'https:'].includes(url.protocol)) return true;
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '[::1]') return true;
    // IPv4 private ranges
    const parts = hostname.split('.').map(Number);
    if (parts.length === 4 && parts.every(n => !isNaN(n))) {
      if (parts[0] === 127) return true; // 127.0.0.0/8
      if (parts[0] === 10) return true; // 10.0.0.0/8
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
      if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16
      if (parts[0] === 169 && parts[1] === 254) return true; // 169.254.0.0/16
      if (parts[0] === 0) return true; // 0.0.0.0/8
    }
    return false;
  } catch {
    return true; // Invalid URL = reject
  }
}

export class WebhookService {
  async register(userId: string, url: string, events: string[], secret?: string): Promise<Webhook> {
    if (isPrivateUrl(url)) {
      throw new Error('Webhook URL must not target private or internal networks');
    }
    const webhookSecret = secret || crypto.randomBytes(32).toString('hex');
    return webhookRepository.insert(userId, url, webhookSecret, events);
  }

  async list(userId: string): Promise<Webhook[]> {
    const hooks = await webhookRepository.findByUser(userId);
    return hooks.map(maskSecret);
  }

  async getById(userId: string, webhookId: string): Promise<Webhook | null> {
    const hook = await webhookRepository.findByUserAndId(userId, webhookId);
    return hook ? maskSecret(hook) : null;
  }

  async update(userId: string, webhookId: string, data: { url?: string; events?: string[]; isActive?: boolean }): Promise<Webhook | null> {
    const sets: string[] = [];
    const params: any[] = [];

    if (data.url !== undefined) { sets.push('url = ?'); params.push(data.url); }
    if (data.events !== undefined) { sets.push('events = ?'); params.push(JSON.stringify(data.events)); }
    if (data.isActive !== undefined) {
      sets.push('is_active = ?');
      params.push(data.isActive);
      if (data.isActive) { sets.push('failure_count = ?'); params.push(0); }
    }

    await webhookRepository.updateFields(webhookId, userId, sets, params);

    const hook = await webhookRepository.findByUserAndId(userId, webhookId);
    return hook ? maskSecret(hook) : null;
  }

  async delete(userId: string, webhookId: string): Promise<boolean> {
    return webhookRepository.deleteByUser(webhookId, userId);
  }

  async dispatch(event: WebhookEvent, payload: object, userId?: string): Promise<void> {
    if (!userId) return;
    let hooks: Webhook[];
    try {
      hooks = await webhookRepository.findActiveByUser(userId);
    } catch (error) {
      logger.error('Webhook dispatch: failed to query webhooks:', error);
      return;
    }

    const matching = hooks.filter(h => h.events.includes(event));
    for (const webhook of matching) {
      this.deliverWebhook(webhook, event, payload).catch(err => {
        logger.error(`Webhook delivery failed for ${webhook.id}:`, err);
      });
    }
  }

  async getDeliveries(webhookId: string, limit: number, offset: number) {
    return webhookDeliveryRepository.findByWebhookPaginated(webhookId, limit, offset);
  }

  private async deliverWebhook(webhook: Webhook, event: string, payload: object, isRetry = false): Promise<void> {
    if (isPrivateUrl(webhook.url)) {
      logger.warn('Blocked webhook delivery to private URL', { webhookId: webhook.id, url: webhook.url });
      return;
    }
    const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
    const signature = crypto.createHmac('sha256', webhook.secret).update(body).digest('hex');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const start = Date.now();

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Event': event,
          'X-Webhook-Signature': signature,
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const responseTimeMs = Date.now() - start;
      await webhookRepository.recordSuccess(webhook.id, response.status);
      webhookDeliveryRepository.insert(webhook.id, event, payload, response.status, responseTimeMs, null).catch(() => {});
    } catch (error: any) {
      clearTimeout(timeoutId);
      const responseTimeMs = Date.now() - start;
      const errMsg = error.message || String(error);
      logger.error(`Webhook delivery error for ${webhook.id}:`, errMsg);
      const newFailureCount = webhook.failureCount + 1;
      await webhookRepository.recordFailure(webhook.id, newFailureCount, newFailureCount >= 5);
      webhookDeliveryRepository.insert(webhook.id, event, payload, null, responseTimeMs, errMsg).catch(() => {});

      // Schedule one retry after 60s (no infinite chains)
      if (!isRetry) {
        setTimeout(() => {
          this.deliverWebhook(webhook, event, payload, true).catch(err => {
            logger.error(`Webhook retry failed for ${webhook.id}:`, err);
          });
        }, 60_000);
      }
    }
  }

  async test(userId: string, webhookId: string): Promise<boolean> {
    const webhook = await webhookRepository.findByUserAndId(userId, webhookId);
    if (!webhook) return false;
    this.deliverWebhook(webhook, 'webhook.test', { message: 'Test ping' }).catch(err => {
      logger.error(`Test webhook delivery failed for ${webhook.id}:`, err);
    });
    return true;
  }
}

export const webhookService = new WebhookService();
