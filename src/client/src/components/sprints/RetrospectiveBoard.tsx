import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ThumbsUp, Trash2, ArrowRightCircle, Sparkles } from 'lucide-react';
import { apiService } from '../../services/api';

interface RetrospectiveBoardProps {
  sprintId: string;
  projectId: string;
  scheduleId: string;
}

interface RetroItem {
  id: string;
  category: 'went_well' | 'to_improve' | 'action_item';
  content: string;
  createdBy: string;
  voteCount: number;
  convertedTaskId: string | null;
  aiGenerated: boolean;
}

const COLUMNS = [
  { id: 'went_well' as const, label: 'Went Well', color: 'green', bg: 'bg-green-50 dark:bg-green-900/10', border: 'border-green-200 dark:border-green-800', headerBg: 'bg-green-100 dark:bg-green-900/30', headerText: 'text-green-700 dark:text-green-300' },
  { id: 'to_improve' as const, label: 'To Improve', color: 'amber', bg: 'bg-amber-50 dark:bg-amber-900/10', border: 'border-amber-200 dark:border-amber-800', headerBg: 'bg-amber-100 dark:bg-amber-900/30', headerText: 'text-amber-700 dark:text-amber-300' },
  { id: 'action_item' as const, label: 'Action Items', color: 'red', bg: 'bg-red-50 dark:bg-red-900/10', border: 'border-red-200 dark:border-red-800', headerBg: 'bg-red-100 dark:bg-red-900/30', headerText: 'text-red-700 dark:text-red-300' },
];

export function RetrospectiveBoard({ sprintId, projectId, scheduleId }: RetrospectiveBoardProps) {
  const queryClient = useQueryClient();
  const [newItemContent, setNewItemContent] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['retroBoard', sprintId],
    queryFn: () => apiService.getRetroBoard(sprintId),
    enabled: !!sprintId,
  });

  const items: RetroItem[] = data?.items || [];
  const userVotes: string[] = data?.userVotes || [];

  const addItemMutation = useMutation({
    mutationFn: ({ category, content }: { category: string; content: string }) =>
      apiService.addRetroItem(sprintId, { projectId, category, content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['retroBoard', sprintId] });
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: (itemId: string) => apiService.deleteRetroItem(sprintId, itemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['retroBoard', sprintId] }),
  });

  const voteMutation = useMutation({
    mutationFn: ({ itemId, hasVoted }: { itemId: string; hasVoted: boolean }) =>
      hasVoted ? apiService.unvoteRetroItem(sprintId, itemId) : apiService.voteRetroItem(sprintId, itemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['retroBoard', sprintId] }),
  });

  const seedMutation = useMutation({
    mutationFn: () => apiService.seedRetroFromAI(sprintId, projectId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['retroBoard', sprintId] }),
  });

  const convertMutation = useMutation({
    mutationFn: (itemId: string) => apiService.convertRetroItem(sprintId, itemId, scheduleId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['retroBoard', sprintId] }),
  });

  const handleAddItem = (category: string) => {
    const content = (newItemContent[category] || '').trim();
    if (!content) return;
    addItemMutation.mutate({ category, content });
    setNewItemContent((prev) => ({ ...prev, [category]: '' }));
  };

  if (isLoading) {
    return (
      <div className="flex gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex-1 h-64 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Retrospective Board</h4>
        <button
          onClick={() => seedMutation.mutate()}
          disabled={seedMutation.isPending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-900/50 disabled:opacity-50 transition-colors"
          tabIndex={0}
        >
          <Sparkles className="w-3.5 h-3.5" />
          {seedMutation.isPending ? 'Generating...' : 'AI Seed'}
        </button>
      </div>
      {seedMutation.isError && (
        <p className="text-xs text-red-500">{(seedMutation.error as any)?.response?.data?.error || 'AI seed failed'}</p>
      )}

      {/* 3-column board */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {COLUMNS.map((col) => {
          const columnItems = items.filter((i) => i.category === col.id);
          return (
            <div key={col.id} className={`rounded-lg border ${col.border} ${col.bg} min-h-[200px]`}>
              {/* Column header */}
              <div className={`px-3 py-2.5 ${col.headerBg} rounded-t-lg`}>
                <span className={`text-xs font-semibold uppercase tracking-wide ${col.headerText}`}>
                  {col.label}
                </span>
                <span className="ml-1.5 text-xs text-gray-400">{columnItems.length}</span>
              </div>

              {/* Items */}
              <div className="p-2 space-y-2">
                {columnItems.map((item) => {
                  const hasVoted = userVotes.includes(item.id);
                  return (
                    <div
                      key={item.id}
                      className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600 p-3 shadow-sm"
                    >
                      <p className="text-sm text-gray-800 dark:text-gray-200 mb-2 whitespace-pre-wrap">{item.content}</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => voteMutation.mutate({ itemId: item.id, hasVoted })}
                          className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full transition-colors ${
                            hasVoted
                              ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                          }`}
                          tabIndex={0}
                          role="button"
                          aria-label={hasVoted ? 'Remove vote' : 'Vote'}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); voteMutation.mutate({ itemId: item.id, hasVoted }); } }}
                        >
                          <ThumbsUp className="w-3 h-3" />
                          {item.voteCount}
                        </button>

                        {item.aiGenerated && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">
                            AI
                          </span>
                        )}

                        {item.category === 'action_item' && !item.convertedTaskId && (
                          <button
                            onClick={() => convertMutation.mutate(item.id)}
                            disabled={convertMutation.isPending}
                            className="inline-flex items-center gap-1 text-[10px] text-blue-600 dark:text-blue-400 hover:underline"
                            tabIndex={0}
                            role="button"
                            aria-label="Convert to task"
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); convertMutation.mutate(item.id); } }}
                          >
                            <ArrowRightCircle className="w-3 h-3" />
                            Convert to Task
                          </button>
                        )}

                        {item.convertedTaskId && (
                          <span className="text-[10px] text-green-600 dark:text-green-400 font-medium">Converted</span>
                        )}

                        <button
                          onClick={() => deleteItemMutation.mutate(item.id)}
                          className="ml-auto p-0.5 text-gray-400 hover:text-red-500 transition-colors"
                          tabIndex={0}
                          role="button"
                          aria-label="Delete item"
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); deleteItemMutation.mutate(item.id); } }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Add item inline */}
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={newItemContent[col.id] || ''}
                    onChange={(e) => setNewItemContent((prev) => ({ ...prev, [col.id]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddItem(col.id); } }}
                    placeholder="Add item..."
                    maxLength={2000}
                    className="flex-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                  />
                  <button
                    onClick={() => handleAddItem(col.id)}
                    disabled={!(newItemContent[col.id] || '').trim() || addItemMutation.isPending}
                    className="px-2 py-1.5 rounded-md bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-40 text-xs transition-colors"
                    tabIndex={0}
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
