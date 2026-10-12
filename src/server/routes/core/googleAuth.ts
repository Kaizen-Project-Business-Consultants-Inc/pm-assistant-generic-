import crypto from 'crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { config } from '../../config';
import { userService, type User } from '../../services/UserService';
import { emailService } from '../../services/EmailService';
import { organizationService } from '../../services/OrganizationService';
import { inviteService } from '../../services/InviteService';
import { createAccount, provisionVerifiedTenant } from '../../services/accountSignup';
import { redisService } from '../../services/RedisService';
import { userIdentityRepository } from '../../database/UserIdentityRepository';
import { rateLimiter } from '../../middleware/rateLimiter';
import { guestExpired } from '../../middleware/guestGuard';
import { countRegistrationAttempt } from '../../utils/registrationWatch';
import { startNewSession } from '../../utils/session';
import { hasPassword, NO_PASSWORD_MESSAGE } from '../../utils/googleOnlyAccount';
import {
  startGoogleSignIn, finishGoogleSignIn, googleSignInConfigured, GoogleSignInError,
  type GoogleIdentity, type GoogleSignInIntent,
} from '../../utils/googleSignIn';
import logger from '../../utils/logger';

/**
 * Sign in / sign up with Google (2026-10-12, user OK on https://claude.ai/artifact/Lm28VFe8D1RvSwTLULzTzz).
 * - People are found by their Google id (never by email).
 * - The return from Google only counts in the browser that started it (a cookie holds the state),
 *   so nobody can send someone a link that signs them in to another person's account.
 * - New address: an account is made the same way as the sign-up form (services/accountSignup.ts),
 *   already confirmed — trial, company, plan checkout, or the invitation (only for the invited address).
 * - An existing account with that address is linked only after its password (or an emailed link),
 *   never automatically: a Google account under the same address must not be able to take it over.
 * Messages go back to the sign-in page as ?google=<code>; the page explains each one.
 */
const PROVIDER = 'google';
const LINK_TTL_SECONDS = 600;
const MAX_PASSWORD_TRIES = 5;
const STATE_COOKIE = 'google_signin';
const STATE_COOKIE_PATH = '/api/v1/auth/google';
const linkKey = (token: string) => `google-link:${token}`;
const emailLinkKey = (code: string) => `google-link-email:${code}`;
const triesKey = (token: string) => `google-link-tries:${token}`;
const EXPIRED = { error: 'Expired', message: 'This took too long. Please click "Continue with Google" again.' };

interface PendingLink { userId: string; subject: string; email: string }

const intentSchema = z.object({
  mode: z.enum(['signin', 'signup']).default('signin'),
  invite: z.string().max(200).optional(),
  tier: z.enum(['consultant_basic', 'consultant_pro', 'sme', 'enterprise']).optional(),
  plan: z.enum(['monthly', 'annual']).optional(),
  seats: z.coerce.number().int().min(3).max(100).optional(),
});

const back = (code: string) => `/login?google=${encodeURIComponent(code)}`;
const isToken = (t: unknown): t is string => typeof t === 'string' && /^[a-f0-9]{48}$/.test(t);

/** Can this person sign in at all? A reason code for the sign-in page, or null */
function refusal(user: User | null): string | null {
  if (!user || user.isActive === false) return 'switched-off';
  if (guestExpired(user)) return 'guest-expired';
  return null;
}

/** Was the return from Google started in this browser? (the state cookie set by /google/start) */
function sameBrowser(request: FastifyRequest): boolean {
  const cookie = request.cookies?.[STATE_COOKIE];
  const state = (request.query as { state?: unknown }).state;
  if (typeof cookie !== 'string' || typeof state !== 'string' || cookie.length !== state.length) return false;
  return crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(state));
}

