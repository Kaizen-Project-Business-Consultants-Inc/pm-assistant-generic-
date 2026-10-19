import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';

/**
 * U41 (UAT 2026-10-18): Continue to Payment flashed "Verify Your Email — we sent a link" before
 * Stripe opened. The real sign-up page and the real route decision (App's /register route uses
 * signUpPageSendsOn): signing in on the way out must not send them anywhere.
 */
const api = vi.hoisted(() => ({
  register: vi.fn(),
  validateInvite: vi.fn(),
  getAuthProviders: vi.fn(async () => ({ google: false })),
}));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../components/auth/TurnstileWidget', () => ({ TurnstileWidget: () => null }));

import { useAuthStore } from '../../stores/authStore';
import { RegisterPage } from '../../pages/RegisterPage';
import { signUpPageSendsOn } from '../../utils/leaveForCheckout';

function RegisterRoute() {
  const { isAuthenticated } = useAuthStore();
  const { search } = useLocation();
  return signUpPageSendsOn(isAuthenticated, search) ? <Navigate to="/dashboard" replace /> : <RegisterPage />;
}

describe('paid sign-up on its way to Stripe', () => {
  afterEach(cleanup);

  it('signs them in, but stays put while the payment page loads — no "Verify Your Email"', async () => {
    useAuthStore.setState({ user: null, isAuthenticated: false } as never);
    api.register.mockResolvedValueOnce({
      checkoutUrl: '#stripe-checkout',
      user: { id: 'u1', username: 'jane', email: 'jane@acme.test', fullName: 'Jane', role: 'project_manager', emailVerified: false, subscriptionTier: 'trial', pendingTier: 'consultant_pro', subscriptionStatus: 'incomplete' },
    });
    render(
      <MemoryRouter initialEntries={['/register?tier=consultant_pro&plan=monthly']}>
        <Routes>
          <Route path="/register" element={<RegisterRoute />} />
          <Route path="/dashboard" element={<h1>Verify Your Email</h1>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'jane@acme.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByLabelText(/I agree to the/));
    fireEvent.click(screen.getByRole('button', { name: /Continue to Payment/ }));

    await waitFor(() => expect(useAuthStore.getState().user?.email).toBe('jane@acme.test'));
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(screen.queryByText('Verify Your Email')).toBeNull();
    expect(window.location.hash).toBe('#stripe-checkout');
  });
});
