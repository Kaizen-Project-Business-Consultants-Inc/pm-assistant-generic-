import { useId, useMemo, useState } from 'react';

export interface ClientOption { id: string; name: string }

/** What the typed text means: no client, one of the company's clients, or a new client to add. */
type ClientChoice = { kind: 'none' } | { kind: 'existing'; id: string } | { kind: 'new'; name: string };

export function resolveClientChoice(text: string, clients: ClientOption[]): ClientChoice {
  const name = text.trim();
  if (!name) return { kind: 'none' };
  const match = clients.find(c => c.name.trim().toLowerCase() === name.toLowerCase());
  return match ? { kind: 'existing', id: match.id } : { kind: 'new', name };
}

interface Props {
  clients: ClientOption[];
  value: string;
  onChange: (text: string) => void;
  /** "Client" for consultants, "Department" for the Team and Enterprise plans (U50) */
  label: string;
  /** "client" / "department", in "+ Create …" and "No …" */
  lower?: string;
  /** The client list could not be read — don't claim there are none */
  listFailed?: boolean;
}

/**
 * Who a new project is for (Oct 2026, first-project step). One box: typing filters the company's
 * clients, offers "+ Create client" for a new name, and "No client" clears it. The typed text is
 * the value — resolveClientChoice turns it into none / existing / new, so typing a new name and
 * going on without picking anything still adds that client.
 */
export function ClientNameField({ clients, value, onChange, label, listFailed, lower = 'client' }: Props) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1); // nothing highlighted until an arrow key, so Enter never swaps a typed new name for a match

  const options = useMemo(() => {
    const q = value.trim().toLowerCase();
    const shown = clients.filter(c => !q || c.name.toLowerCase().includes(q)).slice(0, 8);
    const exact = clients.some(c => c.name.trim().toLowerCase() === q);
    return [
      ...shown.map(c => ({ key: c.id, text: c.name, pick: c.name, create: false })),
      ...(q && !exact ? [{ key: '__new', text: `+ Create ${lower} "${value.trim()}"`, pick: value.trim(), create: true }] : []),
      { key: '__none', text: lower === 'client' ? 'No client (internal project)' : `No ${lower}`, pick: '', create: false },
    ];
  }, [clients, value, lower]);

  const choose = (i: number) => { onChange(options[i].pick); setOpen(false); setActive(-1); };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (open ? Math.min(a + 1, options.length - 1) : 0)); setOpen(true); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && open && active >= 0) { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape') setOpen(false);
  };
  const listId = `${uid}-list`;

  return (
    <div className="relative">
      <label htmlFor={`${uid}-input`} className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
        {label} <span className="font-normal text-gray-500 dark:text-gray-400">(optional)</span>
      </label>
      <input
        id={`${uid}-input`}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${uid}-opt-${active}` : undefined}
        aria-describedby={`${uid}-help`}
        autoComplete="off"
        value={value}
        maxLength={255}
        placeholder="e.g. Acme Bank"
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => { setOpen(true); setActive(-1); }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="input"
      />
      {open && (
        <ul id={listId} role="listbox" aria-label={label} onMouseDown={(e) => e.preventDefault()}
          className="absolute z-10 mt-1 w-full max-h-60 overflow-auto rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg">
          {clients.length === 0 && !listFailed && !value.trim() && (
            <li role="presentation" className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">You have no {lower}s yet — type a name to add one</li>
          )}
          {options.map((o, i) => (
            <li key={o.key} id={`${uid}-opt-${i}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); choose(i); }}
              onMouseEnter={() => setActive(i)}
              className={`px-3 py-2 text-sm cursor-pointer ${i === active ? 'bg-primary-50 dark:bg-primary-900/30' : ''} ${o.create ? 'font-semibold text-primary-700 dark:text-primary-300' : 'text-gray-700 dark:text-gray-200'}`}>
              {o.text}
            </li>
          ))}
        </ul>
      )}
      <p id={`${uid}-help`} className="mt-1 text-xs text-gray-600 dark:text-gray-400">
        Who is this project for? Type a name to add a new client — or leave blank.
      </p>
    </div>
  );
}
