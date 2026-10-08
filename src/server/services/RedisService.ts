import Redis from 'ioredis';
import logger from '../utils/logger';

export class RedisService {
  private client: Redis | null = null;
  private connected = false;

  connect(url: string): void {
    try {
      this.client = new Redis(url, {
        lazyConnect: false,
        maxRetriesPerRequest: 1,
      });

      this.client.on('connect', () => {
        this.connected = true;
        logger.info('Redis connected');
      });

      this.client.on('error', (err) => {
        this.connected = false;
        logger.error('Redis error', { error: err.message });
      });

      this.client.on('close', () => {
        this.connected = false;
        logger.warn('Redis connection closed');
      });
    } catch (err) {
      this.connected = false;
      logger.error('Failed to create Redis client', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Connect and wait until it's up (or give up after `ms`). Short-lived scripts need this: the
   * scheduled jobs never connected at all, so every Redis-based alert check saw nothing.
   */
  async connectAndWait(url: string, ms = 3000): Promise<boolean> {
    if (this.connected) return true;
    this.connect(url);
    const started = Date.now();
    // eslint-disable-next-line no-await-in-loop -- polls every 50 ms until Redis connects or the wait runs out
    while (!this.connected && Date.now() - started < ms) await new Promise((r) => setTimeout(r, 50));
    return this.connected;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getClient(): Redis | null {
    return this.connected ? this.client : null;
  }

  async get(key: string): Promise<string | null> {
    if (!this.connected || !this.client) return null;
    try {
      return await this.client.get(key);
    } catch (err) {
      logger.error('Redis GET failed', {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.connected || !this.client) return;
    try {
      if (ttlSeconds !== undefined) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    } catch (err) {
      logger.error('Redis SET failed', {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async del(key: string): Promise<void> {
    if (!this.connected || !this.client) return;
    try {
      await this.client.del(key);
    } catch (err) {
      logger.error('Redis DEL failed', {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async incr(key: string): Promise<number> {
    if (!this.connected || !this.client) return 0;
    try {
      return await this.client.incr(key);
    } catch (err) {
      logger.error('Redis INCR failed', {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
      return 0;
    }
  }

  async incrby(key: string, amount: number): Promise<number> {
    if (!this.connected || !this.client) return 0;
    try {
      return await this.client.incrby(key, amount);
    } catch (err) {
      logger.error('Redis INCRBY failed', {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
      return 0;
    }
  }

  async expire(key: string, seconds: number): Promise<void> {
    if (!this.connected || !this.client) return;
    try {
      await this.client.expire(key, seconds);
    } catch (err) {
      logger.error('Redis EXPIRE failed', {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async ttl(key: string): Promise<number> {
    if (!this.connected || !this.client) return -1;
    try {
      return await this.client.ttl(key);
    } catch (err) {
      logger.error('Redis TTL failed', {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
      return -1;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.quit();
      this.connected = false;
      this.client = null;
      logger.info('Redis disconnected');
    } catch (err) {
      logger.error('Redis disconnect failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      this.connected = false;
      this.client = null;
    }
  }
}

export const redisService = new RedisService();
