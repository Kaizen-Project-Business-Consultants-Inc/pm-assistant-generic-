import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { apiService } from '../../services/api';

interface Resource {
  id: string;
  name: string;
  role: string;
  userId?: string | null;
}

interface ResourcePickerDropdownProps {
  value: string | null;
  onSelect: (userId: string, resourceName: string) => void;
  onClear: () => void;
  onClose: () => void;
}

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

export function ResourcePickerDropdown({ value, onSelect, onClear, onClose }: ResourcePickerDropdownProps) {
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data } = useQuery({
    queryKey: ['resources'],
    queryFn: () => apiService.getResources(),
    staleTime: 60_000,
  });
  const resources: Resource[] = data?.resources || [];

  const filtered = resources.filter(r =>
    search === '' ||
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.role.toLowerCase().includes(search.toLowerCase())
  );

  // Find current resource by userId match
  const currentResource = value ? resources.find(r => r.userId === value || r.id === value) : null;

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
            className="p-0.5 text-gray-400 hover:text-red-500 transition-colors"
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            title="Unassign"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Search */}
      <div className="p-1.5">
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
      </div>

      {/* Resource list */}
      <div className="max-h-48 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-2 text-xs text-gray-400 text-center">
            {resources.length === 0 ? 'No resources in project' : 'No matches'}
          </div>
        ) : (
          filtered.slice(0, 30).map(r => {
            const isSelected = currentResource?.id === r.id;
            return (
              <button
                key={r.id}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${isSelected ? 'bg-primary-50 dark:bg-primary-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(r.userId || r.id, r.name);
                }}
              >
                <div className="w-5 h-5 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 flex items-center justify-center text-[8px] font-bold shrink-0">
                  {getInitials(r.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-gray-900 dark:text-white truncate">{r.name}</div>
                  <div className="text-gray-400 dark:text-gray-500 truncate">{r.role}</div>
                </div>
                {isSelected && <span className="text-primary-600 text-[10px] font-medium">Current</span>}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
