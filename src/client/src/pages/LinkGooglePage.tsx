import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { apiService } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useSEO } from '../hooks/useSEO';
import { KovartiMark } from '../components/ui/KovartiMark';
import { ROUTES } from '../routes';
import { getApiErrorMessage } from '../utils/getApiErrorMessage';

/**
 * "You already have a Kovarti account" (Sign in with Google, Oct 2026). Google came back with an
 * address that already has an account; it is linked only after proof it's theirs — never
 * automatically (approved mock 2026-10-12):
 * - ?token=…   from the return from Google: the account's password once, or "email me a link";
 * - ?confirm=… the emailed link: names the account, then one button links and signs in
 *   (a button, not the link itself: mail scanners open links before people do).
 * States: loading → (expired | problem + Try again | password form | email sent | confirm) → signing in.
 */
type Preview = { account: string; google: string; hasPassword: boolean };

const statusOf = (err: unknown) => (err as { response?: { status?: number } })?.response?.status;

export const LinkGooglePage: React.FC = () => {
  useSEO({ title: 'Link your Google account — Kovarti PM', description: 'Link Google to your Kovarti account.', canonical: '/link-google' });
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const code = searchParams.get('confirm');
  const navigate = useNavigate();
  const { setUser } = useAuthStore();

  const [preview, setPreview] = useState<Preview | null>(null);
  const [expired, setExpired] = useState<string | null>(null);
  /** The link page couldn't load for another reason (busy, offline): say so and offer Try again */
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const ref = code ? { code } : token ? { token } : null;
    if (!ref) { setExpired('This link is incomplete. Please click "Continue with Google" again.'); return; }
    setLoadProblem(null);
    apiService.googleLinkPreview(ref)
      .then(setPreview)
      .catch((err) => {
        const message = getApiErrorMessage(err, 'Something went wrong. Please try again.');
        if (statusOf(err) === 410) setExpired(message);
        else setLoadProblem(message);
      });
  }, [token, code, attempt]);

  // Move focus where the person works next when the screen changes: the password box on the
  // password screen, otherwise the heading (screen readers hear where they are)
  useEffect(() => {
    if (preview && token && !code && preview.hasPassword && !emailSent && !expired) passwordRef.current?.focus();
    else headingRef.current?.focus();
  }, [preview, expired, emailSent, loadProblem, token, code]);

  // The same steps as signing in with a password (LoginPage); the link is done even if this lookup
  // fails, so then the app opens and loads the person itself
  const signedIn = async () => {
    try {
      const me = await apiService.getMe();
      if (me.user?.isFirstLogin) sessionStorage.setItem('pm-first-login', 'true');
      setUser(me.user);
      if (me.user?.mustChangePassword) void navigate(ROUTES.changePassword);
      else void navigate(me.user?.fullName ? ROUTES.dashboard : ROUTES.onboarding);
    } catch {
      window.location.assign(ROUTES.home);
    }
  };

  const run = async (action: () => Promise<unknown>, after: () => Promise<void> | void, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await after();
    } catch (err) {
      const status = statusOf(err);
      if (status === 410) setExpired(getApiErrorMessage(err, fallback));
      else setError(getApiErrorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const linkWithPassword = (e: React.FormEvent) => {
    e.preventDefault();
    void run(() => apiService.googleLinkWithPassword(token!, password), signedIn, 'Linking failed. Please try again.');
  };
  const emailMeALink = () => {
    void run(async () => setEmailSent((await apiService.googleLinkByEmail(token!)).message), () => {}, "We couldn't send the email. Please try again.");
  };
  const confirm = () => {
    void run(() => apiService.googleLinkConfirm(code!), signedIn, 'Linking failed. Please try again.');
  };

  const heading = (text: string) => (
    <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-gray-900 dark:text-white focus:outline-none">{text}</h1>
  );
  const linkClass = 'text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300';
  const buttonClass = 'w-full flex justify-center py-2.5 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

  let body: React.ReactNode;
  if (expired) {
    body = (
      <>
        {heading('This link has expired')}
        <p className="text-sm text-gray-600 dark:text-gray-300">{expired}</p>
        <Link to={ROUTES.login} className={linkClass}>Back to sign in</Link>
      </>
    );
  } else if (loadProblem) {
    body = (
      <>
        {heading('Something went wrong')}
        <p className="text-sm text-gray-600 dark:text-gray-300">{loadProblem}</p>
        <button type="button" onClick={() => setAttempt((n) => n + 1)} className={buttonClass}>Try again</button>
        <Link to={ROUTES.login} className={linkClass}>Back to sign in</Link>
      </>
    );
  } else if (!preview) {
    body = <p role="status" className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>;
  } else if (emailSent) {
    body = (
      <>
        <div className="mx-auto w-14 h-14 bg-primary-100 dark:bg-primary-900/40 rounded-full flex items-center justify-center">
          <Mail className="w-7 h-7 text-primary-600 dark:text-primary-400" aria-hidden="true" />
        </div>
        {heading('Check your email')}
        <p className="text-sm text-gray-600 dark:text-gray-300">
          We sent a link to <strong>{preview.account}</strong>. Open it within 10 minutes and click <strong>Link Google and sign in</strong>.
        </p>
        <Link to={ROUTES.login} className={linkClass}>Back to sign in</Link>
      </>
    );
  } else if (code) {
    body = (
      <>
        {heading('Link your Google account')}
        <p className="text-sm text-gray-600 dark:text-gray-300">
          This links the Google account <strong>{preview.google}</strong> to the Kovarti account <strong>{preview.account}</strong>.
          After that, <strong>Continue with Google</strong> signs you straight in.
        </p>
        <button type="button" onClick={confirm} disabled={busy} className={buttonClass}>Link Google and sign in</button>
        <p className="text-xs text-gray-500 dark:text-gray-400">Not your account? Close this page — nothing changes.</p>
      </>
    );
  } else {
    body = (
      <>
        {heading('You already have a Kovarti account')}
        {preview.hasPassword ? (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              <strong>{preview.account}</strong> already signs in with a password. Enter it once to link Google — after that,{' '}
              <strong>Continue with Google</strong> signs you straight in.
            </p>
            <form onSubmit={linkWithPassword} className="space-y-4">
              <div>
                <label htmlFor="link-password" className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Your Kovarti password</label>
                <input ref={passwordRef} id="link-password" type="password" required autoComplete="current-password" value={password}
                  onChange={(e) => setPassword(e.target.value)} className="input"
                  aria-invalid={!!error} {...(error ? { 'aria-describedby': 'link-error' } : {})} />
              </div>
              <button type="submit" disabled={busy || !password} className={buttonClass}>Link Google and sign in</button>
            </form>
          </>
        ) : (
          <p className="text-sm text-gray-600 dark:text-gray-300">
            <strong>{preview.account}</strong> already has a Kovarti account. We&apos;ll email it a link to confirm it&apos;s yours.
          </p>
        )}
        <div className="flex flex-col gap-2 items-start">
          <button type="button" onClick={emailMeALink} disabled={busy} className={`${linkClass} text-left`}>
            {preview.hasPassword ? 'Forgot your password? Email me a link to link Google instead' : 'Email me a link to link Google'}
          </button>
          <Link to={ROUTES.login} className={linkClass}>Cancel — back to sign in</Link>
        </div>
        <div className="bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-lg p-3 text-xs text-gray-700 dark:text-gray-200">
          Why we ask: linking needs proof you own this Kovarti account, so no one can take it over with a Google account under the same address.
        </div>
      </>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-500 via-purple-500 to-pink-500 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8 space-y-5">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-primary-100 dark:bg-primary-900/40 rounded-lg flex items-center justify-center">
              <KovartiMark className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            </div>
            <span className="font-semibold text-gray-900 dark:text-white">Kovarti</span>
          </div>
          {error && (
            <div id="link-error" role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}
          {body}
        </div>
      </div>
    </main>
  );
};
