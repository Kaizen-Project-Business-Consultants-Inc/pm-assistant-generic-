import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, RefreshCw } from 'lucide-react';
import { apiService } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { ROUTES } from '../routes';

export function VerifyEmailPendingPage() {
  const { user, setUser } = useAuthStore();
  const navigate = useNavigate();
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  // Poll /auth/me every 5s to detect when email is verified
  const checkVerification = useCallback(async () => {
    try {
      const data = await apiService.getMe();
      if (data.user?.emailVerified) {
        setUser(data.user);
        navigate(ROUTES.dashboard, { replace: true });
      }
    } catch {
      // ignore — user may still be on this page
    }
  }, [setUser, navigate]);

  useEffect(() => {
    const interval = setInterval(checkVerification, 5000);
    return () => clearInterval(interval);
  }, [checkVerification]);

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

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-500 via-purple-500 to-pink-500 py-12 px-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8 text-center">
        <div className="mx-auto w-14 h-14 bg-primary-100 dark:bg-primary-900/30 rounded-xl flex items-center justify-center mb-5">
          <Mail className="w-7 h-7 text-primary-600" />
        </div>

        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Verify Your Email</h2>
        <p className="text-gray-600 dark:text-gray-300 mb-2">
          We sent a verification link to:
        </p>
        <p className="font-medium text-gray-900 dark:text-white mb-6">{user?.email}</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Click the link in your email to activate your account. This page will automatically redirect once verified.
        </p>

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

        <p className="mt-6 text-xs text-gray-400">
          Wrong email? <a href="/register" className="text-primary-600 hover:underline">Register again</a>
        </p>
      </div>
    </div>
  );
}
