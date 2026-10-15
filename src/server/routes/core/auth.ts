import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { supportSessionService, SUPPORT_COOKIE } from '../../services/SupportSessionService';
import jwt from 'jsonwebtoken';
import { config } from '../../config';
import { authMiddleware } from '../../middleware/auth';
import { signedInOnly } from '../../middleware/requireScope';
import { guestExpired, GUEST_EXPIRED_MESSAGE } from '../../middleware/guestGuard';
import { permissionRole } from '../../utils/companyOwner';
import { userService } from '../../services/UserService';
import { emailService } from '../../services/EmailService';
import { stripeService } from '../../services/StripeService';
import { organizationService } from '../../services/OrganizationService';
import { databaseService } from '../../database/connection';
import { rateLimiter } from '../../middleware/rateLimiter';
import { verifyTurnstile, turnstileActive } from '../../utils/turnstile';
import { countRegistrationAttempt } from '../../utils/registrationWatch';
import { createAccount, provisionVerifiedTenant } from '../../services/accountSignup';
import logger from '../../utils/logger';
import { isTokenError, isDatabaseUnavailable, sendBusy, logBusy } from '../../utils/serviceBusy';
import type { JwtPayload } from '../../types/fastify';
import { startNewSession, setSessionCookies } from '../../utils/session';
import { hasPassword, NO_PASSWORD_MESSAGE } from '../../utils/googleOnlyAccount';

const loginSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(1),
});

