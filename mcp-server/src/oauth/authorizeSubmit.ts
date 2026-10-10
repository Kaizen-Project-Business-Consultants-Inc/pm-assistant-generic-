import type { Request, Response } from 'express';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { RowDataPacket } from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { query } from '../db.js';
import { renderAuthorizePage } from './authorizePage.js';

/**
 * POST /authorize/submit — the sign-in page Claude opens to connect to Kovarti.
 *
 * Held to the same bar as the app's own login (2026-10-09 audit M3). Before this it minted a code
 * for any client_id / redirect_uri, had no attempt limit, and let in people who must change their
 * password or haven't verified their email. Now:
 *   - the client must be registered and the redirect_uri one it registered — checked BEFORE the
 *     password, so the page can never be used to send a code to someone else's address;
 *   - 10 tries a minute per address, and 5 wrong passwords for one name lock it for 15 minutes;
 *   - the same refusals as the app: email not verified, guest access ended, must change password.
 */

const IP_LIMIT = 10;
const IP_WINDOW_MS = 60_000;
const NAME_FAIL_LIMIT = 5;
const NAME_LOCK_MS = 15 * 60_000;
const MAX_TRACKED = 10_000;

const ipHits = new Map<string, { count: number; resetAt: number }>();
const nameFails = new Map<string, { count: number; resetAt: number }>();

function bump(map: Map<string, { count: number; resetAt: number }>, key: string, windowMs: number, now: number): number {
  const cur = map.get(key);
  if (!cur || cur.resetAt <= now) {
    if (map.size >= MAX_TRACKED) map.clear(); // bounded memory: an attack can't grow it forever
    map.set(key, { count: 1, resetAt: now + windowMs });
    return 1;
  }
  cur.count++;
  return cur.count;
}

function isLocked(name: string, now: number): boolean {
  const cur = nameFails.get(name);
  return !!cur && cur.resetAt > now && cur.count >= NAME_FAIL_LIMIT;
}

/** Test hook */
interface UserRow extends RowDataPacket {
  id: string;
  password_hash: string;
  email_verified: number;
  must_change_password: number;
  is_guest: number;
  guest_expires_at: string | Date | null;
}

const WRONG = 'Invalid username or password.';

export async function handleAuthorizeSubmit(req: Request, res: Response, clients: OAuthRegisteredClientsStore): Promise<void> {
  try {
    const { username, password, client_id, redirect_uri, code_challenge, state, scope } = req.body ?? {};
    if (!username || !password || !client_id || !redirect_uri || !code_challenge
      || typeof username !== 'string' || typeof password !== 'string' || typeof client_id !== 'string' || typeof redirect_uri !== 'string') {
      res.status(400).type('html').send('<h1>Missing required fields</h1>');
      return;
    }

    // The client and its address first: never redirect anywhere Claude didn't register
    const client = await clients.getClient(client_id);
    const registered = (client?.redirect_uris ?? []).map(String);
    if (!client || !registered.includes(redirect_uri)) {
      res.status(400).type('html').send('<h1>Unknown application or redirect address</h1>');
      return;
    }

    const page = (error: string) => renderAuthorizePage({
      clientId: client_id, clientName: client.client_name, redirectUri: redirect_uri, state, codeChallenge: code_challenge, scope, error,
    });

    const now = Date.now();
    // one form of the name for the lock AND the look-up, so "Ann@Co.com " can't dodge the lock
    // (names and emails compare without regard to case in the database)
    const name = username.trim().toLowerCase();
    if (bump(ipHits, req.ip || 'unknown', IP_WINDOW_MS, now) > IP_LIMIT || isLocked(name, now)) {
      res.status(429).type('html').send(page('Too many sign-in attempts. Please wait a few minutes and try again.'));
      return;
    }

    const users = await query<UserRow>(
      `SELECT id, password_hash, email_verified, must_change_password, is_guest, guest_expires_at
         FROM users WHERE (username = ? OR email = ?) AND is_active = 1 LIMIT 1`,
      [name, name],
    );
    const user = users[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      bump(nameFails, name, NAME_LOCK_MS, now);
      res.status(401).type('html').send(page(WRONG));
      return;
    }
    nameFails.delete(name);

    const refusal = !Number(user.email_verified)
      ? 'Please verify your email address first — check your inbox for the link from Kovarti.'
      : Number(user.is_guest) && user.guest_expires_at && new Date(user.guest_expires_at) < new Date()
        ? 'Your guest access has ended.'
        : Number(user.must_change_password)
          ? 'Sign in to Kovarti and change your password first, then connect Claude again.'
          : null;
    if (refusal) {
      res.status(403).type('html').send(page(refusal));
      return;
    }

    const code = randomUUID();
    await query(
      `INSERT INTO oauth_auth_codes (code, client_id, user_id, redirect_uri, code_challenge, scope, state, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))`,
      [code, client_id, user.id, redirect_uri, code_challenge, scope || null, state || null],
    );

    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set('code', code);
    if (state) redirectUrl.searchParams.set('state', state);
    res.redirect(302, redirectUrl.toString());
  } catch (err) {
    console.error('[OAuth] /authorize/submit error:', (err as Error)?.message);
    res.status(500).type('html').send('<h1>Internal server error</h1>');
  }
}
