import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import type { JwtPayload } from '../types/fastify';
import { apiKeyService } from '../services/ApiKeyService';
import { guestGuard } from './guestGuard';
import { permissionRole } from '../utils/companyOwner';
import { databaseService } from '../database/connection';
import { redisService } from '../services/RedisService';
import { subscriptionGuard } from './requireSubscription';
import { isTokenError, sendBusy, logBusy } from '../utils/serviceBusy';

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

type RequestUser = NonNullable<FastifyRequest['user']>;

/**
 * The person behind an API key / Claude connection, with the same mapping everywhere: the company
 * owner works as PMO (never a guest), guest flags, `hasCompany`, `isOwner`. Used by authMiddleware
 * and by the global API-key hook in plugins.ts, which used to set a bare `{ userId, role }` from
 * the key's raw role without any of this (audit 2, L-j, 2026-10-11). null = the account is
 * deactivated. One lookup per request: the hook and the middleware share the answer.
 */
const keyUserCache = new WeakMap<FastifyRequest, Promise<RequestUser | null>>();
export function apiKeyUser(request: FastifyRequest, keyInfo: { userId: string; userRole: string }): Promise<RequestUser | null> {
  const cached = keyUserCache.get(request);
  if (cached) return cached;
  const p = (async (): Promise<RequestUser | null> => {
    if (!(await isUserActive(keyInfo.userId))) return null;
    const keyOwner = await databaseService.queryControlPlane<{ organization_id: string | null; is_guest: number; guest_expires_at: string | null; is_owner: number | null }>(
      `SELECT u.organization_id, u.is_guest, u.guest_expires_at, (o.owner_user_id = u.id) AS is_owner
         FROM users u LEFT JOIN organizations o ON o.id = u.organization_id WHERE u.id = ? LIMIT 1`,
      [keyInfo.userId],
    );
    const user: RequestUser = {
      userId: keyInfo.userId,
      username: 'api-key',
      // the company owner has a PMO's permissions (utils/companyOwner.ts)
      role: permissionRole(keyInfo.userRole, { isOwner: !!Number(keyOwner[0]?.is_owner), isGuest: !!keyOwner[0]?.is_guest }),
      accountRole: keyInfo.userRole,
      // unknown (no row) counts as having a company: never mistaken for the platform admin
      hasCompany: keyOwner.length > 0 ? keyOwner[0].organization_id != null : true,
      isOwner: !!Number(keyOwner[0]?.is_owner),
    };
    if (keyOwner[0]?.is_guest) {
      user.isGuest = true;
      user.guestExpiresAt = keyOwner[0].guest_expires_at;
    }
    return user;
  })();
  keyUserCache.set(request, p);
  return p;
}

/**
 * Global onRequest hook (registered in plugins.ts): a valid `Bearer` key tags the request with its
 * key id, scopes and rate limit — and sets the key's user now, with the same mapping authMiddleware
 * uses (apiKeyUser: owner → PMO, guest flags, company). The tenant resolver, a global preHandler,
 * runs BEFORE each route's authMiddleware and picks the company database from this user; with no
 * user it would leave the request on the shared database. Guests get a user too, flagged isGuest —
 * their limits and expiry are applied by authMiddleware's guest guard. A deactivated account gets no
 * user here (and a 401 from authMiddleware). Until audit 2 (L-j) this set the key's raw role with
 * none of these checks.
 */
