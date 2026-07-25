import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiService } from '../services/api';

export const VerifyEmailPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setStatus('error');
      setMessage('No verification token provided.');
      return;
    }

    apiService.verifyEmail(token)
      .then((data) => {
        setStatus('success');
        setMessage(data.message || 'Email verified successfully!');
      })
      .catch((err) => {
        setStatus('error');
        const axiosError = err as { response?: { data?: { message?: string } } };
        setMessage(axiosError.response?.data?.message || 'Verification failed. The link may be expired.');
      });
  }, [searchParams]);

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
            <Link
              to="/login"
              className="inline-block px-6 py-2.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
            >
              Sign In
            </Link>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="mx-auto w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-xl flex items-center justify-center mb-4">
              <svg className="w-7 h-7 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Verification Failed</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">{message}</p>
            <Link
              to="/login"
              className="inline-block px-6 py-2.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
            >
              Back to Sign In
            </Link>
          </>
        )}
      </div>
    </div>
  );
};
