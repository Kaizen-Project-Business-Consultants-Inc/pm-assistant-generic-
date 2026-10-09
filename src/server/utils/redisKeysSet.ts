import { redisService } from '../services/RedisService';
import logger from './logger';

/**
 * Which of these keys are set, in one Redis MGET (2026-10-09) — for jobs that dedup a list of
 * reminders, instead of one GET per reminder. Like `redisService.get`, it never throws: with
 * Redis down or the read failing, no key counts as set (and the failure is logged).
 */
export async function keysAlreadySet(keys: string[]): Promise<boolean[]> {
  const client = redisService.isConnected() ? redisService.getClient() : null;
  if (!client || keys.length === 0) return keys.map(() => false);
  try {
    return (await client.mget(keys)).map(v => !!v);
  } catch (err) {
    logger.error('Redis MGET failed', { keys: keys.length, error: err instanceof Error ? err.message : String(err) });
    return keys.map(() => false);
  }
}
