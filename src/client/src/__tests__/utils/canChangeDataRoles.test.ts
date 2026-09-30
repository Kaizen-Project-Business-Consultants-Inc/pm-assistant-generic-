import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { WRITE_ROLES, canChangeData } from '../../hooks/useCanChangeData';

/**
 * The app hides change buttons (New Project, Add Resource, New Workflow…) from people the server
 * would refuse. That only works if the app's list of roles that may change data is the server's
 * list (requireScope: roles with 'write'). This fails if the two ever drift apart.
 */
describe("the app's change rights match the server's", () => {
  it('WRITE_ROLES = the roles the server gives write scope', () => {
    const src = readFileSync(join(__dirname, '..', '..', '..', '..', 'server', 'middleware', 'requireScope.ts'), 'utf8');
    const serverWrite = [...src.matchAll(/^\s+(\w+):\s*\[([^\]]*)\]/gm)]
      .filter(m => /'write'/.test(m[2]))
      .map(m => m[1]);
    expect([...WRITE_ROLES].sort()).toEqual([...new Set(serverWrite)].sort());
  });

  it('a support visit, a guest and read-only roles never get change buttons', () => {
    const base = { id: 'u', username: 'u', email: 'e', fullName: 'U' };
    expect(canChangeData({ ...base, role: 'project_manager' })).toBe(true);
    expect(canChangeData({ ...base, role: 'executive' })).toBe(false);
    expect(canChangeData({ ...base, role: 'team_member' })).toBe(false);
    expect(canChangeData({ ...base, role: 'project_manager', isGuest: true })).toBe(false);
    expect(canChangeData({ ...base, role: 'admin', supportSession: { organizationName: 'X', reason: 'r', expiresAt: '' } })).toBe(false);
    expect(canChangeData(null)).toBe(false);
  });
});
