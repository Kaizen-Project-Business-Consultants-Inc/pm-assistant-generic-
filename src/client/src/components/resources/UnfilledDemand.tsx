import { formatCalendarDate } from '../../utils/dateUtils';
import { GenericBadge } from './ResourceBadges';

export interface DemandRow {
  resourceId: string;
  resourceName: string;
  role: string;
  weeks: Array<{ weekStart: string; hours: number; people: number }>;
}

const MAX_WEEKS = 12;
const week = (d: string) => formatCalendarDate(d, { day: 'numeric', month: 'short' });

/**
 * Work booked to generic roles, per week, as the number of people it needs. Not counted as
 * over-booking anywhere — it's staffing still to do. The PM replaces each role with real people.
 */
export function UnfilledDemand({ rows, canEdit, onReplace }: {
  rows: DemandRow[];
  canEdit: boolean;
  onReplace: (row: DemandRow) => void;
}) {
  if (rows.length === 0) return null;
  // Only the weeks that need someone, so the table stays readable
  // eslint-disable-next-line no-restricted-syntax -- small: each row filters only its own weeks
  const weeks = [...new Set(rows.flatMap(r => r.weeks.filter(w => w.people > 0).map(w => w.weekStart)))].sort().slice(0, MAX_WEEKS);
  const peopleIn = (r: DemandRow, w: string) => r.weeks.find(x => x.weekStart === w)?.people ?? 0;
  const peak = rows
    .flatMap(r => r.weeks.map(w => ({ role: r.resourceName, ...w })))
    .sort((a, b) => b.people - a.people)[0];

  return (
    <section aria-labelledby="unfilled-demand-heading" className="rounded-xl border border-orange-300 dark:border-orange-700/60 bg-white dark:bg-gray-800 p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
        <h3 id="unfilled-demand-heading" className="text-base font-semibold text-gray-900 dark:text-white">Unfilled demand</h3>
        <p className="text-xs text-gray-600 dark:text-gray-400">Work still on a generic role — not counted as over-booking. Replace each role with real people before the work starts.</p>
      </div>
      {weeks.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">The generic roles here have no dated work.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-sm min-w-full">
            <thead>
              <tr>
                <th scope="col" className="text-left font-semibold text-gray-600 dark:text-gray-300 pr-4 pb-2">Role</th>
                {weeks.map(w => <th key={w} scope="col" className="text-left font-semibold text-gray-600 dark:text-gray-300 px-1.5 pb-2 whitespace-nowrap">{week(w)}</th>)}
                {canEdit && <th scope="col" className="pb-2"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.resourceId}>
                  <th scope="row" className="text-left font-semibold text-gray-900 dark:text-white pr-4 py-1.5 whitespace-nowrap">
                    <span className="inline-flex items-center gap-2">{r.resourceName} <GenericBadge /></span>
                  </th>
                  {weeks.map(w => {
                    const n = peopleIn(r, w);
                    return (
                      <td key={w} className="px-1.5 py-1.5">
                        {n > 0
                          ? <span className="block rounded-md border border-dashed border-orange-600 dark:border-orange-400 px-2 py-1 text-orange-800 dark:text-orange-200 whitespace-nowrap">{n} {n === 1 ? 'person' : 'people'}</span>
                          : <span className="block rounded-md bg-gray-100 dark:bg-gray-700/60 px-2 py-1 text-gray-500 dark:text-gray-400">—</span>}
                      </td>
                    );
                  })}
                  {canEdit && (
                    <td className="pl-3 py-1.5">
                      <button
                        onClick={() => onReplace(r)}
                        className="px-3 py-1.5 text-xs font-semibold rounded-md text-white bg-primary-600 hover:bg-primary-700 whitespace-nowrap"
                      >
                        Replace…
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {peak && peak.people > 1 && (
        <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">
          In the week of {week(peak.weekStart)} you need {peak.people} people for {peak.role} that you haven't named yet.
        </p>
      )}
    </section>
  );
}
