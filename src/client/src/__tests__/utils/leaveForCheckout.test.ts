import { describe, it, expect } from 'vitest';
import { leaveForCheckout, signUpPageSendsOn } from '../../utils/leaveForCheckout';

/**
 * U41: a paid sign-up is signed in on the way to Stripe. The flag must be up BEFORE the sign-in
 * reaches the screens, or the sign-up route sends them on to "Verify Your Email" while Stripe loads.
 */
describe('leaveForCheckout', () => {
  it('signed in on the sign-up page: sent on, except for an invite', () => {
    expect(signUpPageSendsOn(true, '?tier=sme')).toBe(true);
    expect(signUpPageSendsOn(true, '?invite=abc')).toBe(false);
    expect(signUpPageSendsOn(false, '')).toBe(false);
  });

  it('raises the flag before signing in, then goes to the payment page', () => {
    const seen: boolean[] = [];
    const before = window.location.href;
    leaveForCheckout('#stripe-checkout', () => seen.push(signUpPageSendsOn(true, '?tier=sme')));
    expect(seen).toEqual([false]); // the sign-in no longer sends them anywhere
    expect(signUpPageSendsOn(true, '?tier=sme')).toBe(false);
    expect(window.location.href).not.toBe(before);
  });
});