/** A new account from Google: made like the sign-up form (same limits), already confirmed, then signed in */
async function signUp(request: FastifyRequest, reply: FastifyReply, identity: GoogleIdentity, intent: GoogleSignInIntent): Promise<FastifyReply> {
  const ip = request.ip || 'unknown';
  await countRegistrationAttempt(ip);
  const hourly = await rateLimiter.checkAsync(`auth:register:hourly:${ip}`, 15, 60 * 60_000);
  if (!hourly.allowed) {
    logger.warn('Registration hourly limit hit (Google)', { ip });
    return reply.redirect(back('rate-limited'));
  }
  if (intent.inviteToken) {
    const invite = await inviteService.validateToken(intent.inviteToken);
    if (!invite.valid) return reply.redirect(back('invite-invalid'));
    if (invite.email && invite.email.toLowerCase() !== identity.email) return reply.redirect(back('invite-other-address'));
  }
  const created = await createAccount({
    email: identity.email,
    fullName: identity.name,
    passwordHash: '', // signs in with Google; a password can be set later with "Forgot password?"
    emailVerified: true,
    inviteToken: intent.inviteToken,
    tier: intent.tier,
    plan: intent.plan,
    seats: intent.seats,
  });
  if (!created.ok) {
    logger.warn('Google sign-up refused', { status: created.status, error: created.error });
    return reply.redirect(back(created.status === 409 ? 'account-exists' : 'failed'));
  }
  const { user, checkoutUrl, invitedTo } = created;
  await userIdentityRepository.link(user.id, PROVIDER, identity.subject, identity.email);

  // Confirmed already: build their company now (as confirming the email does), then the welcome email
  if (!invitedTo) {
    const org = await organizationService.findByUserId(user.id).catch(() => null);
    if (org) await provisionVerifiedTenant(org.id, org.dbName, user.id);
  }
  emailService.sendWelcomeEmail(user.email, user.fullName).catch((err) => {
    logger.warn('Welcome email failed after Google sign-up', { userId: user.id, message: err instanceof Error ? err.message : String(err) });
  });
  await startNewSession(reply, user);
  return reply.redirect(checkoutUrl ?? '/onboarding');
}

/** The pending link (who and which Google account) — kept until used or 10 minutes */
async function pendingLink(key: string): Promise<PendingLink | null> {
  const raw = await redisService.get(key).catch(() => null);
  try { return raw ? JSON.parse(raw) as PendingLink : null; } catch { return null; }
}

/**
 * Link and sign in. The person has just proven the address is theirs (Google + password or the
 * emailed link). If the account had never confirmed its email, whoever chose its password never
 * proved the address — so it is confirmed now and that password is dropped (they can set a new one
 * with "Forgot password?"); otherwise someone could sign up with another person's address first
 * and later read what that person entered.
 */
async function completeLink(reply: FastifyReply, pending: PendingLink): Promise<{ ok: true } | { refused: true }> {
  const user = await userService.findById(pending.userId);
  if (refusal(user)) return { refused: true };
  await userIdentityRepository.link(pending.userId, PROVIDER, pending.subject, pending.email).catch((err) => {
    // already linked (e.g. clicked twice): fine; anything else is logged
    if (!String((err as Error)?.message).includes('Duplicate')) logger.error('Google link failed', { userId: pending.userId, message: (err as Error).message });
  });
  const unproven: Partial<User> = user!.emailVerified ? {} : { emailVerified: true, emailVerificationToken: null, emailVerificationExpires: null, passwordHash: '' } as Partial<User>;
  await startNewSession(reply, user!, unproven);
  if (!user!.emailVerified) {
    // Confirmed only now: build their company database, as confirming the email does
    const org = await organizationService.findByUserId(user!.id).catch(() => null);
    if (org) await provisionVerifiedTenant(org.id, org.dbName, user!.id);
  }
  return { ok: true };
}

/** Count a password try on this link; with Redis gone, nothing can be linked anyway (the link lives there) */
async function countTry(token: string): Promise<number> {
  const client = redisService.getClient();
  if (!client) return MAX_PASSWORD_TRIES + 1;
  const n = await client.incr(triesKey(token));
  if (n === 1) await client.expire(triesKey(token), LINK_TTL_SECONDS);
  return n;
}

const NOT_ALLOWED = { error: 'Not allowed', message: "This account cannot sign in. Ask your company's Kovarti owner." };

