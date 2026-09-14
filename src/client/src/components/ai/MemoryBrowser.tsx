import React, { useState, useEffect, useCallback } from 'react';
import { apiService } from '../../services/api';
import { Search, History, Edit3, Trash2, RotateCcw, User, Building2, FolderOpen } from 'lucide-react';

interface VersionedMemory {
  id: string;
  agentId: string;
  memoryType: string;
  entityId: string | null;
  keyName: string;
  value: unknown;
  version: number;
  versionHash: string | null;
  createdBy: string | null;
  source: string | null;
  permissionScope: string | null;
  isApproved: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ChangeLogEntry {
  id: string;
  action: string;
  oldValue: unknown;
  newValue: unknown;
  changedBy: string;
  createdAt: string;
}

const SCOPE_ICONS: Record<string, React.ReactNode> = {
  org: <Building2 className="w-3.5 h-3.5" />,
  project: <FolderOpen className="w-3.5 h-3.5" />,
  user: <User className="w-3.5 h-3.5" />,
};

const SCOPE_COLORS: Record<string, string> = {
  org: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  project: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  user: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
};

export const MemoryBrowser: React.FC = () => {
  const [memories, setMemories] = useState<VersionedMemory[]>([]);
  const [search, setSearch] = useState('');
  const [selectedMemory, setSelectedMemory] = useState<VersionedMemory | null>(null);
  const [history, setHistory] = useState<ChangeLogEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [error, setError] = useState('');
  const [conflictMemory, setConflictMemory] = useState<VersionedMemory | null>(null);

  const loadMemories = useCallback(async () => {
    try {
      const res = await apiService.listVersionedMemories();
      setMemories(res.memories || []);
    } catch {
      setError('Failed to load memories');
    }
  }, []);

  useEffect(() => { loadMemories(); }, [loadMemories]);

  const filtered = memories.filter(m => {
    if (!search) return true;
    const s = search.toLowerCase();
    return m.keyName.toLowerCase().includes(s) ||
      m.agentId.toLowerCase().includes(s) ||
      JSON.stringify(m.value).toLowerCase().includes(s);
  });

  const handleViewHistory = async (memory: VersionedMemory) => {
    setSelectedMemory(memory);
    setShowHistory(true);
    try {
      const res = await apiService.getMemoryHistory(memory.id);
      setHistory(res.history || []);
    } catch {
      setHistory([]);
    }
  };

  const handleEdit = (memory: VersionedMemory) => {
    setSelectedMemory(memory);
    setEditing(true);
    setEditValue(JSON.stringify(memory.value, null, 2));
    setConflictMemory(null);
  };

  const handleSaveEdit = async () => {
    if (!selectedMemory) return;
    setError('');
    try {
      const parsed = JSON.parse(editValue);
      const res = await apiService.updateVersionedMemory(selectedMemory.id, {
        value: parsed,
        versionHash: selectedMemory.versionHash || '',
      });

      if (res.error && res.current) {
        // Conflict
        setConflictMemory(res.current);
        setError('Version conflict - memory was modified by another user. Review the current version below.');
        return;
      }

      setEditing(false);
      setConflictMemory(null);
      await loadMemories();
    } catch (err: any) {
      if (err?.response?.status === 409) {
        setConflictMemory(err.response.data.current);
        setError('Version conflict - memory was modified. Refresh and try again.');
      } else {
        setError('Failed to save: ' + (err?.message || 'Invalid JSON'));
      }
    }
  };

  const handleDelete = async (memory: VersionedMemory) => {
    if (!confirm(`Delete memory "${memory.keyName}"?`)) return;
    try {
      await apiService.deleteVersionedMemory(memory.id);
      await loadMemories();
      if (selectedMemory?.id === memory.id) {
        setSelectedMemory(null);
        setShowHistory(false);
        setEditing(false);
      }
    } catch {
      setError('Failed to delete memory');
    }
  };

  const handleRollback = async (memory: VersionedMemory) => {
    if (!confirm(`Rollback "${memory.keyName}" to previous version?`)) return;
    try {
      await apiService.rollbackMemory(memory.id);
      await loadMemories();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to rollback');
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">AI Memory Browser</h2>
          <span className="text-sm text-gray-500">{filtered.length} memories</span>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search memories by key, agent, or value..."
            className="w-full pl-10 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100"
          />
        </div>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        {/* Memory list */}
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {filtered.map(memory => (
            <div
              key={memory.id}
              className={`p-3 rounded-lg border transition-colors cursor-pointer ${
                selectedMemory?.id === memory.id
                  ? 'border-primary-300 bg-primary-50 dark:border-primary-700 dark:bg-primary-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750'
              }`}
              onClick={() => setSelectedMemory(memory)}
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{memory.keyName}</span>
                    {memory.permissionScope && (
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${SCOPE_COLORS[memory.permissionScope] || ''}`}>
                        {SCOPE_ICONS[memory.permissionScope]}
                        {memory.permissionScope}
                      </span>
                    )}
                    <span className="text-xs text-gray-500">v{memory.version}</span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {memory.agentId} / {memory.memoryType}
                    {memory.source && <> &middot; source: {memory.source}</>}
                  </p>
                </div>

                <div className="flex items-center gap-1 ml-2">
                  <button
                    onClick={e => { e.stopPropagation(); handleViewHistory(memory); }}
                    className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    title="View history"
                  >
                    <History className="w-4 h-4" />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); handleEdit(memory); }}
                    className="p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
                    title="Edit"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); handleRollback(memory); }}
                    className="p-1 text-gray-400 hover:text-amber-600 dark:hover:text-amber-400"
                    title="Rollback"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(memory); }}
                    className="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Value preview */}
              <pre className="mt-2 text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900 rounded p-2 max-h-20 overflow-hidden">
                {JSON.stringify(memory.value, null, 2).slice(0, 200)}
              </pre>
            </div>
          ))}

          {filtered.length === 0 && (
            <p className="text-center text-sm text-gray-500 py-8">
              {search ? 'No memories match your search.' : 'No AI memories stored yet.'}
            </p>
          )}
        </div>
      </div>

      {/* Edit modal */}
      {editing && selectedMemory && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
          <h3 className="text-md font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Editing: {selectedMemory.keyName}
          </h3>
          <textarea
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            rows={10}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm font-mono text-gray-900 dark:text-gray-100"
          />

          {conflictMemory && (
            <div className="mt-3 p-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300 mb-1">Current server version (v{conflictMemory.version}):</p>
              <pre className="text-xs text-amber-700 dark:text-amber-400 overflow-auto max-h-32">
                {JSON.stringify(conflictMemory.value, null, 2)}
              </pre>
            </div>
          )}

          <div className="flex gap-2 mt-3">
            <button
              onClick={handleSaveEdit}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700"
            >
              Save
            </button>
            <button
              onClick={() => { setEditing(false); setConflictMemory(null); setError(''); }}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* History sidebar */}
      {showHistory && selectedMemory && !editing && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-md font-semibold text-gray-900 dark:text-gray-100">
              History: {selectedMemory.keyName}
            </h3>
            <button onClick={() => setShowHistory(false)} className="text-sm text-gray-500 hover:text-gray-700">Close</button>
          </div>

          <div className="space-y-3">
            {history.map(entry => (
              <div key={entry.id} className="p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                    entry.action === 'create' ? 'bg-green-100 text-green-700' :
                    entry.action === 'update' ? 'bg-blue-100 text-blue-700' :
                    entry.action === 'delete' ? 'bg-red-100 text-red-700' :
                    'bg-amber-100 text-amber-700'
                  }`}>
                    {entry.action}
                  </span>
                  <span className="text-xs text-gray-500">{new Date(entry.createdAt).toLocaleString()}</span>
                </div>
                {entry.newValue != null && (
                  <pre className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900 rounded p-2 mt-1 max-h-24 overflow-auto">
                    {JSON.stringify(entry.newValue, null, 2).slice(0, 300)}
                  </pre>
                )}
              </div>
            ))}

            {history.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">No history available.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
