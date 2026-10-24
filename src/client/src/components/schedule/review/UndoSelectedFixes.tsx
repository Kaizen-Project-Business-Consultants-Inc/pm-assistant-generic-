import { useEffect, useRef, useState } from 'react';
import { Loader2, Undo2 } from 'lucide-react';

/** One applied fix, as the panel words it */
export interface AppliedFixItem { id: string; text: string; kind: string }

/** What the last undo did, in words (built by the panel from the server's answer) */
export interface UndoSummary { text: string; detail: string; alsoPutBack: string | null }

interface Props {
  /** The fixes that are applied now */
  fixes: AppliedFixItem[];
  undoing: boolean;
  summary: UndoSummary | null;
  onUndo: (ids: string[]) => void;
}

type Mode = 'select' | 'ask' | 'done';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const SHOWN = 6;

/**
 * Put back all of the fixes just applied, or only the ones ticked (U80, mock approved 2026-10-24).
 * Nothing is ticked at first, so a stray click removes nothing. Both buttons ask first and list what
 * goes back (U54: a click on the spot where Apply was once removed 20 links). "Keep them" has the focus
 * and Escape closes only the question, never the panel. Only the newest Apply, while nothing else has
 * changed, can be undone: the server answers when it no longer can, and the panel shows its words.
 */
export function UndoSelectedFixes({ fixes, undoing, summary, onUndo }: Props) {
  const [mode, setMode] = useState<Mode>('select');
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [askIds, setAskIds] = useState<string[]>([]);
  const opener = useRef<'sel' | 'all'>('sel');
  const selRef = useRef<HTMLButtonElement>(null);
  const allRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const selectAllRef = useRef<HTMLButtonElement>(null);
  const previous = useRef<Mode>('select');

  // an undo just finished: show what it did (the fixes that stay are in `fixes`)
  useEffect(() => { if (summary) { setMode('done'); setTicked(new Set()); } }, [summary]);

  // focus follows the step: the safe answer when asking, the result when done, the opener when the question closes
  useEffect(() => {
    if (mode === 'ask') keepRef.current?.focus();
    else if (mode === 'done') resultRef.current?.focus();
    else if (previous.current === 'ask') (opener.current === 'all' ? allRef : selRef).current?.focus();
    else if (previous.current === 'done') selectAllRef.current?.focus();
    previous.current = mode;
  }, [mode]);

  // Escape closes only the question: caught before the panel's own Escape handler, which would close the whole panel
  useEffect(() => {
    if (mode !== 'ask') return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setMode('select'); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [mode]);

  const ids = fixes.map(f => f.id);
  const live = new Set(ids);
  const picked = [...ticked].filter(id => live.has(id));
  const toggle = (id: string) => setTicked(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const ask = (which: 'sel' | 'all') => { opener.current = which; setAskIds(which === 'all' ? ids : picked); setMode('ask'); };
  const textOf = new Map(fixes.map(f => [f.id, f.text]));

  const button = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed';

  if (mode === 'done' && summary) {
    return (
      <div className="space-y-2">
        <div ref={resultRef} tabIndex={-1} role="status" className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200 text-sm space-y-1 outline-none">
          <p className="font-semibold">{summary.text}</p>
          <p>{summary.detail}</p>
          {summary.alsoPutBack && <p>{summary.alsoPutBack}</p>}
        </div>
        {fixes.length > 0 && (
          <>
            <details className="rounded-lg border border-gray-200 dark:border-gray-700 text-sm" open>
              <summary className="cursor-pointer px-3 py-2 font-medium text-gray-800 dark:text-gray-200">Still applied ({fixes.length})</summary>
              <ul className="px-3 pb-2 pl-7 list-disc text-xs text-gray-600 dark:text-gray-300 space-y-0.5">
                {fixes.slice(0, 8).map(f => <li key={f.id}>{f.text}</li>)}
                {fixes.length > 8 && <li>…and {fixes.length - 8} more</li>}
              </ul>
            </details>
            <button ref={moreRef} type="button" className={button} onClick={() => setMode('select')}>Undo more…</button>
          </>
        )}
      </div>
    );
  }

  if (mode === 'ask') {
    const whole = askIds.length === fixes.length;
    const stay = fixes.length - askIds.length;
    return (
      <div
        role="group"
        aria-labelledby="undo-some-question"
        className="space-y-2 text-sm"
      >
        <p id="undo-some-question" className="font-medium text-gray-900 dark:text-gray-100">
          {whole ? `Put back all ${fixes.length} fixes?` : `Put back ${plural(askIds.length, 'fix', 'fixes')}?`}
        </p>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Goes back</p>
          <ul className="pl-5 list-disc text-xs text-gray-700 dark:text-gray-200 space-y-0.5">
            {askIds.slice(0, SHOWN).map(id => <li key={id}>{textOf.get(id)}</li>)}
            {askIds.length > SHOWN && <li>…and {askIds.length - SHOWN} more</li>}
          </ul>
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-300">
          Dates and the project finish are worked out again from the fixes that stay; the result says what moved.
          {!whole && ` The other ${stay} ${stay === 1 ? 'fix stays' : 'fixes stay'} applied.`}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={undoing} onClick={() => onUndo(askIds)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60">
            {undoing ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />}
            {undoing ? 'Putting back…' : `Yes, put back ${askIds.length}`}
          </button>
          <button ref={keepRef} type="button" disabled={undoing} aria-describedby="undo-some-question" onClick={() => setMode('select')} className={button}>
            Keep them
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">Put some or all of the fixes back</p>
        <div className="flex items-center gap-2">
          <button ref={selectAllRef} type="button" disabled={undoing} className={button} onClick={() => setTicked(new Set(ids))}>Select all</button>
          <button type="button" disabled={undoing} className={button} onClick={() => setTicked(new Set())}>Select none</button>
        </div>
      </div>
      <ul role="group" aria-label="Fixes to put back" className="max-h-72 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800 bg-white dark:bg-gray-900">
        {fixes.map(f => (
          <li key={f.id} className={`flex items-start gap-2 px-3 py-1.5 ${ticked.has(f.id) ? 'bg-primary-50 dark:bg-primary-900/20' : ''}`}>
            <label className="flex flex-1 min-w-0 items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={ticked.has(f.id)} disabled={undoing} onChange={() => toggle(f.id)} aria-label={`Put back: ${f.text}`} className="mt-0.5" />
              <span className="min-w-0 text-sm text-gray-900 dark:text-gray-100 break-words">{f.text}</span>
            </label>
            <span className="shrink-0 mt-0.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{f.kind}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-gray-500 dark:text-gray-400" aria-live="polite">{picked.length} selected</p>
      <div className="flex flex-wrap gap-2">
        <button ref={selRef} type="button" disabled={undoing || picked.length === 0} onClick={() => ask('sel')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed">
          <Undo2 className="w-3.5 h-3.5" aria-hidden="true" /> Undo selected ({picked.length})
        </button>
        <button ref={allRef} type="button" disabled={undoing} onClick={() => ask('all')} className={button}>
          <Undo2 className="w-3.5 h-3.5" aria-hidden="true" /> Undo all ({fixes.length})
        </button>
      </div>
    </div>
  );
}
