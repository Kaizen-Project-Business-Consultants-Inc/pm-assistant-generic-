import { useEffect, useRef, useState } from 'react';
import { Loader2, Undo2 } from 'lucide-react';

/**
 * Undo for a batch of applied fixes — shown inside the result, never where Apply was (U54,
 * 2026-10-20: Apply took 2 s, then Undo appeared under the cursor and a second click removed the
 * 20 links just added). It asks first. Used by Propose fixes and RAID Review fixes.
 * States: closed → asking → (Keep them) closed, or (Yes, undo) undoing.
 * Focus: opening the question puts it on "Keep them" (the safe answer, announced with the
 * question); "Keep them" puts it back on the Undo button — never dropped on the page.
 */
export function UndoWithConfirm({ count, undoing, onUndo }: { count: number; undoing: boolean; onUndo: () => void }) {
  const [asking, setAsking] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(false);
  useEffect(() => {
    if (asking) keepRef.current?.focus();
    else if (wasAsking.current) undoRef.current?.focus();
    wasAsking.current = asking;
  }, [asking]);

  const one = count === 1;
  if (!asking) {
    return (
      <button ref={undoRef} type="button" onClick={() => setAsking(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800">
        <Undo2 className="w-3.5 h-3.5" aria-hidden="true" /> {one ? 'Undo this fix' : `Undo these ${count} fixes`}
      </button>
    );
  }
  const question = one ? 'Remove the fix you just applied?' : `Remove the ${count} fixes you just applied?`;
  return (
    <div role="group" aria-labelledby="undo-question" className="space-y-1.5">
      <p id="undo-question" className="font-medium text-gray-900 dark:text-gray-100">{question}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onUndo} disabled={undoing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60">
          {undoing ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />}
          {undoing ? 'Undoing…' : 'Yes, undo'}
        </button>
        <button ref={keepRef} type="button" onClick={() => setAsking(false)} disabled={undoing} aria-describedby="undo-question"
          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-60">
          {one ? 'Keep it' : 'Keep them'}
        </button>
      </div>
    </div>
  );
}
