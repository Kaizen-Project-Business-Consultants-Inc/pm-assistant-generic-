import { useRef, useState } from 'react';

const OPTIONS = [
  { value: 'planning', label: 'Planning' },
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
] as const;

/** Keys that move through a closed native select without the user choosing anything yet. */
const BROWSE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);

interface ProjectStatusSelectProps {
  value: string;
  /** Pill colours for the current status. */
  colorClass: string;
  pending: boolean;
  /** Called once the user has really chosen a different status. */
  onCommit: (status: string) => void;
}

/**
 * The project-header status pill. A closed native select changes value on every arrow key,
 * so saving on `change` would save (and open close-out / cancel) while a keyboard user is
 * only looking. Arrow keys here only browse; the choice is made by Enter, by leaving the
 * control with a different status showing, or by picking with the mouse. Escape puts the
 * saved status back. It stays focusable while saving (aria-busy, not disabled), so focus
 * is never dropped to the page.
 */
export function ProjectStatusSelect({ value, colorClass, pending, onCommit }: ProjectStatusSelectProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const browsingByKey = useRef(false);
  const shown = draft ?? value;

  const commit = (next: string) => {
    setDraft(null);
    if (pending || next === value) return;
    onCommit(next);
  };

  return (
    <select
      value={shown}
      aria-label="Project status"
      aria-busy={pending || undefined}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit(shown);
        } else if (e.key === 'Escape' && draft !== null) {
          e.preventDefault();
          setDraft(null);
        } else {
          // Arrows and type-ahead letters only browse; Space just opens the list
          browsingByKey.current = BROWSE_KEYS.has(e.key) || (e.key.length === 1 && e.key !== ' ');
        }
      }}
      onChange={(e) => {
        const next = e.target.value;
        if (browsingByKey.current) {
          browsingByKey.current = false;
          setDraft(next);
        } else {
          commit(next);
        }
      }}
      onMouseDown={() => { browsingByKey.current = false; }}
      onBlur={(e) => {
        browsingByKey.current = false;
        // Moving on to another control saves what is showing; switching window or clicking
        // nothing in particular does not — the browsed status is just put back
        if (draft !== null && e.relatedTarget) commit(draft);
        else setDraft(null);
      }}
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium cursor-pointer border border-current border-opacity-30 outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-1 dark:focus-visible:ring-primary-400 dark:focus-visible:ring-offset-gray-900 pr-5 ${colorClass} ${pending ? 'opacity-60' : 'hover:opacity-80'}`}
    >
      {OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
