import { useState, useRef, useEffect, useMemo } from 'react';
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
}

export function ResourcePickerDropdown({ value, onSelect, onClear, onClose }: ResourcePickerDropdownProps) {
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

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div ref={dropdownRef} className="absolute top-full left-0 mt-1 z-50 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden">
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
}
