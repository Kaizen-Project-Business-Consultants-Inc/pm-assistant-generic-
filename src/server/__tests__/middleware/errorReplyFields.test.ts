import { describe, it, expect } from 'vitest';
import { normalizeErrorBody } from '../../utils/errorReply';

describe('error replies keep what the route sent', () => {
  it('fills in the standard fields and keeps every other one', () => {
    const out = normalizeErrorBody(
      { error: 'Invalid credentials', message: 'Username or password is incorrect', needsHumanCheck: true, current: { v: 2 }, existingProjectId: 'p1' },
      401, 'Unauthorized', '/api/v1/auth/login',
    );
    expect(out).toMatchObject({
      statusCode: 401, error: 'Invalid credentials', message: 'Username or password is incorrect', path: '/api/v1/auth/login',
      needsHumanCheck: true, current: { v: 2 }, existingProjectId: 'p1',
    });
    expect(typeof out.timestamp).toBe('string');
  });

  it('a bare error gets the status text, and a route cannot fake the status code or path', () => {
    const out = normalizeErrorBody({ error: 'Memory not found', statusCode: 200, path: '/x' }, 404, 'Not Found', '/api/v1/memory/1');
    expect(out).toMatchObject({ statusCode: 404, error: 'Memory not found', message: 'Memory not found', path: '/api/v1/memory/1' });
    expect(normalizeErrorBody({}, 500, 'Internal Server Error', '/api/x')).toMatchObject({ error: 'Internal Server Error', message: 'Internal Server Error' });
  });
});
