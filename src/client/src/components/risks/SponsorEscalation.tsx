import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Flag, Loader2 } from 'lucide-react';
import { apiService } from '../../services/api';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';
import { announce } from '../../utils/announce';
import { formatCalendarDate } from '../../utils/dateUtils';
import { needsEscalationPrompt } from '../../utils/escalationPrompt';

/**
 * Escalate a RAID item to the project's sponsor (Oct 2026, the PM is in total control).
 * Nothing goes to the sponsor by itself: a Critical risk or issue shows the PM a prompt, and
 * only the PM sends it, with their own note. Everyone sees the "Escalated to sponsor" tag.
 * The prompt rule is utils/escalationPrompt.ts (same as the server's; a parity test checks).
 */

interface Props {
  projectId: string;
  item: any;
  canEdit: boolean;
  onChanged: () => void;
}

export function SponsorEscalation({ projectId, item, canEdit, onChanged }: Props) {
  const sponsorQ = useQuery({ queryKey: ['project-sponsor', projectId], queryFn: () => apiService.getProjectSponsor(projectId) });
  const sponsor = sponsorQ.data?.sponsor ?? null;
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const terminal = ['cancelled', 'reversed'].includes(item.status);
  const prompt = canEdit && needsEscalationPrompt(item);

  const send = async () => {
    if (!note.trim()) { setError('Write a short note for the sponsor: what you need from them.'); return; }
    setBusy(true); setError(null);
    try {
      await apiService.escalateRaidItem(projectId, item.id, note.trim());
      announce(`Escalated to ${sponsor?.name ?? 'the sponsor'}.`);
      setOpen(false); setNote('');
      onChanged();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not escalate. Nothing was sent — please try again.'));
    } finally { setBusy(false); }
  };

  const notNow = async () => {
    setBusy(true); setError(null);
    try { await apiService.dismissEscalationPrompt(projectId, item.id); onChanged(); }
    catch (err) { setError(getApiErrorMessage(err, 'Could not hide the prompt. Please try again.')); }
    finally { setBusy(false); }
  };

  const tag = item.escalatedAt && (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-700 dark:bg-violet-900/30 dark:text-violet-200">
      <Flag className="w-3 h-3" aria-hidden="true" />
      Escalated to sponsor · {formatCalendarDate(String(item.escalatedAt).slice(0, 10), { month: 'short', day: 'numeric' }, 'en-US')}
    </span>
  );

  if (!canEdit) return tag ? <div>{tag}</div> : null;
  if (terminal && !tag) return null;

  const escalateButton = (label: string) => (
    <button type="button" onClick={() => { setOpen(true); setError(null); }} disabled={busy}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60">
      <Flag className="w-3.5 h-3.5" aria-hidden="true" /> {label}
    </button>
  );

  return (
    <div className="space-y-2">
      {tag}
      {prompt && !open && (
        <div role="status" className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 space-y-2">
          <p className="text-sm text-gray-900 dark:text-gray-100"><strong>This is now Critical.</strong> Does the sponsor need to know or decide? Only you can escalate it.</p>
          <div className="flex flex-wrap gap-2">
            {escalateButton('Escalate to sponsor…')}
            <button type="button" onClick={notNow} disabled={busy}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60">
              Not now
            </button>
          </div>
        </div>
      )}
      {!prompt && !open && !terminal && <div>{escalateButton(item.escalatedAt ? 'Escalate again…' : 'Escalate to sponsor…')}</div>}
      {open && (
        <div role="group" aria-label="Escalate to the sponsor" className="rounded-lg border border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/20 p-3 space-y-2">
          {sponsor ? (
            <>
              <label htmlFor={`escalate-note-${item.id}`} className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
                Escalate to {sponsor.name} (sponsor)
              </label>
              <textarea id={`escalate-note-${item.id}`} value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={2000}
                placeholder="What do you need from the sponsor? e.g. a decision by Friday"
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm text-gray-900 dark:text-gray-100" />
              <p className="text-xs text-gray-600 dark:text-gray-300">{sponsor.kind === 'user' ? 'They get a notification and an email, and can read the item.' : 'They get an email.'} Your note is also added to this item's updates.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setOpen(false)} disabled={busy}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 disabled:opacity-60">Cancel</button>
                <button type="button" onClick={send} disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60">
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" />} Send to sponsor
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-900 dark:text-gray-100">This project has no sponsor yet. Set one in the project details first (<strong>Edit project → Sponsor</strong>).</p>
              <button type="button" onClick={() => setOpen(false)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200">Close</button>
            </>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
    </div>
  );
}
