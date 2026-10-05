import type { RowDataPacket } from 'mysql2/promise';
import { query } from '../db.js';

/**
 * What a Claude connection's key may do: exactly what the person's role allows — never a fixed
 * "read, write, admin" for everyone (it was, until the 2026-10-04 audit).
 *
 * COPY of src/server/constants/roleScopes.ts ROLE_SCOPES (the MCP server is built on its own).
 * The server test __tests__/middleware/claudeKeyScopes.test.ts fails if the two differ.
 */
export const ROLE_SCOPES: Record<string, string[]> = {
  admin: ['read', 'write', 'admin'],
  executive: ['read'],
  project_manager: ['read', 'write'],
  scrum_master: ['read', 'write'],
  team_member: ['read'],
  finance_officer: ['read'],
  risk_manager: ['read', 'write'],
  pmo: ['read', 'write'],
  ba: ['read', 'write'],
  qa: ['read', 'write'],
  tester: ['read'],
  devops: ['read', 'write'],
  claude_sme: ['read'],
  viewer: ['read'],
};

/** The person's role rights, looked up now (an unknown person or role may only read) */
export async function scopesForUser(userId: string): Promise<string[]> {
  const rows = await query<RowDataPacket & { role: string }>('SELECT role FROM users WHERE id = ? LIMIT 1', [userId]);
  return ROLE_SCOPES[rows[0]?.role ?? ''] ?? ['read'];
}
