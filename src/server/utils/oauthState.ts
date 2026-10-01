import crypto from 'crypto';
import { redisService } from '../services/RedisService';

/**
 * One-time sign-in state for "connect your account" flows (2026-09-30, first used by
 * Teams meeting transcripts). The state handed to Microsoft is a random value; which Kovarti
 * user started it is kept here, for 10 minutes, and can be used once. A state that merely
 * contains a user id could be forged to attach someone else's account to that user.
 */
const TTL_SECONDS = 600;
const key = (state: string) => `oauth:state:${state}`;

export class OAuthStateUnavailableError extends Error {
  constructor() { super('Connecting is not available right now. Try again in a minute.'); }
}

export async function issueOAuthState(userId: string, purpose: string): Promise<string> {
  if (!redisService.isConnected()) throw new OAuthStateUnavailableError();
  const state = `${purpose}.${crypto.randomBytes(24).toString('hex')}`;
  await redisService.set(key(state), userId, TTL_SECONDS);
  return state;
}

/** The user who started this sign-in, or null if the state is unknown, used or expired */
export async function consumeOAuthState(state: string, purpose: string): Promise<string | null> {
  if (!state.startsWith(`${purpose}.`) || !/^[\w.-]{1,120}$/.test(state)) return null;
  const userId = await redisService.get(key(state));
  if (userId) await redisService.del(key(state));
  return userId;
}
