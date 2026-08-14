import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../../config';
import { authMiddleware } from '../../middleware/auth';
import { userService } from '../../services/UserService';
import { emailService } from '../../services/EmailService';
import { stripeService } from '../../services/StripeService';
import { organizationService } from '../../services/OrganizationService';
import { provisionTenantDatabase } from '../../database/tenantProvisioner';
import { inviteService } from '../../services/InviteService';
import { databaseService } from '../../database/connection';
import { rateLimiter } from '../../middleware/rateLimiter';
import { resolvePriceId } from '../integrations/stripe';
import logger from '../../utils/logger';
import type { JwtPayload } from '../../types/fastify';

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
  tier: z.enum(['consultant', 'sme', 'enterprise']).optional(),
  plan: z.enum(['monthly', 'annual']).optional(),
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

      const isValidPassword = await bcrypt.compare(password, user.passwordHash);
      if (!isValidPassword) {
        return reply.status(401).send({ error: 'Invalid credentials', message: 'Username or password is incorrect' });
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

      const newVersion = (user.tokenVersion ?? 0) + 1;
      await userService.update(user.id, {
        tokenVersion: newVersion,
        lastLoginAt: new Date(),
      });

      const accessToken = jwt.sign(
        { userId: user.id, username: user.username, role: user.role, tv: newVersion },
        config.JWT_SECRET,
        { expiresIn: '15m', algorithm: 'HS256' }
      );
      const refreshToken = jwt.sign(
        { userId: user.id, type: 'refresh', tv: newVersion },
        config.JWT_REFRESH_SECRET,
        { expiresIn: '24h', algorithm: 'HS256' }
      );

      reply.setCookie('access_token', accessToken, {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 15 * 60,
      });
      reply.setCookie('refresh_token', refreshToken, {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 24 * 60 * 60,
      });

      return {
        token: accessToken,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          subscriptionTier: user.role === 'admin' ? 'enterprise' : user.subscriptionTier,
          subscriptionStatus: user.role === 'admin' ? 'active' : user.subscriptionStatus,
          trialEndsAt: user.trialEndsAt ? (user.trialEndsAt instanceof Date ? user.trialEndsAt.toISOString() : String(user.trialEndsAt)) : null,
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
      // Rate limit: 5 registrations per minute per IP
      const ip = request.ip || 'unknown';
      const rl = await rateLimiter.checkAsync(`auth:register:${ip}`, 5, 60_000);
      if (!rl.allowed) {
        return reply.status(429).send({ error: 'Too many registration attempts. Please try again later.' });
      }

      const parsed = registerSchema.parse(request.body);
      const { email, password, organizationName, inviteToken, tier, plan } = parsed;

      // Auto-generate username if not provided (plan signup flow)
      const username = parsed.username || email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '') + '_' + crypto.randomBytes(3).toString('hex');
      // Use empty string for fullName if not provided (will be collected in onboarding)
      const fullName = parsed.fullName || '';

      // Validate invite token if provided
      let inviteData: { valid: boolean; email?: string; orgName?: string; projectId?: string | null } | null = null;
      if (inviteToken) {
        inviteData = await inviteService.validateToken(inviteToken);
        if (!inviteData.valid) {
          return reply.status(400).send({ error: 'Invalid invite', message: 'This invitation link is invalid or has expired.' });
        }
      }

      const existingUsername = await userService.findByUsername(username);
      if (existingUsername) {
        return reply.status(409).send({ error: 'User already exists', message: 'Username is already taken' });
      }

      const existingEmail = await userService.findByEmail(email);
      if (existingEmail) {
        return reply.status(409).send({ error: 'Email already exists', message: 'An account with this email already exists' });
      }

      // Check if this email was previously deleted (trial abuse prevention)
      const [previousAccount] = await databaseService.query<{ email: string }>(
        'SELECT email FROM deleted_emails WHERE email = ? LIMIT 1',
        [email.toLowerCase()]
      );
      const hadPreviousAccount = !!previousAccount;

      const verificationToken = crypto.randomUUID();
      const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      const passwordHash = await bcrypt.hash(password, 12);

      const isInvitedViewer = inviteData?.valid;
      const isPlanSignup = !!tier && !isInvitedViewer;

      // Create Stripe customer (if configured) — skip for invited viewers
      const stripeCustomerId = isInvitedViewer ? null : await stripeService.createCustomer(email, fullName || email, 'pending');

      // For plan signup, auto-verify email (they'll verify via Stripe payment)
      const user = await userService.create({
        username,
        email,
        passwordHash,
        fullName,
        role: isInvitedViewer ? 'viewer' : 'project_manager',
        emailVerified: isPlanSignup ? true : false,
        emailVerificationToken: isPlanSignup ? undefined : verificationToken,
        emailVerificationExpires: isPlanSignup ? undefined : verificationExpires,
        stripeCustomerId: stripeCustomerId || undefined,
      });

      if (isInvitedViewer) {
        // Viewer: no trial, no subscription, accept the invite
        await userService.update(user.id, {
          subscriptionStatus: 'none',
        });

        try {
          await inviteService.acceptInvite(inviteToken!, user.id);
        } catch (inviteErr) {
          logger.error('Failed to accept invite during registration', { userId: user.id, error: inviteErr });
        }
      } else if (hadPreviousAccount) {
        // Returning user: no free trial — must pick a paid plan
        await userService.update(user.id, {
          subscriptionStatus: 'none',
        });
      } else {
        // New user: start 14-day trial
        const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        await userService.update(user.id, {
          subscriptionStatus: 'trialing',
          trialEndsAt,
        });

        // Multi-tenant: create organization and provision tenant database
        if (config.MULTI_TENANT_ENABLED) {
          const orgName = organizationName || fullName || email.split('@')[0];
          try {
            const org = await organizationService.createOrganization(orgName, user.id, stripeCustomerId || undefined);
            await userService.update(user.id, { organizationId: org.id } as any);
            // Provision tenant DB in background — don't block registration
            provisionTenantDatabase(org.id).catch((err) => {
              logger.error('Tenant provisioning failed', { orgId: org.id, error: err });
            });
          } catch (orgError) {
            logger.error('Organization creation failed during registration', { userId: user.id, error: orgError });
          }
        }
      }

      // Plan signup flow: auto-login + create Stripe checkout session + return URL
      if (isPlanSignup && stripeCustomerId) {
        const billing = plan || 'monthly';
        const priceId = resolvePriceId(tier, billing);
        if (!priceId) {
          return reply.status(500).send({ error: 'Stripe not configured', message: 'Pricing is not configured for this tier' });
        }

        const checkoutUrl = await stripeService.createCheckoutSession(stripeCustomerId, priceId, user.id, '/onboarding');

        // Auto-login: issue JWT cookies
        const newVersion = (user.tokenVersion ?? 0) + 1;
        await userService.update(user.id, { tokenVersion: newVersion, lastLoginAt: new Date() });

        const accessToken = jwt.sign(
          { userId: user.id, username: user.username, role: user.role, tv: newVersion },
          config.JWT_SECRET,
          { expiresIn: '15m', algorithm: 'HS256' }
        );
        const refreshToken = jwt.sign(
          { userId: user.id, type: 'refresh', tv: newVersion },
          config.JWT_REFRESH_SECRET,
          { expiresIn: '24h', algorithm: 'HS256' }
        );

        reply.setCookie('access_token', accessToken, {
          httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 15 * 60,
        });
        reply.setCookie('refresh_token', refreshToken, {
          httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 24 * 60 * 60,
        });

        // Send verification email even for plan signup (they can verify later)
        emailService.sendVerificationEmail(email, verificationToken).catch((emailErr) => {
          logger.error('Failed to send verification email', { userId: user.id, email, error: emailErr });
        });

        return reply.status(201).send({
          checkoutUrl,
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            fullName: user.fullName,
            role: user.role,
            subscriptionTier: 'trial',
            subscriptionStatus: 'trialing',
          },
        });
      }

      // Traditional flow: send verification email, no auto-login
      emailService.sendVerificationEmail(email, verificationToken).catch((emailErr) => {
        logger.error('Failed to send verification email', { userId: user.id, email, error: emailErr });
      });

      return reply.status(201).send({
        message: isInvitedViewer
          ? `Registration successful. You've been added to ${inviteData!.orgName}. Please check your email to verify your account.`
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

      // Send welcome email
      await emailService.sendWelcomeEmail(user.email, user.fullName);

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

      // Increment tokenVersion to invalidate all prior sessions
      const newVersion = (user.tokenVersion ?? 0) + 1;
      await userService.update(user.id, {
        tokenVersion: newVersion,
        loginVerificationToken: null,
        loginVerificationExpires: null,
        lastLoginAt: new Date(),
      });

      // Issue JWT cookies
      const accessToken = jwt.sign(
        { userId: user.id, username: user.username, role: user.role, tv: newVersion },
        config.JWT_SECRET,
        { expiresIn: '15m', algorithm: 'HS256' }
      );

      const refreshToken = jwt.sign(
        { userId: user.id, type: 'refresh', tv: newVersion },
        config.JWT_REFRESH_SECRET,
        { expiresIn: '24h', algorithm: 'HS256' }
      );

      reply.setCookie('access_token', accessToken, {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 15 * 60,
      });

      reply.setCookie('refresh_token', refreshToken, {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 24 * 60 * 60,
      });

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

      let organization: { id: string; name: string; slug: string } | null = null;
      if (config.MULTI_TENANT_ENABLED) {
        const org = await organizationService.findByUserId(user.id);
        if (org) {
          organization = { id: org.id, name: org.name, slug: org.slug };
        }
      }

      return {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          subscriptionTier: user.role === 'admin' ? 'enterprise' : user.subscriptionTier,
          subscriptionStatus: user.role === 'admin' ? 'active' : user.subscriptionStatus,
          trialEndsAt: user.trialEndsAt ? (user.trialEndsAt instanceof Date ? user.trialEndsAt.toISOString() : String(user.trialEndsAt)) : null,
          organization,
        },
      };
    } catch (error) {
      logger.error('Auth /me error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Resend verification email — strict rate limit to prevent email spam
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

          await emailService.sendVerificationEmail(email, verificationToken);
        }
      }

      return { message: 'If an unverified account with that email exists, a new verification link has been sent.' };
    } catch (error) {
      logger.error('Resend verification error', { error });
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
      });

      return { message: 'Password reset successful. You can now log in with your new password.' };
    } catch (error) {
      logger.error('Reset password error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Password reset failed' });
    }
  });

  fastify.post('/logout', {
    schema: { description: 'User logout', tags: ['auth'] },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
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

      // Check token version — reject if password was changed or sessions were invalidated
      const currentVersion = user.tokenVersion ?? 0;
      if (decoded.tv !== undefined && decoded.tv !== currentVersion) {
        reply.clearCookie('access_token', { path: '/' });
        reply.clearCookie('refresh_token', { path: '/' });
        return reply.status(401).send({ error: 'Session expired', message: 'Your session has been invalidated. Please log in again.' });
      }

      const accessToken = jwt.sign(
        { userId: user.id, username: user.username, role: user.role, tv: currentVersion },
        config.JWT_SECRET,
        { expiresIn: '15m', algorithm: 'HS256' }
      );

      // Rotate refresh token
      const newRefreshToken = jwt.sign(
        { userId: user.id, type: 'refresh', tv: currentVersion },
        config.JWT_REFRESH_SECRET,
        { expiresIn: '24h', algorithm: 'HS256' }
      );

      reply.setCookie('access_token', accessToken, {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 15 * 60,
      });

      reply.setCookie('refresh_token', newRefreshToken, {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 24 * 60 * 60,
      });

      return { message: 'Token refreshed successfully' };
    } catch (error) {
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
    preHandler: [authMiddleware],
    schema: { description: 'Change password', tags: ['auth'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { currentPassword, newPassword } = changePasswordSchema.parse(request.body);
      const userId = request.user?.userId;
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

      const user = await userService.findById(userId);
      if (!user) return reply.status(404).send({ error: 'User not found' });

      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) return reply.status(400).send({ error: 'Invalid password', message: 'Current password is incorrect' });

      const hash = await bcrypt.hash(newPassword, 12);
      const newVersion = (user.tokenVersion ?? 0) + 1;
      await userService.update(userId, { passwordHash: hash, tokenVersion: newVersion });

      // Issue fresh tokens with new version so current session stays alive
      const accessToken = jwt.sign(
        { userId: user.id, username: user.username, role: user.role, tv: newVersion },
        config.JWT_SECRET,
        { expiresIn: '15m', algorithm: 'HS256' }
      );
      const refreshToken = jwt.sign(
        { userId: user.id, type: 'refresh', tv: newVersion },
        config.JWT_REFRESH_SECRET,
        { expiresIn: '24h', algorithm: 'HS256' }
      );
      reply.setCookie('access_token', accessToken, {
        httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 15 * 60,
      });
      reply.setCookie('refresh_token', refreshToken, {
        httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 24 * 60 * 60,
      });

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
    preHandler: [authMiddleware],
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
