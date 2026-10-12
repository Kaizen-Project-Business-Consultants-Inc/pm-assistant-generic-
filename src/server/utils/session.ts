import type { FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { userService, type User } from '../services/UserService';

const ACCESS_SECONDS = 15 * 60;
const REFRESH_SECONDS = 24 * 60 * 60;

/**
 * Sign the access and refresh tokens for this session version and set them as cookies (httpOnly,
 * secure in production, SameSite=Lax). Returns the access token. One place for what used to be four
 * copies in routes/core/auth.ts (sign-in, paid sign-up, email-link sign-in, refresh) — now also Google.
 */
export function setSessionCookies(reply: FastifyReply, user: Pick<User, 'id' | 'username' | 'role'>, tokenVersion: number): string {
  const accessToken = jwt.sign(
    { userId: user.id, username: user.username, role: user.role, tv: tokenVersion },
    config.JWT_SECRET,
    { expiresIn: '15m', algorithm: 'HS256' },
  );
  const refreshToken = jwt.sign(
    { userId: user.id, type: 'refresh', tv: tokenVersion },
    config.JWT_REFRESH_SECRET,
    { expiresIn: '24h', algorithm: 'HS256' },
  );
  const base = { httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' };
  reply.setCookie('access_token', accessToken, { ...base, maxAge: ACCESS_SECONDS });
  reply.setCookie('refresh_token', refreshToken, { ...base, maxAge: REFRESH_SECONDS });
  return accessToken;
}

/**
 * A fresh sign-in: the session version goes up (every older session ends), the sign-in time is
 * recorded (with any `extra` fields in the same write), and the cookies are set. Returns the access token.
 */
export async function startNewSession(
  reply: FastifyReply,
  user: Pick<User, 'id' | 'username' | 'role' | 'tokenVersion'>,
  extra: Partial<User> = {},
): Promise<string> {
  const tokenVersion = (user.tokenVersion ?? 0) + 1;
  await userService.update(user.id, { ...extra, tokenVersion, lastLoginAt: new Date() });
  return setSessionCookies(reply, user, tokenVersion);
}
