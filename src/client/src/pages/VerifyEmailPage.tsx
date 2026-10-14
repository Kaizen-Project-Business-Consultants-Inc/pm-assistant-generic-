import React, { useEffect, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { apiService } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { ROUTES } from '../routes';
import { CheckYourEmail } from '../components/auth/CheckYourEmail';
import { getApiErrorMessage } from '../utils/getApiErrorMessage';

export const VerifyEmailPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const { isAuthenticated, setUser, user } = useAuthStore();
  // A dead link (an older email, or past 24 hours) offers a new one instead of a dead end (2026-10-14)
  const [resendEmail, setResendEmail] = useState(user?.email ?? '');
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [resendError, setResendError] = useState<string | null>(null);

  async function handleResend(e: React.FormEvent) {
    e.preventDefault();
    setResendError(null);
    setResendState('sending');
    try {
      await apiService.resendVerificationEmail(resendEmail.trim());
      setResendState('sent');
    } catch (err) {
      setResendState('idle');
      setResendError(getApiErrorMessage(err, 'The new link could not be sent. Please try again in a few minutes.'));
    }
  }
  const navigate = useNavigate();

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setStatus('error');
      setMessage('No verification token provided.');
      return;
    }

    apiService.verifyEmail(token)
      .then(async (data) => {
        setStatus('success');
        setMessage(data.message || 'Email verified successfully!');
        // If already logged in, refresh user data so emailVerified updates
        if (isAuthenticated) {
          try {
            const me = await apiService.getMe();
            if (me.user) setUser(me.user);
          } catch { /* ignore */ }
        }
      })
      .catch((err) => {
        setStatus('error');
        const axiosError = err as { response?: { data?: { message?: string } } };
        setMessage(axiosError.response?.data?.message || 'Verification failed. The link may be expired.');
      });
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleContinue() {
    if (isAuthenticated) {
      navigate(ROUTES.dashboard, { replace: true });
    } else {
      navigate(ROUTES.login, { replace: true });
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-500 via-purple-500 to-pink-500 py-12 px-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8 text-center">
        {status === 'loading' && (
          <>
            <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto mb-4" />
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Verifying your email...</h2>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center mb-4">
              <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Email Verified!</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">{message}</p>
            <button
              onClick={handleContinue}
              className="inline-block px-6 py-2.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
            >
              {isAuthenticated ? 'Continue to Dashboard' : 'Sign In'}
            </button>
          </>
        )}

        {status === 'error' && resendState === 'sent' && (
          <CheckYourEmail email={resendEmail.trim()} />
        )}
        {status === 'error' && resendState !== 'sent' && (
          <>
            <div className="mx-auto w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-xl flex items-center justify-center mb-4">
              <svg className="w-7 h-7 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Verification Failed</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-2">{message}</p>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              A link stops working after 24 hours, or when a newer email was sent — always use the newest one.
              Already confirmed? Just sign in.
            </p>
            <form onSubmit={handleResend} className="flex flex-col gap-2 text-left mb-4">
              <label htmlFor="resend-email" className="text-sm font-medium text-gray-700 dark:text-gray-200">Your email</label>
              <input
                id="resend-email"
                type="email"
                required
                autoComplete="email"
                value={resendEmail}
                onChange={(e) => setResendEmail(e.target.value)}
                className="input"
              />
              {resendError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{resendError}</p>}
              <button
                type="submit"
                disabled={resendState === 'sending' || !resendEmail.trim()}
                className="px-6 py-2.5 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-60"
              >
                {resendState === 'sending' ? 'Sending…' : 'Send me a new link'}
              </button>
            </form>
            <Link
              to="/login"
              className="inline-block text-sm font-medium text-primary-700 dark:text-primary-300 hover:underline"
            >
              Back to Sign In
            </Link>
          </>
        )}
      </div>
    </div>
  );
};