export async function resolveApiKeyOnRequest(request: FastifyRequest): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ') || !(request.url.startsWith('/api/') || request.url.startsWith('/mcp'))) return;
  try {
    const keyInfo = await apiKeyService.validateKey(authHeader.slice(7));
    if (!keyInfo) return;
    request.apiKeyId = keyInfo.keyId;
    request.apiKeyScopes = keyInfo.scopes;
    request.apiKeyRateLimit = keyInfo.rateLimit;
    if (!request.user) {
      const keyUser = await apiKeyUser(request, keyInfo);
      if (keyUser) request.user = { ...keyUser };
    }
  } catch (err) {
    // The key couldn't be checked (database busy). Remember it: the tenant resolver saw no user and
    // left the request on the shared database, so authMiddleware must stop it with 503 even if a
    // second check would now succeed (review 2026-10-12).
    request.apiKeyLookupFailed = true;
    logBusy('API key check failed in the request hook', err, request.url);
  }
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  // Check for Bearer token (API key) first
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    if (request.apiKeyLookupFailed) return sendBusy(reply);
    const rawKey = authHeader.slice(7);
    try {
      const keyInfo = await apiKeyService.validateKey(rawKey);
      if (!keyInfo) {
        return reply.status(401).send({
          error: 'Invalid API key',
          message: 'The provided API key is invalid or expired',
        });
      }

      // Check if the API key owner is still active; their role mapping is shared with plugins.ts
      const keyUser = await apiKeyUser(request, keyInfo);
      if (!keyUser) {
        return reply.status(401).send({
          error: 'Account deactivated',
          message: 'Your account has been deactivated',
        });
      }
      request.user = { ...keyUser };
      request.apiKeyId = keyInfo.keyId;
      request.apiKeyScopes = keyInfo.scopes;
      request.apiKeyRateLimit = keyInfo.rateLimit;
      // A guest's limits (and expiry) apply through a key too
      await guestGuard(request, reply);
      if (reply.sent) return;
      // An expired trial cannot write through the API either.
      return subscriptionGuard(request, reply);
    } catch (error) {
      // validateKey answers null for a bad key; a throw here is the database (or a bug), not the key
      logBusy('API key check failed', error, request.url);
      return sendBusy(reply);
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
      // Support view (set by tenantResolver): inside the visited company the admin is a
      // read-only executive — sees every project, changes nothing
      role: request.supportSession && decoded.role === 'admin' ? 'executive' : decoded.role,
    };

    // Fetch extra user flags (must_change_password, is_guest)
    const url = request.url;
    const isPasswordChangeAllowed = url.includes('/auth/change-password') || url.includes('/auth/logout') || url.includes('/auth/me');
    const rows = await databaseService.queryControlPlane<{ must_change_password: number; is_guest: number; guest_expires_at: string | null; organization_id: string | null; is_owner: number | null }>(
      `SELECT u.must_change_password, u.is_guest, u.guest_expires_at, u.organization_id, (o.owner_user_id = u.id) AS is_owner
         FROM users u LEFT JOIN organizations o ON o.id = u.organization_id WHERE u.id = ? LIMIT 1`,
      [decoded.userId],
    );
    // the company owner has a PMO's permissions (utils/companyOwner.ts); never during Support view
    if (rows.length > 0 && !request.supportSession) {
      request.user.accountRole = request.user.role;
      request.user.role = permissionRole(request.user.role, { isOwner: !!Number(rows[0].is_owner), isGuest: !!rows[0].is_guest });
    }
    // unknown (no row) counts as having a company: never mistaken for the platform admin
    request.user.hasCompany = rows.length > 0 ? rows[0].organization_id != null : true;
    request.user.isOwner = rows.length > 0 && !!Number(rows[0].is_owner) && !request.supportSession;

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

    // Guests: blocked areas + expiry. This used to be a global onRequest hook, which runs before
    // this middleware has set the user — so it never saw a guest and expired guests kept full
    // access (2026-10-05 audit).
    await guestGuard(request, reply);
    if (reply.sent) return;

    // The trial has to actually end. This sits here, rather than on each of the
    // 282 write routes, because this is the one place the user becomes known —
    // global hooks run before route authentication, so they see nobody. The
    // guard itself decides what is exempt; see middleware/requireSubscription.
    await subscriptionGuard(request, reply);
    if (reply.sent) return;

  } catch (error) {
    if ((error as any)?.error === 'Account deactivated') {
      return reply.status(401).send({
        error: 'Account deactivated',
        message: 'Your account has been deactivated',
      });
    }
    if (isTokenError(error)) {
      return reply.status(401).send({
        error: 'Invalid token',
        message: 'Access token is invalid or expired',
      });
    }
    // Not the token: the database (full pool, lost connection) or a bug. Never "not signed in" —
    // that made the app sign people out whenever the server was busy (2026-10-12).
    logBusy('Sign-in check failed', error, request.url);
    return sendBusy(reply);
  }
}
