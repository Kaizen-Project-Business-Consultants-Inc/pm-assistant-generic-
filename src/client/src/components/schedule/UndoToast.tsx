import { useState } from 'react';
import type { FollowLine } from '../../utils/followMessage';

/**
 * The Undo message after a change, with Undo. When the change moved other tasks (or held some in place) "Details"
 * opens one line for each task, so the PM can see what happened and why. Screen readers hear it through the page's
 * polite announcer (useScheduleMutations), so it is not a live region itself. It stays while the pointer is on it,
 * the focus is in it, or Details is open (audit 2 M5).
 */
export function UndoToast({ text, details, onUndo, onDismiss, onHold }: {
  text: string;
  details: FollowLine[] | null;
  onUndo: () => void;
  onDismiss: () => void;
  onHold: (held: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = () => { onHold(!open); setOpen(!open); };
  return (
    <div
      data-testid="undo-toast"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-[min(92vw,44rem)] bg-gray-900 dark:bg-gray-700 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg animate-in slide-in-from-bottom-4 fade-in duration-200"
      onMouseEnter={() => onHold(true)}
      onMouseLeave={(e) => { if (!open && !e.currentTarget.contains(document.activeElement)) onHold(false); }}
      onFocus={() => onHold(true)}
      onBlur={(e) => { if (!open && !e.currentTarget.contains(e.relatedTarget as Node | null)) onHold(false); }}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <span>{text}</span>
        {details && details.length > 0 && (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            className="font-semibold text-primary-300 hover:text-primary-200 transition-colors rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {open ? 'Details ▴' : 'Details ▾'}
          </button>
        )}
        <button
          type="button"
          onClick={() => { onHold(false); onUndo(); }}
          aria-keyshortcuts="Control+Z"
          className="font-semibold text-primary-300 hover:text-primary-200 transition-colors rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          Undo
        </button>
        <span className="text-gray-300 text-xs" aria-hidden="true">Ctrl+Z</span>
        <button
          type="button"
          onClick={() => { onHold(false); onDismiss(); }}
          className="text-gray-300 hover:text-white ml-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label="Dismiss notification"
        >
          ✕
        </button>
      </div>
      {open && details && (
        <ul className="mt-2 pt-2 border-t border-gray-600 grid gap-1">
          {details.map((line, i) => (
            <li key={i}>
              <span className={`text-xs font-bold mr-2 ${line.tag === 'NOT MOVED' ? 'text-amber-300' : 'text-emerald-300'}`}>{line.tag}</span>
              {line.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
