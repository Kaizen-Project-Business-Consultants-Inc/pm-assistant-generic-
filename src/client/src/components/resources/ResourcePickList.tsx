import type { ReactNode } from 'react';
import { Avatar } from '../ui/Avatar';
import { GenericBadge } from './ResourceBadges';

export interface PickableResource {
  id: string;
  name: string;
  role?: string;
  isGeneric?: boolean;
}

/** People first, then generic roles — the order every assignee picker uses */
export function splitPeopleAndGeneric<T extends PickableResource>(list: T[]): { people: T[]; generic: T[] } {
  return { people: list.filter(r => !r.isGeneric), generic: list.filter(r => r.isGeneric) };
}

const heading = 'px-3 pt-2 pb-1 text-xs font-bold tracking-wide uppercase text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/40';

/**
 * The rows of an assignee picker (task form, Gantt/table cells): PEOPLE, then GENERIC ROLES, each
 * row a button. Shared so every picker groups and tags the same way.
 */
export function ResourcePickList<T extends PickableResource>({ resources, currentId, onPick, limit = 30, extra, emptyText }: {
  resources: T[];
  currentId?: string | null;
  onPick: (r: T) => void;
  limit?: number;
  /** Anything to show at the end of a row (e.g. the matched skill level) */
  extra?: (r: T) => ReactNode;
  emptyText: string;
}) {
  if (resources.length === 0) return <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 text-center">{emptyText}</div>;
  // Generic roles are a handful and always listed; the people list is capped
  const split = splitPeopleAndGeneric(resources);
  const people = split.people.slice(0, limit);
  const generic = split.generic;
  const row = (r: T) => {
    const selected = currentId === r.id;
    return (
      <button
        type="button"
        key={r.id}
        className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${selected ? 'bg-primary-50 dark:bg-primary-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}
        onClick={(e) => { e.stopPropagation(); onPick(r); }}
      >
        <Avatar name={r.name} size="xs" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-gray-900 dark:text-white truncate">{r.name}</div>
          {r.role && <div className="text-gray-500 dark:text-gray-400 truncate">{r.role}</div>}
        </div>
        {r.isGeneric && <GenericBadge className="shrink-0" />}
        {extra?.(r)}
        {selected && <span className="text-primary-600 text-xs font-medium">Current</span>}
      </button>
    );
  };
  return (
    <>
      {generic.length > 0 && people.length > 0 && <div className={heading}>People</div>}
      {people.map(row)}
      {generic.length > 0 && <div className={heading}>Generic roles</div>}
      {generic.map(row)}
    </>
  );
}

/** The same grouping for a plain <select>: <optgroup>s of people and generic roles */
export function ResourceOptionGroups<T extends PickableResource>({ resources }: { resources: T[] }) {
  const { people, generic } = splitPeopleAndGeneric(resources);
  const option = (r: T) => <option key={r.id} value={r.id}>{r.name}{r.role ? ` — ${r.role}` : ''}</option>;
  if (generic.length === 0) return <>{people.map(option)}</>;
  return (
    <>
      <optgroup label="People">{people.map(option)}</optgroup>
      <optgroup label="Generic roles">{generic.map(option)}</optgroup>
    </>
  );
}
