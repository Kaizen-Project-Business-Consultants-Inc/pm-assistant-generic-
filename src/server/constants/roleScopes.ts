/**
 * What each role may do through the API: read, write (change data) and admin (Kovarti platform
 * work). One list for the whole server — requireScope, API key creation and (as a checked copy,
 * mcp-server/src/oauth/roleScopes.ts) the Claude connection all use it.
 *
 * 'admin' belongs to the admin role only, which is the Kovarti platform admin (no company).
 */
export type Scope = 'read' | 'write' | 'admin';

export const ROLE_SCOPES: Record<string, Scope[]> = {
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

/** A role's rights; an unknown role may only read */
export function scopesForRole(role: string | undefined | null): Scope[] {
  return ROLE_SCOPES[role ?? ''] ?? ['read'];
}

/**
 * What a request may actually do. For an API key (including a Claude connection) it is the
 * key's rights LIMITED to the person's role — a key never does more than its owner can, even
 * one made before a role was lowered, or a Claude key that was issued with every right
 * (found 2026-10-04 audit). '*' on a key means "everything the role allows".
 */
export function effectiveScopes(role: string | undefined | null, keyScopes?: string[] | null): Scope[] {
  const roleScopes = scopesForRole(role);
  if (!keyScopes) return roleScopes;
  if (keyScopes.includes('*')) return roleScopes;
  // a key's 'admin' includes write and read, 'write' includes read — then limited to the role
  const keyAll = new Set<string>(keyScopes);
  if (keyAll.has('admin')) { keyAll.add('write'); keyAll.add('read'); }
  if (keyAll.has('write')) keyAll.add('read');
  return roleScopes.filter(s => keyAll.has(s));
}
