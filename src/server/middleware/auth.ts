import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import type { JwtPayload } from '../types/fastify';
import { apiKeyService } from '../services/ApiKeyService';
import { databaseService } from '../database/connection';
import { redisService } from '../services/RedisService';

const ACTIVE_CHECK_TTL = 300; // 5 minutes

async function isUserActive(userId: string): Promise<boolean> {
  const cacheKey = `user:active:${userId}`;
  const cached = await redisService.get(cacheKey);
  if (cached !== null) return cached === '1';

  const rows = await databaseService.queryControlPlane<{ is_active: number }>(
    'SELECT is_active FROM users WHERE id = ? LIMIT 1',
    [userId],
  );
  const active = rows.length > 0 && Boolean(rows[0].is_active);
  redisService.set(cacheKey, active ? '1' : '0', ACTIVE_CHECK_TTL).catch(() => {});
  return active;
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  // Check for Bearer token (API key) first
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const rawKey = authHeader.slice(7);
    try {
      const keyInfo = await apiKeyService.validateKey(rawKey);
      if (!keyInfo) {
        return reply.status(401).send({
          error: 'Invalid API key',
          message: 'The provided API key is invalid or expired',
        });
      }

      // Check if the API key owner is still active
      const active = await isUserActive(keyInfo.userId);
      if (!active) {
        return reply.status(401).send({
          error: 'Account deactivated',
          message: 'Your account has been deactivated',
        });
      }

      request.user = {
        userId: keyInfo.userId,
        username: 'api-key',
        role: keyInfo.userRole,
      };
      request.apiKeyId = keyInfo.keyId;
      request.apiKeyScopes = keyInfo.scopes;
      request.apiKeyRateLimit = keyInfo.rateLimit;
      return;
    } catch (error) {
      return reply.status(401).send({
        error: 'Invalid API key',
        message: 'Failed to validate API key',
      });
    }
  }

  // Fall through to JWT cookie authentication
  try {
    const token = request.cookies.access_token;

    if (!token) {
      return reply.status(401).send({
        error: 'No access token',
        message: 'Access token is required',
      });
    }

    const decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload;

    // Check if user is still active (deactivated users rejected even with valid JWT)
    const active = await isUserActive(decoded.userId);
    if (!active) {
      return reply.status(401).send({
        error: 'Account deactivated',
        message: 'Your account has been deactivated',
      });
    }

    request.user = {
      userId: decoded.userId,
      username: decoded.username,
      role: decoded.role,
    };

    // Fetch extra user flags (must_change_password, is_guest)
    const url = request.url;
    const isPasswordChangeAllowed = url.includes('/auth/change-password') || url.includes('/auth/logout') || url.includes('/auth/me');
    const rows = await databaseService.queryControlPlane<{ must_change_password: number; is_guest: number; guest_expires_at: string | null }>(
      'SELECT must_change_password, is_guest, guest_expires_at FROM users WHERE id = ? LIMIT 1',
      [decoded.userId],
    );

    if (rows.length > 0) {
      if (!isPasswordChangeAllowed && rows[0].must_change_password) {
        return reply.status(403).send({
          error: 'Password change required',
          code: 'PASSWORD_CHANGE_REQUIRED',
          message: 'You must change your password before continuing.',
        });
      }

      if (rows[0].is_guest) {
        request.user!.isGuest = true;
        request.user!.guestExpiresAt = rows[0].guest_expires_at;
      }
    }

  } catch (error) {
    if ((error as any)?.error === 'Account deactivated') {
      return reply.status(401).send({
        error: 'Account deactivated',
        message: 'Your account has been deactivated',
      });
    }
    return reply.status(401).send({
      error: 'Invalid token',
      message: 'Access token is invalid or expired',
    });
  }
}
