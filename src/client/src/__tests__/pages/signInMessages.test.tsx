import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * U27 (approved mock 2026-10-19): a refused sign-in says what went wrong and offers the next step —
 * no account for this email → "Create one", wrong password → "Reset it".
 */
const api = vi.hoisted(() => ({
  getAuthProviders: vi.fn(async () => ({ google: false })),
  login: vi.fn(),
}));
vi.mock('../../services/api', () => ({ apiService: api }));

import { LoginPage } from '../../pages/LoginPage';

const refused = (code: string | undefined, message: string) =>
  Object.assign(new Error('x'), { response: { status: 401, data: { code, message, needsHumanCheck: false } } });

const signIn = async () => {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes><Route path="/login" element={<LoginPage />} /></Routes>
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'jane@acme.test' } });
  fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'nope' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
};

describe('sign-in says what went wrong (U27)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('an email with no account offers to create one', async () => {
    api.login.mockRejectedValueOnce(refused('NO_ACCOUNT', "There's no Kovarti account for this email."));
    await signIn();
    await screen.findByText("There's no Kovarti account for this email.");
    expect(screen.getByRole('link', { name: 'Create one' }).getAttribute('href')).toBe('/pricing');
    expect(screen.queryByRole('link', { name: 'Reset it' })).toBeNull();
  });

  it('a wrong password offers to reset it', async () => {
    api.login.mockRejectedValueOnce(refused('WRONG_PASSWORD', "That password isn't right."));
    await signIn();
    await screen.findByText("That password isn't right.");
    expect(screen.getByRole('link', { name: 'Reset it' }).getAttribute('href')).toBe('/forgot-password');
    expect(screen.queryByRole('link', { name: 'Create one' })).toBeNull();
  });

  it('any other refusal keeps the general "Create an account" line', async () => {
    api.login.mockRejectedValueOnce(refused(undefined, 'This account uses Google.'));
    await signIn();
    await screen.findByText('This account uses Google.');
    expect(screen.getByRole('link', { name: 'Create an account' })).toBeTruthy();
  });
});
