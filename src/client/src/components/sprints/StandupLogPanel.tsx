import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus, X, AlertTriangle, User, Trash2 } from 'lucide-react';
import { apiService } from '../../services/api';

interface StandupLogPanelProps {
  sprintId: string;
  projectId: string;
}

interface StandupEntry {
  id: string;
  userId: string;
  entryDate: string;
  yesterday: string | null;
  today: string | null;
  blockers: string[] | null;
  createdAt: string;
}

export function StandupLogPanel({ sprintId, projectId }: StandupLogPanelProps) {
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [yesterday, setYesterday] = useState('');
  const [today, setToday] = useState('');
  const [blockers, setBlockers] = useState<string[]>([]);
  const [newBlocker, setNewBlocker] = useState('');
  const [showForm, setShowForm] = useState(true);

  const { data, isLoading } = useQuery({
    queryKey: ['standups', sprintId, selectedDate],
    queryFn: () => apiService.getStandups(sprintId, selectedDate),
    enabled: !!sprintId,
  });

  const entries: StandupEntry[] = data?.entries || [];

  const submitMutation = useMutation({
    mutationFn: () =>
      apiService.submitStandup(sprintId, {
        projectId,
        entryDate: selectedDate,
        yesterday: yesterday || null,
        today: today || null,
        blockers: blockers.length > 0 ? blockers : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['standups', sprintId, selectedDate] });
      queryClient.invalidateQueries({ queryKey: ['standupTimeline', sprintId] });
      setYesterday('');
      setToday('');
      setBlockers([]);
      setShowForm(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (entryId: string) => apiService.deleteStandup(sprintId, entryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['standups', sprintId, selectedDate] });
      queryClient.invalidateQueries({ queryKey: ['standupTimeline', sprintId] });
    },
  });

  const shiftDate = useCallback((days: number) => {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toISOString().split('T')[0]);
  }, [selectedDate]);

  const addBlocker = () => {
    const text = newBlocker.trim();
    if (text && blockers.length < 20) {
      setBlockers([...blockers, text]);
      setNewBlocker('');
    }
  };

  const removeBlocker = (index: number) => {
    setBlockers(blockers.filter((_, i) => i !== index));
  };

  const handleBlockerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); addBlocker(); }
  };

  return (
    <div className="space-y-4">
      {/* Date picker */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => shiftDate(-1)}
          className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          tabIndex={0}
          aria-label="Previous day"
        >
          <ChevronLeft className="w-4 h-4 text-gray-500" />
        </button>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-1.5 text-sm"
        />
        <button
          onClick={() => shiftDate(1)}
          className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          tabIndex={0}
          aria-label="Next day"
        >
          <ChevronRight className="w-4 h-4 text-gray-500" />
        </button>
        <button
          onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])}
          className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
          tabIndex={0}
        >
          Today
        </button>
        <span className="text-xs text-gray-400 ml-auto">{entries.length} entr{entries.length === 1 ? 'y' : 'ies'}</span>
      </div>

      {/* My Standup Form */}
      {showForm ? (
        <div className="rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50/30 dark:bg-primary-900/10 p-4 space-y-3">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white">My Standup</h4>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">What did I do yesterday?</label>
            <textarea
              value={yesterday}
              onChange={(e) => setYesterday(e.target.value)}
              rows={3}
              maxLength={5000}
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm resize-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
              placeholder="Completed code review for feature X, fixed bug #123..."
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">What will I do today?</label>
            <textarea
              value={today}
              onChange={(e) => setToday(e.target.value)}
              rows={3}
              maxLength={5000}
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm resize-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
              placeholder="Start implementing feature Y, attend sprint planning..."
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Blockers
              {blockers.length > 0 && <span className="ml-1 text-red-500">({blockers.length})</span>}
            </label>
            {blockers.map((b, i) => (
              <div key={i} className="flex items-center gap-2 mb-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">{b}</span>
                <button
                  onClick={() => removeBlocker(i)}
                  className="p-0.5 text-gray-400 hover:text-red-500 transition-colors"
                  tabIndex={0}
                  role="button"
                  aria-label={`Remove blocker: ${b}`}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); removeBlocker(i); } }}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <input
                type="text"
                value={newBlocker}
                onChange={(e) => setNewBlocker(e.target.value)}
                onKeyDown={handleBlockerKeyDown}
                maxLength={500}
                placeholder="Add a blocker..."
                className="flex-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
              />
              <button
                onClick={addBlocker}
                disabled={!newBlocker.trim()}
                className="px-3 py-1.5 text-xs rounded-md bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50 disabled:opacity-40 transition-colors"
                tabIndex={0}
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setShowForm(false)}
              className="px-3 py-1.5 text-xs rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              tabIndex={0}
            >
              Cancel
            </button>
            <button
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending || (!yesterday.trim() && !today.trim())}
              className="px-4 py-1.5 text-xs rounded-md bg-primary-600 hover:bg-primary-700 text-white font-medium disabled:opacity-50 transition-colors"
              tabIndex={0}
            >
              {submitMutation.isPending ? 'Submitting...' : 'Submit Standup'}
            </button>
          </div>
          {submitMutation.isError && (
            <p className="text-xs text-red-500 mt-1">
              {(submitMutation.error as any)?.response?.data?.error || 'Failed to submit standup'}
            </p>
          )}
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="w-full py-3 rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400 hover:border-primary-300 dark:hover:border-primary-700 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
          tabIndex={0}
        >
          + Add My Standup
        </button>
      )}

      {/* Team entries */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 p-8 text-center">
          <User className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
          <p className="text-sm text-gray-500 dark:text-gray-400">No standups submitted for this date.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Team Standups</h4>
          {entries.map((entry) => (
            <div key={entry.id} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-full bg-primary-500 text-white flex items-center justify-center text-[9px] font-bold">
                  {entry.userId.substring(0, 2).toUpperCase()}
                </div>
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400 truncate">{entry.userId}</span>
                <button
                  onClick={() => deleteMutation.mutate(entry.id)}
                  className="ml-auto p-1 text-gray-400 hover:text-red-500 transition-colors"
                  title="Delete entry"
                  tabIndex={0}
                  role="button"
                  aria-label="Delete standup entry"
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); deleteMutation.mutate(entry.id); } }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {entry.yesterday && (
                <div className="mb-2">
                  <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Yesterday</span>
                  <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap mt-0.5">{entry.yesterday}</p>
                </div>
              )}
              {entry.today && (
                <div className="mb-2">
                  <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Today</span>
                  <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap mt-0.5">{entry.today}</p>
                </div>
              )}
              {entry.blockers && entry.blockers.length > 0 && (
                <div>
                  <span className="text-[10px] font-bold text-red-500 uppercase tracking-wide">Blockers</span>
                  <ul className="mt-0.5 space-y-0.5">
                    {entry.blockers.map((b, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-sm text-red-600 dark:text-red-400">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
