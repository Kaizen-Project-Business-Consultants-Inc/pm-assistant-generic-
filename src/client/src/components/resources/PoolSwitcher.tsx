import { MY_RESOURCES } from '../../utils/clientPools';

/**
 * Which pool Resources is showing (U8): one client's people, rates and holidays, or "My
 * resources" — the consultant's own people, usable on every client's projects.
 */
export function PoolSwitcher({ clients, value, onChange }: {
  clients: Array<{ id: string; name: string }>;
  value: string;
  onChange: (pool: string) => void;
}) {
  const options = [...clients.map(c => ({ id: c.id, name: c.name })), { id: MY_RESOURCES, name: 'My resources' }];
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <span className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Pool</span>
      <div role="group" aria-label="Choose a pool" className="flex flex-wrap gap-1 p-1 rounded-xl bg-gray-100 dark:bg-gray-800">
        {options.map(o => {
          const on = o.id === value;
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o.id)}
              className={`min-h-[40px] px-4 rounded-lg text-sm transition-colors ${on
                ? 'card-stripe stripe-teal bg-white dark:bg-gray-700 shadow font-bold text-gray-900 dark:text-white'
                : 'font-semibold text-gray-600 dark:text-gray-300 hover:bg-white/60 dark:hover:bg-gray-700/60'}`}
            >
              {o.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