export async function googleAuthRoutes(fastify: FastifyInstance) {
  // Whether the Google button is shown (only when Google sign-in is set up on this server)
  fastify.get('/providers', { schema: { description: 'Sign-in options available', tags: ['auth'] } }, async () => ({
    google: googleSignInConfigured(),
  }));

  fastify.get('/google/start', { schema: { description: 'Start signing in with Google', tags: ['auth'] } }, async (request, reply) => {
    const rl = await rateLimiter.checkAsync(`auth:google:${request.ip || 'unknown'}`, 20, 60_000);
    if (!rl.allowed) return reply.redirect(back('rate-limited'));
    const parsed = intentSchema.safeParse(request.query);
    if (!parsed.success) return reply.redirect(back('failed'));
    const q = parsed.data;
    try {
      const url = await startGoogleSignIn({ mode: q.mode, inviteToken: q.invite, tier: q.tier, plan: q.plan, seats: q.seats });
      reply.setCookie(STATE_COOKIE, new URL(url).searchParams.get('state')!, {
        httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'lax', path: STATE_COOKIE_PATH, maxAge: LINK_TTL_SECONDS,
      });
      return reply.redirect(url);
    } catch (err) {
      return reply.redirect(back(err instanceof GoogleSignInError ? err.code : 'unavailable'));
    }
  });

  fastify.get('/google/callback', { schema: { description: 'Google sends the person back here', tags: ['auth'] } }, async (request, reply) => {
    const rl = await rateLimiter.checkAsync(`auth:google:${request.ip || 'unknown'}`, 20, 60_000);
    if (!rl.allowed) return reply.redirect(back('rate-limited'));
    const fromThisBrowser = sameBrowser(request);
    reply.clearCookie(STATE_COOKIE, { path: STATE_COOKIE_PATH });
    if (!fromThisBrowser) return reply.redirect(back('expired'));
    try {
      const { identity, intent } = await finishGoogleSignIn(request.query as { state?: string; code?: string; error?: string });

      // 1. Already linked: sign straight in
      const linkedUserId = await userIdentityRepository.findUserId(PROVIDER, identity.subject);
      if (linkedUserId) {
        const user = await userService.findById(linkedUserId);
        const no = refusal(user);
        if (no) return reply.redirect(back(no));
        void userIdentityRepository.touch(PROVIDER, identity.subject).catch(() => {});
        await startNewSession(reply, user!);
        return reply.redirect('/');
      }

      // 2. An account with this address already exists: link only after proof it's theirs
      const existing = await userService.findByEmail(identity.email);
      if (existing) {
        const no = refusal(existing);
        if (no) return reply.redirect(back(no));
        const token = crypto.randomBytes(24).toString('hex');
        const pending: PendingLink = { userId: existing.id, subject: identity.subject, email: identity.email };
        await redisService.set(linkKey(token), JSON.stringify(pending), LINK_TTL_SECONDS);
        return reply.redirect(`/link-google?token=${token}`);
      }

      // 3. No account: sign-up makes one; from the sign-in button, send them to start a trial
      if (intent.mode !== 'signup') return reply.redirect('/register?google=no-account');
      return signUp(request, reply, identity, intent);
    } catch (err) {
      if (err instanceof GoogleSignInError) return reply.redirect(back(err.code));
      logger.error('Google sign-in failed', { message: err instanceof Error ? err.message : String(err) });
      return reply.redirect(back('failed'));
    }
  });

  // Link with the account's password (screen "You already have a Kovarti account")
  fastify.post('/google/link', { schema: { description: 'Link Google to an existing account with its password', tags: ['auth'] } }, async (request, reply) => {
    const rl = await rateLimiter.checkAsync(`auth:google-link:${request.ip || 'unknown'}`, 10, 60_000);
    if (!rl.allowed) return reply.status(429).send({ error: 'Too many attempts', message: 'Too many attempts. Please wait a minute and try again.' });
    const body = z.object({ token: z.string(), password: z.string().min(1) }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Validation error', message: 'Enter your Kovarti password.' });
    const key = linkKey(body.data.token);
    const pending = isToken(body.data.token) ? await pendingLink(key) : null;
    const user = pending ? await userService.findById(pending.userId) : null;
    if (!pending || !user) return reply.status(410).send(EXPIRED);
    if (!hasPassword(user)) return reply.status(400).send({ error: 'No password', message: NO_PASSWORD_MESSAGE });
    // A few tries per link, from any address, counted before the check (an atomic count, so tries
    // sent at the same moment can't all see "none yet"); then Google has to be started again
    const tries = await countTry(body.data.token);
    if (tries > MAX_PASSWORD_TRIES) {
      await redisService.del(key).catch(() => {});
      return reply.status(410).send(EXPIRED);
    }
    if (!(await bcrypt.compare(body.data.password, user.passwordHash))) {
      if (tries >= MAX_PASSWORD_TRIES) await redisService.del(key).catch(() => {});
      return reply.status(401).send({ error: 'Invalid password', message: "That password isn't right. Try again, or have a link emailed to you." });
    }
    await redisService.del(key).catch(() => {});
    const done = await completeLink(reply, pending);
    return 'refused' in done ? reply.status(403).send(NOT_ALLOWED) : done;
  });

  // Link by email instead (forgot the password): a one-time link to the account's own address
  fastify.post('/google/link-email', { schema: { description: 'Email a link to link Google to an existing account', tags: ['auth'] } }, async (request, reply) => {
    const rl = await rateLimiter.checkAsync(`auth:google-link-email:${request.ip || 'unknown'}`, 3, 15 * 60_000);
    if (!rl.allowed) return reply.status(429).send({ error: 'Too many attempts', message: 'Too many emails asked for. Please wait a few minutes.' });
    const body = z.object({ token: z.string() }).safeParse(request.body);
    const key = body.success && isToken(body.data.token) ? linkKey(body.data.token) : null;
    const pending = key ? await pendingLink(key) : null;
    const user = pending ? await userService.findById(pending.userId) : null;
    if (!key || !pending || !user) return reply.status(410).send(EXPIRED);
    try {
      const code = crypto.randomBytes(24).toString('hex');
      await redisService.set(emailLinkKey(code), JSON.stringify(pending), LINK_TTL_SECONDS);
      // The email opens a page with a button (a GET never links: mail scanners open links first)
      const url = `${config.APP_URL.replace(/\/$/, '')}/link-google?confirm=${code}`;
      await emailService.sendNotificationEmail(
        user.email, 'Link your Google account to Kovarti', 'Link your Google account',
        'Someone (hopefully you) asked to sign in to Kovarti with Google. Open this within 10 minutes and click "Link Google and sign in". If it wasn\'t you, ignore this email — nothing changes.',
        url, 'Link Google and sign in',
      );
      await redisService.del(key).catch(() => {});
      return { message: 'Check your email for a link (valid 10 minutes).' };
    } catch (err) {
      logger.error('Google link email failed', { userId: user.id, message: err instanceof Error ? err.message : String(err) });
      return reply.status(503).send({ error: 'Email not sent', message: "We couldn't send the email just now. Please try again in a few minutes, or use your password." });
    }
  });

  // The page the emailed link opens names the account before its button (so nobody is linked into
  // an account that isn't theirs by a link someone else sent them)
  fastify.post('/google/link-preview', { schema: { description: 'Which account an emailed Google link is for', tags: ['auth'] } }, async (request, reply) => {
    const rl = await rateLimiter.checkAsync(`auth:google-link:${request.ip || 'unknown'}`, 10, 60_000);
    if (!rl.allowed) return reply.status(429).send({ error: 'Too many attempts', message: 'Too many attempts. Please wait a minute and try again.' });
    const { code } = (request.body ?? {}) as { code?: unknown };
    const pending = isToken(code) ? await pendingLink(emailLinkKey(code)) : null;
    if (!pending) return reply.status(410).send({ error: 'Expired', message: 'This link has expired or was used already. Please click "Continue with Google" again.' });
    const user = await userService.findById(pending.userId);
    return { account: user?.email ?? pending.email, google: pending.email };
  });

  // The button on the page the emailed link opens: link (once) and sign in
  fastify.post('/google/link-confirm', { schema: { description: 'Finish linking Google from the emailed link', tags: ['auth'] } }, async (request, reply) => {
    const rl = await rateLimiter.checkAsync(`auth:google-link:${request.ip || 'unknown'}`, 10, 60_000);
    if (!rl.allowed) return reply.status(429).send({ error: 'Too many attempts', message: 'Too many attempts. Please wait a minute and try again.' });
    const { code } = (request.body ?? {}) as { code?: unknown };
    const client = redisService.getClient();
    const raw = isToken(code) && client ? await client.getdel(emailLinkKey(code)).catch(() => null) : null;
    let pending: PendingLink | null = null;
    try { pending = raw ? JSON.parse(raw) as PendingLink : null; } catch { /* treated as expired */ }
    if (!pending) return reply.status(410).send({ error: 'Expired', message: 'This link has expired or was used already. Please click "Continue with Google" again.' });
    const done = await completeLink(reply, pending);
    return 'refused' in done ? reply.status(403).send(NOT_ALLOWED) : done;
  });
}
