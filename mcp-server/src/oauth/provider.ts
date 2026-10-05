import type { Response } from 'express';
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { OAuthClientInformationFull, OAuthTokens, OAuthTokenRevocationRequest } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { RowDataPacket } from 'mysql2/promise';
import crypto from 'node:crypto';
import { query } from '../db.js';
import { DatabaseClientsStore } from './clientsStore.js';
import { renderAuthorizePage } from './authorizePage.js';
import { scopesForUser } from './roleScopes.js';

interface AuthCodeRow extends RowDataPacket {
  code: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string | null;
  state: string | null;
  consumed: number;
}

interface TokenRow extends RowDataPacket {
  id: string;
  client_id: string;
  user_id: string;
  api_key_id: string;
  access_token_hash: string;
  refresh_token: string | null;
  refresh_token_expires_at: string | null;
  scope: string | null;
  revoked: number;
}

interface ApiKeyRow extends RowDataPacket {
  id: string;
  user_id: string;
  key_hash: string;
  key_prefix: string;
  scopes: string;
  rate_limit: number | null;
  is_active: number;
  expires_at: string | null;
}

export class PmOAuthProvider implements OAuthServerProvider {
  private _clientsStore = new DatabaseClientsStore();

  get clientsStore(): OAuthRegisteredClientsStore {
    return this._clientsStore;
  }

