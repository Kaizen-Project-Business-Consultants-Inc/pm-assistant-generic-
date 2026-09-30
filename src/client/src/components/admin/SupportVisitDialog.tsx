import { useState } from 'react';
import { Eye } from 'lucide-react';
import { AccessibleModal } from '../ui/AccessibleModal';
import { apiService } from '../../services/api';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';

/**
 * Start a Support view visit: a read-only, recorded, 30-minute look into one company.
 * Needs a reason (the company sees it in their audit trail) and the admin's password.
 */
export function SupportVisitDialog({ company, onClose }: { company: { id: string; name: string }; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 10) { setError('Say why you need to look (at least 10 characters) — the company sees this reason.'); return; }
    if (!password) { setError('Enter your password to start a support visit.'); return; }
    setBusy(true); setError(null);
    try {
      await apiService.startSupportVisit({ organizationId: company.id, reason: reason.trim(), password });
      window.location.assign('/dashboard'); // reload: the app now shows the company, read-only
    } catch (err) {
      setError(getApiErrorMessage(err, 'The support visit could not be started.'));
      setBusy(false);
    }
  };

  const input = 'w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100';
  return (
    <AccessibleModal isOpen onClose={onClose} ariaLabel={`Support view — ${company.name}`}>
      <form onSubmit={start} className="p-6 space-y-4 max-w-md">
        <div className="flex items-center gap-2">
          <Eye className="w-5 h-5 text-amber-600" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Support view — {company.name}</h2>
        </div>
        <ul className="text-sm text-gray-600 dark:text-gray-300 list-disc pl-5 space-y-1">
          <li>You will see their projects exactly as they do — <b>read-only</b>: nothing can be changed.</li>
          <li>The visit is <b>recorded in their audit trail</b> with your reason.</li>
          <li>It ends after <b>30 minutes</b>, or when you exit.</li>
        </ul>
        <div className="space-y-1">
          <label htmlFor="sv-reason" className="text-sm font-medium text-gray-700 dark:text-gray-300">Why do you need to look?</label>
          <textarea id="sv-reason" value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={500} autoFocus
            placeholder="e.g. Customer reported the Gantt won't load (ticket #123)" className={input} />
        </div>
        <div className="space-y-1">
          <label htmlFor="sv-password" className="text-sm font-medium text-gray-700 dark:text-gray-300">Your password</label>
          <input id="sv-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className={input} />
        </div>
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
          <button type="submit" disabled={busy}
            className="px-3 py-2 text-sm font-semibold rounded-lg bg-amber-500 text-amber-950 hover:bg-amber-400 disabled:opacity-60">
            {busy ? 'Starting…' : 'Start read-only visit'}
          </button>
        </div>
      </form>
    </AccessibleModal>
  );
}
