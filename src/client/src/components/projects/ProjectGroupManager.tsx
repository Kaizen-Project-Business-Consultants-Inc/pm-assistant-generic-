import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Plus, Trash2, GripVertical } from 'lucide-react';
import { apiService } from '../../services/api';

interface ProjectGroup {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  sortOrder: number;
}

const COLORS = ['#6366f1', '#3b82f6', '#059669', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#78716c'];

export function ProjectGroupManager({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(COLORS[0]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  const { data } = useQuery<{ groups: ProjectGroup[] }>({
    queryKey: ['project-groups'],
    queryFn: () => apiService.getProjectGroups(),
    enabled: isOpen,
  });

  const groups = data?.groups || [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['project-groups'] });

  const createMut = useMutation({
    mutationFn: () => apiService.createProjectGroup({ name: newName, color: newColor }),
    onSuccess: () => { setNewName(''); invalidate(); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, name, color }: { id: string; name: string; color: string }) =>
      apiService.updateProjectGroup(id, { name, color }),
    onSuccess: () => { setEditingId(null); invalidate(); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiService.deleteProjectGroup(id),
    onSuccess: invalidate,
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Manage Groups</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Group list */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {groups.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">No groups yet. Create one below.</p>
          )}
          {groups.map(g => (
            <div key={g.id} className="flex items-center gap-2 py-2 px-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 group">
              <GripVertical className="w-4 h-4 text-gray-300 dark:text-gray-600 flex-shrink-0" />
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: g.color }} />
              {editingId === g.id ? (
                <>
                  <input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className="flex-1 text-sm border rounded px-2 py-1 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Enter') updateMut.mutate({ id: g.id, name: editName, color: editColor });
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                  <div className="flex gap-1">
                    {COLORS.map(c => (
                      <button
                        key={c}
                        onClick={() => setEditColor(c)}
                        className={`w-4 h-4 rounded-full border-2 ${editColor === c ? 'border-gray-900 dark:border-white' : 'border-transparent'}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                  <button
                    onClick={() => updateMut.mutate({ id: g.id, name: editName, color: editColor })}
                    className="text-xs text-primary-600 hover:underline"
                  >
                    Save
                  </button>
                </>
              ) : (
                <>
                  <span
                    className="flex-1 text-sm text-gray-900 dark:text-gray-100 cursor-pointer"
                    onClick={() => { setEditingId(g.id); setEditName(g.name); setEditColor(g.color); }}
                  >
                    {g.name}
                  </span>
                  <button
                    onClick={() => deleteMut.mutate(g.id)}
                    className="p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Create new group */}
        <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="New group name"
              className="flex-1 text-sm border rounded-lg px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
              onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) createMut.mutate(); }}
            />
            <div className="flex gap-1">
              {COLORS.slice(0, 5).map(c => (
                <button
                  key={c}
                  onClick={() => setNewColor(c)}
                  className={`w-5 h-5 rounded-full border-2 ${newColor === c ? 'border-gray-900 dark:border-white' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <button
              onClick={() => { if (newName.trim()) createMut.mutate(); }}
              disabled={!newName.trim() || createMut.isPending}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
