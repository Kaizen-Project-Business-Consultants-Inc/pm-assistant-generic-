import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, RefreshCw, CheckCircle } from 'lucide-react';
import { apiService } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { ROUTES } from '../routes';
import { isPaidTier, tierLabel } from '../constants/branding';
import { getApiErrorMessage } from '../utils/getApiErrorMessage';

/**
 * "Confirm your email". A paid sign-up lands here straight after paying (its link is sent
 * then, UAT 2026-10-17), so it leads with the payment. Resend sends the link again; "Wrong
 * address? Change it" corrects a typo in place (it replaced "Register again", which made a
 * second account). The page moves on by itself once the email is confirmed.
 *
 * Change-email states: closed → open (typing) → saving → closed with "Sent to …", or back to
 * open with the reason it was refused. Cancel closes it without saving.
 */
export function VerifyEmailPendingPage() {
  const { user, setUser } = useAuthStore();
  const navigate = useNavigate();
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [changeOpen, setChangeOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [changeSaving, setChangeSaving] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const newEmailRef = useRef<HTMLInputElement>(null);
  const changeButtonRef = useRef<HTMLButtonElement>(null);
  const formWasOpen = useRef(false);
  // Opening the form puts the cursor in it; closing it (Save or Cancel) puts focus back on
  // "Change it", so keyboard users aren't dropped at the top of the page
  useEffect(() => {
    if (changeOpen) {
      formWasOpen.current = true;
      newEmailRef.current?.focus();
    } else if (formWasOpen.current) {
      formWasOpen.current = false;
      changeButtonRef.current?.focus();
    }
  }, [changeOpen]);

  // Ask the server every 5 s: moves on once verified, and picks up the payment when Stripe confirms it
  const checkVerification = useCallback(async () => {
    try {
      const data = await apiService.getMe();
      if (!data.user) return;
      setUser(data.user);
      if (data.user.emailVerified) navigate(ROUTES.dashboard, { replace: true });
    } catch {
      // ignore — user may still be on this page
    }
  }, [setUser, navigate]);

  // Back from paying: ask Stripe straight away rather than wait for its webhook (this also sends
  // the confirm link if the webhook hasn't). Once, on arrival, only while awaiting payment.
  const awaitingPayment = user?.subscriptionStatus === 'incomplete';
  const reconciled = useRef(false);
  useEffect(() => {
    if (!awaitingPayment || reconciled.current) return;
    reconciled.current = true;
    apiService.reconcileSubscription().then(() => checkVerification()).catch(() => { /* the webhook and the 5 s check still work */ });
  }, [awaitingPayment, checkVerification]);

  useEffect(() => {
    void checkVerification();
    const interval = setInterval(checkVerification, 5000);
    return () => clearInterval(interval);
  }, [checkVerification]);

  const paid = isPaidTier(user?.subscriptionTier)
    && (user?.subscriptionStatus === 'active' || user?.subscriptionStatus === 'trialing');

  async function handleResend() {
    if (!user?.email || resendStatus === 'sending') return;
    setResendStatus('sending');
    setMessage('');
    try {
      const data = await apiService.resendVerificationEmail(user.email);
      setResendStatus('sent');
      setMessage(data.message || 'Verification email sent.');
    } catch (err: any) {
      setResendStatus('error');
      setMessage(err?.response?.data?.error || 'Failed to resend. Please try again later.');
    }
  }

  async function handleChangeEmail(e: React.FormEvent) {
    e.preventDefault();
    if (changeSaving || !user) return;
    setChangeSaving(true);
    setChangeError(null);
    try {
      const data = await apiService.changePendingEmail(newEmail.trim(), currentPassword);
      setUser({ ...user, email: data.email });
      setSentTo(data.email);
      setChangeOpen(false);
      setNewEmail('');
      setCurrentPassword('');
      setResendStatus('idle');
      setMessage('');
    } catch (err) {
      setChangeError(getApiErrorMessage(err, 'Your email could not be changed. Please try again.'));
    } finally {
      setChangeSaving(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-500 via-purple-500 to-pink-500 py-12 px-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8 text-center">
        {paid && (
          <p className="inline-flex items-center gap-1.5 mb-4 text-sm font-medium text-green-700 dark:text-green-400">
            <CheckCircle className="w-4 h-4" aria-hidden="true" />
            Payment received · {tierLabel(user!.subscriptionTier!)}
          </p>
        )}
        <div className="mx-auto w-14 h-14 bg-primary-100 dark:bg-primary-900/30 rounded-xl flex items-center justify-center mb-5">
          <Mail className="w-7 h-7 text-primary-600" />
        </div>

        {paid ? (
          <>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">One last step: confirm your email</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              We&apos;ve just sent a link to <span className="font-medium text-gray-900 dark:text-white">{user?.email}</span>.
              {' '}Click it to open Kovarti. This page moves on by itself once you have.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Verify Your Email</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-2">
              We sent a verification link to:
            </p>
            <p className="font-medium text-gray-900 dark:text-white mb-6">{user?.email}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              Click the link in your email to activate your account. This page will automatically redirect once verified.
            </p>
          </>
        )}

        <button
          onClick={handleResend}
          disabled={resendStatus === 'sending' || resendStatus === 'sent'}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${resendStatus === 'sending' ? 'animate-spin' : ''}`} />
          {resendStatus === 'sent' ? 'Email Sent' : resendStatus === 'sending' ? 'Sending...' : 'Resend Verification Email'}
        </button>

        {message && (
          <p className={`mt-4 text-sm ${resendStatus === 'error' ? 'text-red-600' : 'text-green-600'}`}>
            {message}
          </p>
        )}

        {/* Always mounted, so screen readers announce "Sent to …" when it appears */}
        <p className={sentTo && !changeOpen ? 'mt-4 text-sm text-green-700 dark:text-green-400' : ''} role="status">
          {sentTo && !changeOpen ? `Sent to ${sentTo}` : ''}
        </p>

        {changeOpen ? (
          <form onSubmit={handleChangeEmail} className="mt-6 text-left space-y-2">
            <label htmlFor="pending-new-email" className="block text-sm font-medium text-gray-700 dark:text-gray-200">New email address</label>
            <input
              ref={newEmailRef} id="pending-new-email" type="email" required autoComplete="email"
              value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
              className="input" placeholder="jane@company.com"
              aria-describedby={changeError ? 'pending-new-email-error' : undefined}
            />
            <label htmlFor="pending-current-password" className="block text-sm font-medium text-gray-700 dark:text-gray-200">Your password</label>
            <input
              id="pending-current-password" type="password" required autoComplete="current-password"
              value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
              className="input" aria-describedby="pending-current-password-hint"
            />
            <p id="pending-current-password-hint" className="text-xs text-gray-500 dark:text-gray-400">The one you chose when you signed up.</p>
            {changeError && (
              <p id="pending-new-email-error" className="text-sm text-red-600 dark:text-red-400" role="alert">{changeError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => { setChangeOpen(false); setChangeError(null); }}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                Cancel
              </button>
              <button type="submit" disabled={changeSaving || !newEmail.trim() || !currentPassword}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg">
                {changeSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        ) : (
          <p className="mt-6 text-xs text-gray-500 dark:text-gray-400">
            Wrong address?{' '}
            <button ref={changeButtonRef} type="button" onClick={() => { setChangeOpen(true); setSentTo(null); }}
              className="text-primary-600 dark:text-primary-400 hover:underline font-medium">
              Change it
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
