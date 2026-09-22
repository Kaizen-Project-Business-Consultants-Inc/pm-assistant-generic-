import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ExternalLink, RefreshCw, Check, AlertCircle } from 'lucide-react';
import { apiService } from '../../services/api';

/**
 * What someone sees between signing up and getting in.
 *
 * This is a hard wall — an unverified account cannot log in at all — and it was
 * where every early signup stopped: five of the first six accounts on production
 * never verified and never logged in. The screen said "Check your email" and
 * nothing else: not which address, not what the message looks like, not what to
 * do when it is not there.
 *
 * So it now does the five things that actually help: repeat the address back so
 * a typo is obvious, open the mailbox in one tap, say exactly what to search
 * for, name Spam and Promotions out loud because that is the real failure, and
 * offer to send it again.
 */

const SENDER_NAME = 'Kovarti PM';
const SENDER_ADDRESS = 'noreply@kovarti.com';
const SUBJECT = 'Verify your Kovarti PM Assistant account';

/** A one-tap link to the inbox, for the mail providers most people use. */
function mailboxLink(email: string): { label: string; url: string } | null {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  if (/^(gmail\.com|googlemail\.com)$/.test(domain)) {
    return { label: 'Open Gmail', url: 'https://mail.google.com/mail/u/0/#search/from%3Akovarti.com' };
  }
  if (/^(outlook\.|hotmail\.|live\.|msn\.)/.test(domain)) {
    return { label: 'Open Outlook', url: 'https://outlook.live.com/mail/0/inbox' };
  }
  if (/^(yahoo\.|ymail\.)/.test(domain)) {
    return { label: 'Open Yahoo Mail', url: 'https://mail.yahoo.com/' };
  }
  // Anything else — a work address, most likely — has no address we can guess.
  return null;
}

export function CheckYourEmail({ email, onChangeEmail }: { email: string; onChangeEmail?: () => void }) {
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);

  const mailbox = mailboxLink(email);

  const handleResend = async () => {
    setResending(true);
    setResendError(null);
    try {
      await apiService.resendVerificationEmail(email);
      setResent(true);
    } catch (err: any) {
      // The endpoint is deliberately strict (3 per 15 minutes) — say so plainly
      // rather than showing a bare failure.
      setResendError(
        err?.response?.status === 429
          ? 'We have sent a few already. Please wait a few minutes before asking again.'
          : err?.response?.data?.message || 'We could not send it again just now. Please try in a moment.',
      );
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-500 via-purple-500 to-pink-500 py-12 px-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8">
        <div className="text-center">
          <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-900/40 rounded-xl flex items-center justify-center mb-4">
            <Mail className="w-7 h-7 text-green-600 dark:text-green-400" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Confirm your email</h2>
          <p className="text-gray-600 dark:text-gray-300">
            We sent a link to{' '}
            {/* Repeated back so a typo is obvious before they go hunting for it. */}
            <span className="font-semibold text-gray-900 dark:text-white break-all">{email}</span>.
            Open it to finish setting up your account.
          </p>
        </div>

        {mailbox && (
          <a
            href={mailbox.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 text-white font-medium hover:bg-primary-700 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            {mailbox.label}
          </a>
        )}

        <div className="mt-6 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2">What to look for</p>
          <dl className="text-xs text-gray-600 dark:text-gray-300 space-y-1">
            <div className="flex gap-2">
              <dt className="text-gray-500 dark:text-gray-400 w-14 flex-shrink-0">From</dt>
              <dd className="break-all">{SENDER_NAME} &lt;{SENDER_ADDRESS}&gt;</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-gray-500 dark:text-gray-400 w-14 flex-shrink-0">Subject</dt>
              <dd>&ldquo;{SUBJECT}&rdquo;</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-gray-600 dark:text-gray-300">
            {/* The actual failure mode, said out loud. */}
            If it is in <strong>Spam</strong> or <strong>Promotions</strong>, drag it to your main
            inbox so our future emails reach you.
          </p>
        </div>

        <div className="mt-6 text-center space-y-3">
          {resent ? (
            <p className="inline-flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
              <Check className="w-4 h-4" /> Sent again — it may take a minute to arrive.
            </p>
          ) : (
            <button
              onClick={handleResend}
              disabled={resending}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline disabled:opacity-50"
            >
              {resending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Didn&apos;t get it? Send it again
            </button>
          )}

          {resendError && (
            <p role="status" className="inline-flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              {resendError}
            </p>
          )}

          <div className="text-sm text-gray-500 dark:text-gray-400 space-x-3">
            {onChangeEmail && (
              <button onClick={onChangeEmail} className="hover:underline">
                Wrong address?
              </button>
            )}
            <Link to="/login" className="hover:underline">Back to sign in</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