  /**
   * Renders the login form page. The SDK calls this when the user hits /authorize.
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const html = renderAuthorizePage({
      clientId: client.client_id,
      clientName: client.client_name,
      redirectUri: params.redirectUri,
      state: params.state,
      codeChallenge: params.codeChallenge,
      scope: params.scopes?.join(' '),
    });
    res.status(200).type('html').send(html);
  }

  /**
   * Returns the PKCE code_challenge stored when the auth code was created.
   */
  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const rows = await query<AuthCodeRow>(
      `SELECT * FROM oauth_auth_codes
       WHERE code = ? AND client_id = ? AND consumed = 0 AND expires_at > NOW()`,
      [authorizationCode, client.client_id],
    );
    if (rows.length === 0) {
      throw new Error('Invalid or expired authorization code');
    }
    return rows[0].code_challenge;
  }

  /**
   * Exchanges an authorization code for tokens.
   * Creates a PM API key and returns the raw key as the access_token.
   */
  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<OAuthTokens> {
    // Fetch and consume the auth code
    const rows = await query<AuthCodeRow>(
      `SELECT * FROM oauth_auth_codes
       WHERE code = ? AND client_id = ? AND consumed = 0 AND expires_at > NOW()`,
      [authorizationCode, client.client_id],
    );
    if (rows.length === 0) {
      throw new Error('Invalid or expired authorization code');
    }
    const authCode = rows[0];

    // Mark as consumed
    await query('UPDATE oauth_auth_codes SET consumed = 1 WHERE code = ?', [authorizationCode]);

    // Create a PM API key (same logic as ApiKeyService.createKey)
    const apiKeyId = crypto.randomUUID();
    const rawHex = crypto.randomBytes(20).toString('hex');
    const rawKey = `kpm_${rawHex}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.slice(0, 8);

    await query(
      `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, scopes, rate_limit, is_active, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, 100, 1, NULL)`,
      [
        apiKeyId,
        authCode.user_id,
        `OAuth: ${client.client_name || client.client_id}`,
        keyHash,
        keyPrefix,
        // the person's own role rights — never more (2026-10-04 audit)
        JSON.stringify(await scopesForUser(authCode.user_id)),
      ],
    );

    // Create a refresh token
    const refreshToken = crypto.randomBytes(32).toString('hex');

    // Store the token mapping
    const tokenId = crypto.randomUUID();
    const accessTokenHash = keyHash; // same hash since the raw key IS the access token
    await query(
      `INSERT INTO oauth_tokens (id, client_id, user_id, api_key_id, access_token_hash, refresh_token, refresh_token_expires_at, scope)
       VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 90 DAY), ?)`,
      [
        tokenId,
        client.client_id,
        authCode.user_id,
        apiKeyId,
        accessTokenHash,
        refreshToken,
        authCode.scope,
      ],
    );

    return {
      access_token: rawKey,
      token_type: 'bearer',
      expires_in: 86400 * 365, // 1 year (API key doesn't expire by default)
      refresh_token: refreshToken,
      scope: authCode.scope ?? undefined,
    };
  }

  /**
   * Exchanges a refresh token for a new access token.
   * Rotates the API key: deactivates old, creates new.
   */
  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
  ): Promise<OAuthTokens> {
    const rows = await query<TokenRow>(
      `SELECT * FROM oauth_tokens
       WHERE refresh_token = ? AND client_id = ? AND revoked = 0
       AND (refresh_token_expires_at IS NULL OR refresh_token_expires_at > NOW())`,
      [refreshToken, client.client_id],
    );
    if (rows.length === 0) {
      throw new Error('Invalid or expired refresh token');
    }
    const tokenRow = rows[0];

    // Deactivate the old API key
    await query('UPDATE api_keys SET is_active = 0 WHERE id = ?', [tokenRow.api_key_id]);

    // Revoke old token record
    await query('UPDATE oauth_tokens SET revoked = 1 WHERE id = ?', [tokenRow.id]);

    // Create new API key
    const apiKeyId = crypto.randomUUID();
    const rawHex = crypto.randomBytes(20).toString('hex');
    const rawKey = `kpm_${rawHex}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.slice(0, 8);

    await query(
      `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, scopes, rate_limit, is_active, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, 100, 1, NULL)`,
      [
        apiKeyId,
        tokenRow.user_id,
        `OAuth: ${client.client_name || client.client_id}`,
        keyHash,
        keyPrefix,
        // re-read on every renewal, so a lowered role takes effect
        JSON.stringify(await scopesForUser(tokenRow.user_id)),
      ],
    );

    // New refresh token (rotation)
    const newRefreshToken = crypto.randomBytes(32).toString('hex');
    const newTokenId = crypto.randomUUID();

    await query(
      `INSERT INTO oauth_tokens (id, client_id, user_id, api_key_id, access_token_hash, refresh_token, refresh_token_expires_at, scope)
       VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 90 DAY), ?)`,
      [
        newTokenId,
        client.client_id,
        tokenRow.user_id,
        apiKeyId,
        keyHash,
        newRefreshToken,
        tokenRow.scope,
      ],
    );

    return {
      access_token: rawKey,
      token_type: 'bearer',
      expires_in: 86400 * 365,
      refresh_token: newRefreshToken,
      scope: tokenRow.scope ?? undefined,
    };
  }

  /**
   * Verifies an access token (kpm_... API key).
   * Returns AuthInfo with extra.apiKey so tool handlers can make per-user API calls.
   */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const keyHash = crypto.createHash('sha256').update(token).digest('hex');

    // Validate the API key
    const keyRows = await query<ApiKeyRow>(
      `SELECT * FROM api_keys
       WHERE key_hash = ? AND is_active = 1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [keyHash],
    );
    if (keyRows.length === 0) {
      throw new Error('Invalid or expired access token');
    }
    const apiKey = keyRows[0];

    // Update last_used_at (fire-and-forget)
    query('UPDATE api_keys SET last_used_at = NOW() WHERE id = ?', [apiKey.id]).catch(() => {});

    // Look up the OAuth token record for client_id
    const tokenRows = await query<TokenRow>(
      `SELECT * FROM oauth_tokens WHERE access_token_hash = ? AND revoked = 0`,
      [keyHash],
    );

    const clientId = tokenRows.length > 0 ? tokenRows[0].client_id : 'unknown';
    const scopes = JSON.parse(apiKey.scopes) as string[];

    return {
      token,
      clientId,
      scopes,
      // SDK requires expiresAt to be a number; use 1 year from now if key has no expiry
      expiresAt: apiKey.expires_at
        ? Math.floor(new Date(apiKey.expires_at).getTime() / 1000)
        : Math.floor(Date.now() / 1000) + 86400 * 365,
      extra: {
        apiKey: token,
        userId: apiKey.user_id,
        keyId: apiKey.id,
      },
    };
  }

  /**
   * Revokes an access or refresh token.
   */
  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    const { token, token_type_hint } = request;

    if (token_type_hint === 'refresh_token' || (!token_type_hint && !token.startsWith('kpm_'))) {
      // Try as refresh token
      const rows = await query<TokenRow>(
        'SELECT * FROM oauth_tokens WHERE refresh_token = ? AND client_id = ?',
        [token, client.client_id],
      );
      if (rows.length > 0) {
        await query('UPDATE oauth_tokens SET revoked = 1 WHERE id = ?', [rows[0].id]);
        await query('UPDATE api_keys SET is_active = 0 WHERE id = ?', [rows[0].api_key_id]);
        return;
      }
    }

    if (token_type_hint === 'access_token' || !token_type_hint) {
      // Try as access token (kpm_ key)
      const keyHash = crypto.createHash('sha256').update(token).digest('hex');
      const rows = await query<TokenRow>(
        'SELECT * FROM oauth_tokens WHERE access_token_hash = ? AND client_id = ?',
        [keyHash, client.client_id],
      );
      if (rows.length > 0) {
        await query('UPDATE oauth_tokens SET revoked = 1 WHERE id = ?', [rows[0].id]);
        await query('UPDATE api_keys SET is_active = 0 WHERE id = ?', [rows[0].api_key_id]);
      }
    }
  }
}
