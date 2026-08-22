import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Users, CreditCard } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { apiService } from '../services/api';
import { TIER_LABELS } from '../constants/branding';

export const RegisterPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite') || undefined;
  const tierParam = searchParams.get('tier') as 'consultant_basic' | 'consultant_pro' | 'sme' | 'enterprise' | null;
  const billingParam = (searchParams.get('billing') as 'monthly' | 'annual') || 'monthly';

  const isPlanSignup = !!tierParam && !inviteToken;

  const { setUser } = useAuthStore();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  // Invite context
  const [inviteValid, setInviteValid] = useState<boolean | null>(null);
  const [inviteOrgName, setInviteOrgName] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);

  useEffect(() => {
    if (inviteToken) {
      apiService.validateInvite(inviteToken).then((result) => {
        setInviteValid(result.valid);
        if (result.valid) {
          setInviteOrgName(result.orgName || null);
          if (result.email) {
            setInviteEmail(result.email);
            setEmail(result.email);
          }
        }
      }).catch(() => {
        setInviteValid(false);
      });
    }
  }, [inviteToken]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (!acceptTerms) {
      setError('You must accept the Terms of Service');
      return;
    }

    setIsLoading(true);
    try {
      const result = await apiService.register({
        fullName: isPlanSignup ? undefined : fullName,
        email,
        username: isPlanSignup ? undefined : username,
        password,
        organizationName: inviteToken ? undefined : (isPlanSignup ? undefined : (organizationName || undefined)),
        inviteToken,
        tier: isPlanSignup ? tierParam! : undefined,
        plan: isPlanSignup ? billingParam : undefined,
      });

      // Plan signup flow: auto-login + redirect to Stripe
      if (result.checkoutUrl) {
        if (result.user) {
          setUser(result.user);
        }
        window.location.href = result.checkoutUrl;
        return;
      }

      // Traditional flow: show success message
      setSuccessMessage(result.message || 'Registration successful. Please check your email to verify your account.');
      setSuccess(true);
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      setError(axiosError.response?.data?.message || 'Registration failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-500 via-purple-500 to-pink-500 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8 text-center">
          <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-900/40 rounded-xl flex items-center justify-center mb-4">
            <svg className="w-7 h-7 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Check your email</h2>
          <p className="text-gray-600 dark:text-gray-300 mb-6">{successMessage}</p>
          <Link to="/login" className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:text-primary-300 font-medium text-sm">
            Back to Sign In
          </Link>
        </div>
      </div>
    );
  }

  const isInviteFlow = inviteToken && inviteValid;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-500 via-purple-500 to-pink-500 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8">
          <div className="text-center mb-8">
            <div className="mx-auto w-12 h-12 bg-primary-100 dark:bg-primary-900/40 rounded-xl flex items-center justify-center mb-4">
              {isPlanSignup ? (
                <CreditCard className="w-7 h-7 text-primary-600 dark:text-primary-400" />
              ) : isInviteFlow ? (
                <Users className="w-7 h-7 text-primary-600 dark:text-primary-400" />
              ) : (
                <svg className="w-7 h-7 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
              )}
            </div>
            {isPlanSignup ? (
              <>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Subscribe to {TIER_LABELS[tierParam!] || tierParam}</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {billingParam === 'annual' ? 'Annual' : 'Monthly'} billing — create your account to continue
                </p>
              </>
            ) : isInviteFlow ? (
              <>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Join {inviteOrgName}</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">You've been invited as a viewer</p>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Create your account</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Start managing projects with AI</p>
              </>
            )}
          </div>

          {inviteToken && inviteValid === false && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4">
              <p className="text-sm text-red-700 dark:text-red-400">This invitation link is invalid or has expired.</p>
            </div>
          )}

          <form className="space-y-4" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              </div>
            )}

            {/* Full form fields — only for traditional / invite flows */}
            {!isPlanSignup && (
              <div>
                <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Full Name</label>
                <input id="fullName" type="text" required autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)}
                  className="input" placeholder="John Doe" />
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Email</label>
              <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="input" placeholder="john@example.com" readOnly={!!inviteEmail} />
            </div>

            {!isPlanSignup && (
              <div>
                <label htmlFor="username" className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Username</label>
                <input id="username" type="text" required autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)}
                  className="input" placeholder="johndoe" minLength={3} />
              </div>
            )}

            {!isPlanSignup && !isInviteFlow && (
              <div>
                <label htmlFor="organizationName" className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  Organization Name <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input id="organizationName" type="text" autoComplete="organization" value={organizationName} onChange={(e) => setOrganizationName(e.target.value)}
                  className="input" placeholder="Your company name (we'll use your name if blank)" />
              </div>
            )}

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Password</label>
              <div className="relative">
                <input id="password" type={showPassword ? 'text' : 'password'} required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)}
                  className="input pr-10" placeholder="Min. 8 characters" minLength={8} />
                <button type="button" onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Confirm Password</label>
              <div className="relative">
                <input id="confirmPassword" type={showPassword ? 'text' : 'password'} required autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                  className="input pr-10" placeholder="Confirm your password" minLength={8} />
                <button type="button" onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-start">
              <input id="terms" type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)}
                className="h-4 w-4 text-primary-600 dark:text-primary-400 border-gray-300 dark:border-gray-600 rounded mt-0.5" />
              <label htmlFor="terms" className="ml-2 text-sm text-gray-600 dark:text-gray-300">
                I agree to the <Link to="/terms" className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:text-primary-300" target="_blank">Terms of Service</Link> and{' '}
                <Link to="/privacy" className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:text-primary-300" target="_blank">Privacy Policy</Link>
              </label>
            </div>

            <button type="submit" disabled={isLoading}
              className="w-full flex justify-center py-2.5 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {isLoading ? (
                <div className="flex items-center">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  {isPlanSignup ? 'Setting up...' : 'Creating account…'}
                </div>
              ) : isPlanSignup ? (
                'Continue to Payment'
              ) : isInviteFlow ? (
                'Accept Invitation'
              ) : (
                'Create Account'
              )}
            </button>

            <div className="text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Already have an account?{' '}
                <Link to="/login" className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:text-primary-300 font-medium">Sign in</Link>
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
