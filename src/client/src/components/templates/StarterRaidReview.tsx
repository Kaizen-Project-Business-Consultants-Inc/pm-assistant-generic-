/**
 * "Starter RAID: review" (UAT U10, 2026-10-14): the risks, assumptions, dependencies and actions a
 * template brings, shown before the project is created — all ticked; untick any that don't apply.
 */
export interface StarterRaidItem {
  type: string;
  title: string;
  description?: string;
}

const TYPE_LABEL: Record<string, string> = { risk: 'Risk', issue: 'Issue', action: 'Action', assumption: 'Assumption', dependency: 'Dependency', decision: 'Decision' };

export function StarterRaidReview({ items, selected, onToggle }: { items: StarterRaidItem[]; selected: Set<number>; onToggle: (index: number) => void }) {
  if (items.length === 0) return null;
  return (
    <fieldset className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <legend className="float-left w-full px-3 pt-2.5 bg-gray-50 dark:bg-gray-700/50 text-xs font-semibold text-gray-800 dark:text-gray-100">Starter RAID: review ({selected.size}/{items.length} kept)</legend>
      <p className="clear-both px-3 pb-2.5 bg-gray-50 dark:bg-gray-700/50 text-xs text-gray-600 dark:text-gray-300">Typical risks, assumptions and dependencies for this kind of project. Untick any that don&rsquo;t apply.</p>
      <ul className="max-h-52 overflow-y-auto border-t border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
        {items.map((item, i) => (
          // keyed by position: the list never reorders, and titles can repeat on a custom template
          <li key={i}>
            <label className="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40">
              <input type="checkbox" checked={selected.has(i)} onChange={() => onToggle(i)}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" />
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-gray-900 dark:text-white">
                  <span className="text-gray-600 dark:text-gray-300 font-medium">{TYPE_LABEL[item.type] ?? item.type}: </span>{item.title}
                </span>
                {item.description && <span className="block text-xs text-gray-600 dark:text-gray-300">{item.description}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
