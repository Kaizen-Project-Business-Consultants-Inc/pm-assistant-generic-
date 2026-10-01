import React, { useRef, useState } from 'react';
import { ClipboardList, Printer, X } from 'lucide-react';
import { useModal } from '../../hooks/useModal';

/**
 * Meeting Coach (2026-10-01): the chair's card — the phrases that make an item "called out",
 * and the two questions to ask for every action. Any natural wording works; this is a prompt,
 * not a script.
 */
export const CHAIR_PHRASES: { kind: string; example: string }[] = [
  { kind: 'Action', example: "That's an action for Tom: order the test devices." },
  { kind: 'Risk', example: "Let's log that as a risk: the vendor may slip." },
  { kind: 'Issue', example: "That's an issue: the test server is down." },
  { kind: 'Decision', example: 'Decision: we go live on 9 November.' },
  { kind: 'Dependency', example: "Dependency: we need the bureau's API keys first." },
  { kind: 'Any wording works', example: '"Tom, can you take that?" or "put that down as an issue" count too.' },
];

export const ChairsCard: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const { dialogRef, handleKeyDown } = useModal(isOpen, onClose);
  const cardRef = useRef<HTMLDivElement>(null);
  const [printBlocked, setPrintBlocked] = useState(false);
  if (!isOpen) return null;

  // Print just the card, in a window of its own
  const print = () => {
    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w || !cardRef.current) { setPrintBlocked(true); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Chair's card</title>
      <style>body{font-family:system-ui,sans-serif;margin:32px;color:#111;line-height:1.45}h2{margin:0 0 12px}
      .g{display:grid;grid-template-columns:1fr 1fr;gap:10px}.p{border:1px solid #bbb;border-radius:8px;padding:10px}
      .p b{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#0f766e}
      .a{background:#eefaf8;border-radius:8px;padding:10px;margin-top:12px}.m{color:#555;margin-top:10px}</style>
      </head><body><h2>Chair's card</h2>${cardRef.current.innerHTML}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Chair's card"
        onKeyDown={handleKeyDown}
        tabIndex={-1}
        className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-primary-500" aria-hidden="true" /> Chair's card
          </h2>
          <div className="flex items-center gap-2">
            <button type="button" onClick={print} className="btn btn-secondary text-xs px-3 py-1.5 inline-flex items-center gap-1.5">
              <Printer className="w-3.5 h-3.5" aria-hidden="true" /> Print
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Say these out loud as items come up. Kovarti marks them <strong>called out</strong> and ticks them for you after the meeting; anything else is marked <strong>AI spotted</strong>.
          </p>
          <div ref={cardRef}>
            <div className="g grid grid-cols-1 sm:grid-cols-2 gap-3">
              {CHAIR_PHRASES.map(p => (
                <div key={p.kind} className="p rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                  <b className="block text-xs uppercase tracking-wide text-primary-600 dark:text-primary-400">{p.kind}</b>
                  <span className="text-sm text-gray-900 dark:text-white">{p.example}</span>
                </div>
              ))}
            </div>
            <div className="a mt-3 rounded-lg bg-primary-50 dark:bg-primary-900/30 p-3 text-sm text-gray-900 dark:text-white">
              <strong>For every action, ask out loud:</strong> "Who owns it?" and "By when?" For a risk, also ask "Who's watching it?"
            </div>
            <p className="m mt-3 text-sm text-gray-600 dark:text-gray-300">Last 2 minutes: read back the actions with owners and dates. This also catches anything the transcript missed.</p>
            <p className="m mt-1 text-sm text-gray-600 dark:text-gray-300">In Teams, switch on transcription at the start: More → Record and transcribe → Start transcription.</p>
          </div>
          {printBlocked && <p role="alert" className="text-sm text-red-600 dark:text-red-400">Your browser blocked the print window. Allow pop-ups for this site and try again.</p>}
        </div>
      </div>
    </div>
  );
};
