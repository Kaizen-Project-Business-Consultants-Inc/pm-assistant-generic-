import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { apiService } from '../../services/api';

interface TaskAssignment {
  id: string;
  resourceId: string;
  allocationPct: number;
  roleOnTask?: string;
  hoursPlanned?: number;
}

interface Resource {
  id: string;
  name: string;
  role: string;
}

interface ResourceQuickAssignProps {
  taskId: string;
  assignments: TaskAssignment[];
  onUpdate: (taskId: string, data: Record<string, unknown>) => void;
}

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

export function ResourceQuickAssign({ taskId, assignments, onUpdate }: ResourceQuickAssignProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data } = useQuery({
    queryKey: ['resources'],
    queryFn: () => apiService.getResources(),
    staleTime: 60_000,
  });
  const resources: Resource[] = data?.resources || [];

  // Build a lookup map
  const resourceMap = new Map(resources.map(r => [r.id, r]));

  // Resources not yet assigned
  const assignedIds = new Set(assignments.map(a => a.resourceId));
  const available = resources.filter(r =>
    !assignedIds.has(r.id) &&
    (search === '' || r.name.toLowerCase().includes(search.toLowerCase()) || r.role.toLowerCase().includes(search.toLowerCase()))
  );

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function handleAdd(resourceId: string) {
    const newAssignments = [
      ...assignments.map(a => ({ resourceId: a.resourceId, allocationPct: a.allocationPct, roleOnTask: a.roleOnTask, hoursPlanned: a.hoursPlanned })),
      { resourceId },
    ];
    onUpdate(taskId, { assignments: newAssignments });
    setOpen(false);
    setSearch('');
  }

  function handleRemove(resourceId: string) {
    const newAssignments = assignments
      .filter(a => a.resourceId !== resourceId)
      .map(a => ({ resourceId: a.resourceId, allocationPct: a.allocationPct, roleOnTask: a.roleOnTask, hoursPlanned: a.hoursPlanned }));
    onUpdate(taskId, { assignments: newAssignments });
  }

  return (
    <div className="flex items-center gap-0.5 w-full min-w-0 relative" ref={dropdownRef}>
      {/* Assigned resource chips */}
      {assignments.map(a => {
        const res = resourceMap.get(a.resourceId);
        const name = res?.name || a.resourceId.slice(0, 6);
        return (
          <div
            key={a.resourceId}
            className="group flex items-center gap-0.5 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full pl-1 pr-0.5 py-0 text-[10px] font-medium max-w-[72px] shrink-0"
            title={`${res?.name || a.resourceId} (${a.allocationPct}%)`}
          >
            <span className="truncate">{getInitials(name)}</span>
            <button
              className="opacity-0 group-hover:opacity-100 p-0 text-primary-400 hover:text-red-500 transition-opacity"
              onClick={(e) => { e.stopPropagation(); handleRemove(a.resourceId); }}
              title="Remove"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        );
      })}

      {/* Add button */}
      <button
        className="w-4 h-4 rounded-full flex items-center justify-center text-gray-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors shrink-0"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        title="Assign resource"
      >
        <Plus className="w-3 h-3" />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 w-52 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden">
          <div className="p-1.5">
            <input
              ref={inputRef}
              type="text"
              className="w-full text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 outline-none focus:border-primary-400"
              placeholder="Search resources..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()}
              onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); setSearch(''); } }}
            />
          </div>
          <div className="max-h-40 overflow-y-auto">
            {available.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-400 text-center">
                {resources.length === 0 ? 'No resources' : 'No matches'}
              </div>
            ) : (
              available.slice(0, 20).map(r => (
                <button
                  key={r.id}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-primary-50 dark:hover:bg-primary-900/30 flex items-center gap-2 transition-colors"
                  onClick={(e) => { e.stopPropagation(); handleAdd(r.id); }}
                >
                  <div className="w-5 h-5 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 flex items-center justify-center text-[8px] font-bold shrink-0">
                    {getInitials(r.name)}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 dark:text-white truncate">{r.name}</div>
                    <div className="text-gray-400 dark:text-gray-500 truncate">{r.role}</div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
