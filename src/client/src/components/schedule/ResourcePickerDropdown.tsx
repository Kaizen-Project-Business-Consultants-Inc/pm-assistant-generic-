import { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { apiService } from '../../services/api';
import { findResourceForAssignee } from '../../utils/resourceLookup';
import { ResourcePickList } from '../resources/ResourcePickList';
import { PROFICIENCY_LABELS } from '../../constants/proficiency';

interface SkillWithProficiency {
  name: string;
  level: number;
}

interface Resource {
  id: string;
  name: string;
  role: string;
  userId?: string | null;
  skills?: SkillWithProficiency[];
  isGeneric?: boolean;
}

interface ResourcePickerDropdownProps {
  value: string | null;
  onSelect: (userId: string, resourceName: string) => void;
  onClear: () => void;
  onClose: () => void;
  /**
   * Open in a layer above the page, placed under the cell it is in, instead of inside the cell.
   * For cells that clip what they hold (the Gantt grid: `truncate`, and a scrolling panel) — there
   * the list was cut off and no one could be picked (2026-10-04).
   */
  floating?: boolean;
}

/** w-56 */
const FLOAT_WIDTH = 224;
const EDGE = 8;

export function ResourcePickerDropdown({ value, onSelect, onClear, onClose, floating = false }: ResourcePickerDropdownProps) {
  const [search, setSearch] = useState('');
  const [skillFilter, setSkillFilter] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data } = useQuery({
    queryKey: ['resources'],
    queryFn: () => apiService.getResources(),
    staleTime: 60_000,
  });
  const resources: Resource[] = data?.resources || [];

  const allSkills = useMemo(() => {
    const names = new Set<string>();
    resources.forEach(r => (r.skills || []).forEach(s => { if (s.name.trim()) names.add(s.name.trim()); }));
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [resources]);

  const filtered = useMemo(() => {
    let list = resources.filter(r =>
      search === '' ||
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.role.toLowerCase().includes(search.toLowerCase())
    );
    if (skillFilter) {
      const lower = skillFilter.toLowerCase();
      list = list.filter(r => (r.skills || []).some(s => s.name.toLowerCase() === lower));
      list = [...list].sort((a, b) => {
        const aLevel = (a.skills || []).find(s => s.name.toLowerCase() === lower)?.level ?? 0;
        const bLevel = (b.skills || []).find(s => s.name.toLowerCase() === lower)?.level ?? 0;
        return bLevel - aLevel;
      });
    }
    return list;
  }, [resources, search, skillFilter]);

  // Find current resource by ID, falling back to a name match for imported schedules
  const currentResource = findResourceForAssignee(resources, value);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Floating: the cell the picker belongs to (a marker is left in it), and where to draw the list
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!floating) return;
    const place = () => {
      const cell = anchorRef.current?.parentElement;
      if (!cell) return;
      const r = cell.getBoundingClientRect();
      const h = dropdownRef.current?.offsetHeight ?? 0;
      const left = Math.max(EDGE, Math.min(r.left, window.innerWidth - FLOAT_WIDTH - EDGE));
      const below = r.bottom + 4;
      // no room below: open upwards
      const top = h > 0 && below + h > window.innerHeight - EDGE && r.top - 4 - h >= EDGE ? r.top - 4 - h : below;
      setPos(p => (p && p.top === top && p.left === left ? p : { top, left }));
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [floating, resources.length]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        // a press on the picker's own cell is not "outside" (the cell's click keeps it open)
        if (floating && anchorRef.current?.parentElement?.contains(target)) return;
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose, floating]);

  const panel = (
    <div
      ref={dropdownRef}
      className={`${floating ? 'fixed text-left' : 'absolute top-full left-0 mt-1'} z-50 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden`}
      // opacity (not visibility) until placed, so the search box can take focus straight away
      style={floating ? { top: pos?.top ?? 0, left: pos?.left ?? 0, opacity: pos ? 1 : 0 } : undefined}
    >
      {/* Current assignment */}
      {currentResource && (
        <div className="px-3 py-1.5 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <span className="text-xs text-gray-600 dark:text-gray-300 truncate">{currentResource.name}</span>
          <button
            className="p-0.5 text-gray-500 hover:text-red-500 transition-colors"
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            title="Unassign"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Search */}
      <div className="p-1.5 space-y-1">
        <input
          aria-label="Search resources"
          ref={inputRef}
          type="text"
          className="w-full text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 outline-none focus:border-primary-400"
          placeholder="Search resources..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          onClick={e => e.stopPropagation()}
          onKeyDown={e => {
            if (e.key === 'Escape') onClose();
            e.stopPropagation();
          }}
        />
        {allSkills.length > 0 && (
          <select
            aria-label="Filter by skill"
            value={skillFilter}
            onChange={e => { e.stopPropagation(); setSkillFilter(e.target.value); }}
            className="w-full text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 outline-none focus:border-primary-400"
            onClick={e => e.stopPropagation()}
          >
            <option value="">Filter by skill...</option>
            {allSkills.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>

      {/* Resource list */}
      <div className="max-h-48 overflow-y-auto">
        <ResourcePickList
          resources={filtered}
          currentId={currentResource?.id}
          onPick={(r) => onSelect(r.id, r.name)}
          emptyText={resources.length === 0 ? 'No resources in project' : 'No matches'}
          extra={(r) => {
            const matchedSkill = skillFilter ? (r.skills || []).find(s => s.name.toLowerCase() === skillFilter.toLowerCase()) : null;
            return matchedSkill ? (
              <span className="shrink-0 px-1.5 py-0.5 rounded text-xs font-medium bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
                {PROFICIENCY_LABELS[matchedSkill.level] || matchedSkill.level}
              </span>
            ) : null;
          }}
        />
      </div>
    </div>
  );

  if (!floating) return panel;
  return (
    <>
      <span ref={anchorRef} hidden />
      {createPortal(panel, document.body)}
    </>
  );
}
