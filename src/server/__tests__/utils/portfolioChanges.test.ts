import { describe, it, expect } from 'vitest';
import { isProjectChange } from '../../utils/portfolioChanges';

describe('what counts as "a change" for the dashboard numbers', () => {
  it('a saved change to project data', () => {
    expect(isProjectChange('PUT', '/api/v1/schedules/s1/tasks/t1', 200)).toBe(true);
    expect(isProjectChange('POST', '/api/v1/projects/p1/risks', 201)).toBe(true);
    expect(isProjectChange('DELETE', '/api/v1/schedules/s1/tasks/t1', 204)).toBe(true);
  });
  it('not reading, not a failed change', () => {
    expect(isProjectChange('GET', '/api/v1/projects', 200)).toBe(false);
    expect(isProjectChange('PUT', '/api/v1/schedules/s1/tasks/t1', 403)).toBe(false);
  });
  it('not things that cannot move project numbers (sign-in, chat, notifications, your own settings)', () => {
    expect(isProjectChange('POST', '/api/v1/auth/login', 200)).toBe(false);
    expect(isProjectChange('POST', '/api/v1/ai-chat/message', 200)).toBe(false);
    expect(isProjectChange('POST', '/api/v1/notifications/n1/read', 200)).toBe(false);
    expect(isProjectChange('PUT', '/api/v1/users/me/dashboard-preferences', 200)).toBe(false);
  });
});
