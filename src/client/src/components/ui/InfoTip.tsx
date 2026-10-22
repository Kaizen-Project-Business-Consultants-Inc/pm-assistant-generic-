import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * A small ⓘ that opens a short help box: what the feature is and when to use it, with an optional
 * link to the user guide (U64, approved mock https://claude.ai/artifact/D94EMU7a1MfJDvcQPMjeGk).
 * Opens on hover, on tap/click and on Enter/Space; Escape or a click elsewhere closes it. The same
 * box everywhere, so help looks and works one way.
 */
export function InfoTip({ title, children, guide, align = 'left' }: {
  /** The feature's name, the box's heading and the button's accessible name ("About …") */
  title: string;
  /** One or two plain sentences */
  children: ReactNode;
  /** A user-guide path, e.g. "/help/guide#working-calendar" */
  guide?: string;
  /** Which edge of the ⓘ the box lines up with */
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const boxId = useId();
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !root.current?.contains(e.target as Node)) {
        // Escape from inside the box (e.g. on the guide link) puts focus back on the ⓘ, not the page
        if (e instanceof KeyboardEvent && root.current?.contains(document.activeElement)) button.current?.focus();
        setOpen(false);
        setPinned(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <span
      ref={root}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => { if (!pinned) setOpen(false); }}
    >
      <button
        ref={button}
        type="button"
        aria-label={`About ${title}`}
        aria-expanded={open}
        aria-controls={boxId}
        // a click keeps it open after the mouse leaves; a second click closes it
        onClick={() => { const show = !(open && pinned); setOpen(show); setPinned(show); }}
        className="inline-grid place-items-center w-[18px] h-[18px] rounded-full border-[1.5px] border-primary-600 text-primary-700 dark:border-primary-400 dark:text-primary-300 text-xs font-bold leading-none hover:bg-primary-50 dark:hover:bg-primary-900/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
      >
        i
      </button>
      {open && (
        // the gap above the box is padding of this wrapper, so the mouse can cross it without closing the box
        <span className={`absolute top-full pt-2 z-50 ${align === 'right' ? 'right-0' : 'left-0'}`}>
          <span
            id={boxId}
            role="note"
            className="block w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 text-left text-xs font-normal normal-case tracking-normal text-gray-700 dark:text-gray-200 shadow-lg"
          >
            <span className="block mb-1 text-sm font-semibold text-gray-900 dark:text-white">{title}</span>
            <span className="block leading-relaxed">{children}</span>
            {guide && (
              <Link to={guide} className="mt-2 inline-block font-medium text-primary-700 dark:text-primary-300 hover:underline">
                More in the user guide →
              </Link>
            )}
          </span>
        </span>
      )}
    </span>
  );
}