const registerSchema = z.object({
  username: z.string().min(3).max(50).optional(),
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(2).max(100).optional(),
  organizationName: z.string().min(2).max(255).optional(),
  inviteToken: z.string().optional(),
  tier: z.enum(['consultant_basic', 'consultant_pro', 'sme', 'enterprise']).optional(),
  plan: z.enum(['monthly', 'annual']).optional(),
  seats: z.number().int().min(3).max(100).optional(),
  // Cloudflare Turnstile. Optional so a client built before this, or a server
  // with no key configured, still registers normally.
  turnstileToken: z.string().optional(),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/login', {
    schema: { description: 'User login', tags: ['auth'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Rate limit: 10 attempts per minute per IP
      const ip = request.ip || 'unknown';
      const rl = await rateLimiter.checkAsync(`auth:login:${ip}`, 10, 60_000);
      if (!rl.allowed) {
        return reply.status(429).send({ error: 'Too many login attempts. Please try again later.' });
      }

      const { username, password } = loginSchema.parse(request.body);

      // Allow login by username or email
      let user = await userService.findByUsername(username);
      if (!user && username.includes('@')) {
        user = await userService.findByEmail(username);
      }
      if (!user) {
        return reply.status(401).send({ error: 'Invalid credentials', message: 'Username or password is incorrect' });
      }

      if (!hasPassword(user)) {
        return reply.status(401).send({ error: 'No password', message: NO_PASSWORD_MESSAGE });
      }
      const isValidPassword = await bcrypt.compare(password, user.passwordHash);
      if (!isValidPassword) {
        return reply.status(401).send({ error: 'Invalid credentials', message: 'Username or password is incorrect' });
      }

      if (guestExpired(user)) {
        return reply.status(403).send({ error: 'Guest access expired', message: GUEST_EXPIRED_MESSAGE });
      }

      if (!user.emailVerified) {
        return reply.status(403).send({
          error: 'Email not verified',
          message: 'Please verify your email address before logging in. Check your inbox for the verification link.',
        });
      }

      // TODO: Re-enable per-login email verification (2FA-style) behind a config flag
      // Previously, non-admin users received a login verification email on every sign-in.
      // Disabled to simplify the flow; re-add as opt-in MFA later.

      const accessToken = await startNewSession(reply, user);

      // Same as /auth/me: the app needs to know straight away whether there's a company
      // (the platform admin has none — utils/platformAdmin.ts)
      let organization: { id: string; name: string; slug: string; isOwner?: boolean } | null = null;
      if (config.MULTI_TENANT_ENABLED) {
        const org = await organizationService.findByUserId(user.id);
        if (org) organization = { id: org.id, name: org.name, slug: org.slug, isOwner: org.ownerUserId === user.id };
      }

      return {
        token: accessToken,
        mustChangePassword: user.mustChangePassword || false,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          fullName: user.fullName,
          // what they may do (the company owner: a PMO's permissions); accountRole is their own role
          role: permissionRole(user.role, { isOwner: !!organization?.isOwner, isGuest: !!user.isGuest }),
          accountRole: user.role,
          subscriptionTier: user.role === 'admin' ? 'enterprise' : user.subscriptionTier,
          pendingTier: user.role === 'admin' ? null : (user.pendingTier ?? null),
          subscriptionStatus: user.role === 'admin' ? 'active' : user.subscriptionStatus,
          trialEndsAt: user.trialEndsAt ? (user.trialEndsAt instanceof Date ? user.trialEndsAt.toISOString() : String(user.trialEndsAt)) : null,
          isFounder: user.isFounder || false,
          // false = send them to the setup screens (App.tsx) — finishing setup decides, not having a name
          onboardingCompleted: !!user.onboardingCompletedAt,
          phone: user.phone ?? null,
          mustChangePassword: user.mustChangePassword || false,
          isGuest: user.isGuest || false,
          guestExpiresAt: user.guestExpiresAt ? String(user.guestExpiresAt) : null,
          organization,
        },
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', message: 'Username and password are required' });
      }
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Login error', { errorMessage: err.message, errorStack: err.stack });
      return reply.status(500).send({ error: 'Internal server error', message: 'Login failed' });
    }
  });

  fastify.post('/register', {
    schema: { description: 'User registration', tags: ['auth'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Registration is the one endpoint a stranger can call repeatedly with
      // effect, so it carries a burst limit AND an hourly one. Five a minute
      // alone allowed 300 an hour from a single address — enough to matter back
      // when each signup built a 12MB database, and still enough to damage our
      // sending reputation through bounced verification emails.
      const ip = request.ip || 'unknown';
      const burst = await rateLimiter.checkAsync(`auth:register:${ip}`, 5, 60_000);
      if (!burst.allowed) {
        // Was silent. A refused burst is the clearest early sign of a script,
        // and nothing recorded it at all.
        logger.warn('Registration burst limit hit', { ip });
        await countRegistrationAttempt(ip);
        return reply.status(429).send({ error: 'Too many registration attempts. Please try again later.' });
      }
      // Generous enough for an office behind one address; nowhere near enough
      // for a script.
      const hourly = await rateLimiter.checkAsync(`auth:register:hourly:${ip}`, 15, 60 * 60_000);
      if (!hourly.allowed) {
        logger.warn('Registration hourly limit hit', { ip });
        await countRegistrationAttempt(ip);
        return reply.status(429).send({ error: 'Too many registration attempts. Please try again later.' });
      }

      // Counted before anything else can reject it, so a flood is visible even
      // when every attempt is being turned away.
      await countRegistrationAttempt(ip);

      const parsed = registerSchema.parse(request.body);
      const { email, password, organizationName, inviteToken, tier, plan, seats } = parsed;

      // Prove there is a person here. Skipped entirely when no key is configured.
      const humanOk = await verifyTurnstile(parsed.turnstileToken, ip);
      if (!humanOk) {
        return reply.status(400).send({
          error: 'Verification failed',
          message: 'We could not confirm you are a person. Please reload the page and try again.',
        });
      }

      // One way to make an account, shared with "Sign up with Google" (services/accountSignup.ts)
      const passwordHash = await bcrypt.hash(password, 12);
      const created = await createAccount({
        email,
        fullName: parsed.fullName || '', // collected in onboarding if left out
        passwordHash,
        emailVerified: false,
        username: parsed.username,
        organizationName,
        inviteToken,
        tier,
        plan,
        seats,
      });
      if (!created.ok) {
        if (created.status === 503) reply.header('Retry-After', '5'); // busy: try again in a moment
        return reply.status(created.status).send({ error: created.error, message: created.message });
      }
      const { user, invitedTo, checkoutUrl, verificationToken } = created;

      // The verification email goes in every case (a paid sign-up can verify later)
      emailService.sendVerificationEmail(email, verificationToken!).catch((emailErr) => {
        logger.error('Failed to send verification email', { userId: user.id, email, error: emailErr });
      });

      // Paid plan: signed in straight away, then to the checkout
      if (checkoutUrl) {
        await startNewSession(reply, user);

        // Same owner flag and role as login and /auth/me, so the stored user never says
        // "not the owner" before /auth/me runs. Never fatal: the account and checkout exist already.
        let organization: { id: string; name: string; slug: string; isOwner?: boolean } | null = null;
        if (config.MULTI_TENANT_ENABLED) {
          const org = await organizationService.findByUserId(user.id).catch(() => null);
          if (org) organization = { id: org.id, name: org.name, slug: org.slug, isOwner: org.ownerUserId === user.id };
        }

        return reply.status(201).send({
          checkoutUrl,
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            fullName: user.fullName,
            role: permissionRole(user.role, { isOwner: !!organization?.isOwner, isGuest: !!user.isGuest }),
            accountRole: user.role,
            emailVerified: false,
            // Awaiting payment — not a trial, and not a free-tier customer.
            subscriptionTier: 'trial',
            pendingTier: tier,
            subscriptionStatus: 'incomplete',
            organization,
          },
        });
      }

      return reply.status(201).send({
        message: invitedTo
          ? `Registration successful. You've been added to ${invitedTo}. Please check your email to verify your account.`
          : 'Registration successful. Please check your email to verify your account.',
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', message: error.issues.map((e: z.ZodIssue) => e.message).join(', ') });
      }
      logger.error('Registration error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Registration failed' });
    }
  });

  fastify.get('/verify-email', {
    schema: { description: 'Verify email address', tags: ['auth'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Rate limit: 10 verifications per minute per IP
      const ip = request.ip || 'unknown';
      const rl = await rateLimiter.checkAsync(`auth:verify:${ip}`, 10, 60_000);
      if (!rl.allowed) {
        return reply.status(429).send({ error: 'Too many verification attempts. Please try again later.' });
      }

      const { token } = request.query as { token?: string };
      if (!token) {
        return reply.status(400).send({ error: 'Missing token', message: 'Verification token is required' });
      }

      const user = await userService.findByVerificationToken(token);
      if (!user) {
        return reply.status(400).send({ error: 'Invalid token', message: 'Verification token is invalid or expired' });
      }

      await userService.update(user.id, {
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null,
      });

      // Now that the address is real, give them somewhere to work. Awaited so the
      // welcome email cannot arrive before the account is usable.
      const org = await organizationService.findByUserId(user.id).catch(() => null);
      if (org) await provisionVerifiedTenant(org.id, org.dbName, user.id);

      // Fire-and-forget. The account IS verified and the tenant IS built by this
      // point; telling someone "verification failed" because a welcome email
      // bounced would send them away from a working account.
      emailService.sendWelcomeEmail(user.email, user.fullName).catch((err) => {
        logger.warn('Welcome email failed after verification', {
          userId: user.id, message: err instanceof Error ? err.message : String(err),
        });
      });

      return { message: 'Email verified successfully. You can now log in.' };
    } catch (error) {
      logger.error('Email verification error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Email verification failed' });
    }
  });

  // Verify login — clicked from email link
  fastify.get('/verify-login', {
    schema: { description: 'Verify login via email link', tags: ['auth'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Rate limit: 10/min per IP
      const ip = request.ip || 'unknown';
      const rl = await rateLimiter.checkAsync(`auth:verify-login:${ip}`, 10, 60_000);
      if (!rl.allowed) {
        return reply.redirect('/login?error=rate_limited');
      }

      const { token } = request.query as { token?: string };
      if (!token) {
        return reply.redirect('/login?error=invalid_login_token');
      }

      const user = await userService.findByLoginVerificationToken(token);
      if (!user) {
        return reply.redirect('/login?error=invalid_login_token');
      }

      // A new session (every prior one ends); the one-time link is used up in the same write
      await startNewSession(reply, user, { loginVerificationToken: null, loginVerificationExpires: null });

      return reply.redirect('/');
    } catch (error) {
      logger.error('Login verification error', { error });
      return reply.redirect('/login?error=invalid_login_token');
    }
  });

  // GET /me — hydrate auth store from cookies (used after verify-login redirect and page refresh)
  fastify.get('/me', {
    preHandler: [authMiddleware],
    schema: { description: 'Get current authenticated user', tags: ['auth'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user?.userId;
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

      const user = await userService.findById(userId);
      if (!user) return reply.status(401).send({ error: 'User not found' });

      let organization: { id: string; name: string; slug: string; isOwner?: boolean } | null = null;
      if (config.MULTI_TENANT_ENABLED) {
        const org = await organizationService.findByUserId(user.id);
        if (org) {
          organization = { id: org.id, name: org.name, slug: org.slug, isOwner: org.ownerUserId === user.id };
        }
      }

      // Support view: while the admin's read-only visit is active, the app shows the visited
      // company as a read-only executive would see it, with the support banner
      let supportSession: { organizationName: string; reason: string; expiresAt: string } | null = null;
      // what they may do (the company owner: a PMO's permissions); accountRole is their own role
      let effectiveRole: string = permissionRole(user.role, { isOwner: !!organization?.isOwner, isGuest: !!user.isGuest });
      if (user.role === 'admin') {
        const visit = await supportSessionService.findActive(request.cookies?.[SUPPORT_COOKIE], user.id);
        if (visit) {
          supportSession = { organizationName: visit.organizationName, reason: visit.reason, expiresAt: visit.expiresAt };
          organization = { id: visit.organizationId, name: visit.organizationName, slug: visit.organizationSlug };
          effectiveRole = 'executive';
        }
      }

      return {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          fullName: user.fullName,
          role: effectiveRole,
          accountRole: user.role,
          subscriptionTier: user.role === 'admin' ? 'enterprise' : user.subscriptionTier,
          pendingTier: user.role === 'admin' ? null : (user.pendingTier ?? null),
          subscriptionStatus: user.role === 'admin' ? 'active' : user.subscriptionStatus,
          trialEndsAt: user.trialEndsAt ? (user.trialEndsAt instanceof Date ? user.trialEndsAt.toISOString() : String(user.trialEndsAt)) : null,
          isFounder: user.isFounder || false,
          // false = send them to the setup screens (App.tsx) — finishing setup decides, not having a name
          onboardingCompleted: !!user.onboardingCompletedAt,
          phone: user.phone ?? null,
          emailVerified: user.emailVerified || false,
          mustChangePassword: user.mustChangePassword || false,
          isGuest: user.isGuest || false,
          guestExpiresAt: user.guestExpiresAt ? String(user.guestExpiresAt) : null,
          organization,
          supportSession,
        },
      };
    } catch (error) {
      if (isDatabaseUnavailable(error)) { // busy, not broken: the app keeps them signed in
        logBusy('Auth /me', error, request.url);
        return sendBusy(reply);
      }
      logger.error('Auth /me error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Resend verification email — strict rate limit to prevent email spam
  // GET /turnstile — the public site key, or empty when the CAPTCHA is off.
  //
  // Served rather than built in, so that turning the CAPTCHA on is a single
  // change on the server. It also keeps the two halves honest: the widget only
  // appears when a key exists, and the server only checks when one exists, so
  // there is no window where the page sends no token and the server demands one.
  fastify.get('/turnstile', {
    schema: { description: 'Public CAPTCHA site key', tags: ['auth'] },
  }, async () => ({ siteKey: turnstileActive() ? (config.TURNSTILE_SITE_KEY || '') : '' }));

  fastify.post('/resend-verification', {
    schema: { description: 'Resend verification email', tags: ['auth'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const ip = request.ip || 'unknown';
      // Strict rate limit: 3 resends per 15 minutes per IP
      const rl = await rateLimiter.checkAsync(`auth:resend:${ip}`, 3, 15 * 60_000);
      if (!rl.allowed) {
        return reply.status(429).send({ error: 'Too many resend attempts. Please try again later.' });
      }

      const { email } = forgotPasswordSchema.parse(request.body); // reuse: { email: z.string().email() }

      // Always return 200 to prevent email enumeration
      const user = await userService.findByEmail(email);
      if (user && !user.emailVerified) {
        // Per-email rate limit: 1 resend per 5 minutes per email address
        const emailRl = await rateLimiter.checkAsync(`auth:resend:email:${email}`, 1, 5 * 60_000);
        if (emailRl.allowed) {
          const verificationToken = crypto.randomUUID();
          const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

          await userService.update(user.id, {
            emailVerificationToken: verificationToken,
            emailVerificationExpires: verificationExpires,
          });

          // A refused address must not become a 500. This endpoint answers the
          // same way whether or not the account exists, on purpose — reporting
          // the mail provider's complaint would reveal which addresses are
          // registered. So log it and answer as usual.
          try {
            await emailService.sendVerificationEmail(email, verificationToken);
          } catch (sendError: any) {
            logger.warn('Resend verification: the mail provider refused the address', {
              message: sendError?.message,
            });
          }
        }
      }

      return { message: 'If an unverified account with that email exists, a new verification link has been sent.' };
    } catch (error: any) {
      // Bad input is the caller's mistake: the app's error handler answers 400 with the field
      if (error instanceof z.ZodError) throw error;
      logger.error('Resend verification error', { message: error?.message, stack: error?.stack });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to resend verification email' });
    }
  });

  fastify.post('/forgot-password', {
    schema: { description: 'Request password reset', tags: ['auth'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Rate limit: 5 requests per minute per IP
      const ip = request.ip || 'unknown';
      const rl = await rateLimiter.checkAsync(`auth:forgot:${ip}`, 5, 60_000);
      if (!rl.allowed) {
        return reply.status(429).send({ error: 'Too many password reset requests. Please try again later.' });
      }

      const { email } = forgotPasswordSchema.parse(request.body);

      // Always return 200 to prevent email enumeration
      const user = await userService.findByEmail(email);
      if (user) {
        const resetToken = crypto.randomUUID();
        const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        await userService.update(user.id, {
          passwordResetToken: resetToken,
          passwordResetExpires: resetExpires,
        });

        await emailService.sendPasswordResetEmail(email, resetToken);
      }

      return { message: 'If an account with that email exists, a password reset link has been sent.' };
    } catch (error) {
      // Bad input is the caller's mistake: the app's error handler answers 400 with the field
      if (error instanceof z.ZodError) throw error;
      logger.error('Forgot password error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Password reset request failed' });
    }
  });

  fastify.post('/reset-password', {
    schema: { description: 'Reset password with token', tags: ['auth'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Rate limit: 5 requests per minute per IP
      const ip = request.ip || 'unknown';
      const rl = await rateLimiter.checkAsync(`auth:reset:${ip}`, 5, 60_000);
      if (!rl.allowed) {
        return reply.status(429).send({ error: 'Too many password reset attempts. Please try again later.' });
      }

      const { token, password } = resetPasswordSchema.parse(request.body);

      const user = await userService.findByResetToken(token);
      if (!user) {
        return reply.status(400).send({ error: 'Invalid token', message: 'Reset token is invalid or expired' });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      await userService.update(user.id, {
        passwordHash,
        passwordResetToken: null,
        passwordResetExpires: null,
        tokenVersion: (user.tokenVersion ?? 0) + 1,
        // Clicking a reset link from email proves ownership — auto-verify
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null,
      });

      return { message: 'Password reset successful. You can now log in with your new password.' };
    } catch (error) {
      // Bad input is the caller's mistake: the app's error handler answers 400 with the field
      if (error instanceof z.ZodError) throw error;
      logger.error('Reset password error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Password reset failed' });
    }
  });

  fastify.post('/logout', {
    schema: { description: 'User logout', tags: ['auth'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // Signing out ends any support visit too
    if (request.user?.role === 'admin' && request.cookies?.[SUPPORT_COOKIE]) {
      await supportSessionService.end(request.cookies[SUPPORT_COOKIE], request.user.userId).catch(() => {});
    }
    reply.clearCookie(SUPPORT_COOKIE, { path: '/' });
    reply.clearCookie('access_token');
    reply.clearCookie('refresh_token');
    return { message: 'Logout successful' };
  });

  fastify.post('/refresh', {
    schema: { description: 'Refresh access token', tags: ['auth'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const refreshToken = request.cookies.refresh_token;
      if (!refreshToken) {
        return reply.status(401).send({ error: 'No refresh token', message: 'Refresh token is required' });
      }

      const decoded = jwt.verify(refreshToken, config.JWT_REFRESH_SECRET, { algorithms: ['HS256'] }) as JwtPayload;
      if (decoded.type !== 'refresh') {
        return reply.status(401).send({ error: 'Invalid token type', message: 'Token is not a refresh token' });
      }

      const user = await userService.findById(decoded.userId);
      if (!user) {
        return reply.status(401).send({ error: 'User not found', message: 'User associated with token not found' });
      }
      if (guestExpired(user)) {
        reply.clearCookie('access_token', { path: '/' });
        reply.clearCookie('refresh_token', { path: '/' });
        return reply.status(401).send({ error: 'Guest access expired', message: GUEST_EXPIRED_MESSAGE });
      }

      // Check token version — reject if password was changed or sessions were invalidated
      const currentVersion = user.tokenVersion ?? 0;
      if (decoded.tv !== undefined && decoded.tv !== currentVersion) {
        reply.clearCookie('access_token', { path: '/' });
        reply.clearCookie('refresh_token', { path: '/' });
        return reply.status(401).send({ error: 'Session expired', message: 'Your session has been invalidated. Please log in again.' });
      }

      // New access token, rotated refresh token, same session version
      setSessionCookies(reply, user, currentVersion);

      return { message: 'Token refreshed successfully' };
    } catch (error) {
      // Only a bad or expired refresh token ends the session; a busy database must not
      if (!isTokenError(error)) {
        logBusy('Token refresh failed', error, request.url);
        return sendBusy(reply);
      }
      logger.error('Token refresh error', { error });
      return reply.status(401).send({ error: 'Invalid refresh token', message: 'Refresh token is invalid or expired' });
    }
  });

  // POST /change-password — change password (authenticated)
  const changePasswordSchema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8, 'New password must be at least 8 characters'),
  });

  fastify.post('/change-password', {
    preHandler: [authMiddleware, signedInOnly],
    schema: { description: 'Change password', tags: ['auth'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { currentPassword, newPassword } = changePasswordSchema.parse(request.body);
      const userId = request.user?.userId;
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

      const user = await userService.findById(userId);
      if (!user) return reply.status(404).send({ error: 'User not found' });

      if (!hasPassword(user)) return reply.status(400).send({ error: 'No password', message: NO_PASSWORD_MESSAGE });
      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) return reply.status(400).send({ error: 'Invalid password', message: 'Current password is incorrect' });

      const hash = await bcrypt.hash(newPassword, 12);
      const newVersion = (user.tokenVersion ?? 0) + 1;
      await userService.update(userId, { passwordHash: hash, tokenVersion: newVersion, mustChangePassword: false });

      // Fresh tokens with the new version, so this session stays alive (all others end)
      setSessionCookies(reply, user, newVersion);

      return { message: 'Password changed successfully' };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', message: error.issues.map((e: z.ZodIssue) => e.message).join(', ') });
      }
      logger.error('Change password error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to change password' });
    }
  });

  // DELETE /delete-account — permanently delete own account
  fastify.delete('/delete-account', {
    preHandler: [authMiddleware, signedInOnly],
    schema: { description: 'Delete own account', tags: ['auth'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user?.userId;
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

      const user = await userService.findById(userId);
      if (!user) return reply.status(404).send({ error: 'User not found' });

      // Cancel Stripe subscription if active
      if (user.stripeCustomerId) {
        try {
          await stripeService.cancelAllSubscriptions(user.stripeCustomerId);
        } catch (stripeErr) {
          logger.warn('Failed to cancel Stripe subscriptions during account deletion', { userId, error: stripeErr });
        }
      }

      // Log email to prevent trial abuse on re-registration
      await databaseService.query(
        'INSERT INTO deleted_emails (email) VALUES (?)',
        [user.email.toLowerCase()]
      );

      // Delete user (cascades to most related data via FK constraints)
      await userService.delete(userId);

      // Clear auth cookies
      reply.clearCookie('access_token', { path: '/' });
      reply.clearCookie('refresh_token', { path: '/' });

      logger.info('Account deleted', { userId, username: user.username });
      return { message: 'Account deleted successfully' };
    } catch (error) {
      logger.error('Account deletion error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to delete account' });
    }
  });
}
