import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckSquare, Square, Shield, ShieldCheck, ChevronDown, ChevronRight } from 'lucide-react';
import { apiService } from '../../services/api';

interface TaskChecklistPanelProps {
  taskId: string;
  projectId: string;
}

interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
}

interface Checklist {
  id: string;
  taskId: string;
  type: 'dor' | 'dod';
  items: ChecklistItem[];
}

function ChecklistSection({
  type,
  label,
  icon: Icon,
  checklist,
  taskId,
  projectId,
}: {
  type: 'dor' | 'dod';
  label: string;
  icon: typeof Shield;
  checklist: Checklist | null;
  taskId: string;
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(true);

  const initMutation = useMutation({
    mutationFn: () => apiService.initializeTaskChecklist(taskId, type, projectId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['taskChecklists', taskId] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ criterionId, checked }: { criterionId: string; checked: boolean }) =>
      apiService.updateTaskChecklist(checklist!.id, criterionId, checked),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['taskChecklists', taskId] }),
  });

  const items = checklist?.items || [];
  const checked = items.filter((i) => i.checked).length;
  const total = items.length;
  const allChecked = total > 0 && checked === total;

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800/50 flex items-center gap-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
        tabIndex={0}
        role="button"
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
        <Icon className={`w-4 h-4 ${allChecked ? 'text-green-500' : 'text-gray-400'}`} />
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{label}</span>
        {total > 0 && (
          <span className={`ml-auto text-xs font-medium ${allChecked ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'}`}>
            {checked}/{total}
          </span>
        )}
      </button>

      {expanded && (
        <div className="p-3">
          {!checklist ? (
            <div className="text-center py-3">
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">No checklist initialized</p>
              <button
                onClick={() => initMutation.mutate()}
                disabled={initMutation.isPending}
                className="text-xs px-3 py-1.5 rounded-md bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 hover:bg-primary-200 dark:hover:bg-primary-900/50 disabled:opacity-50 transition-colors"
                tabIndex={0}
              >
                {initMutation.isPending ? 'Initializing...' : 'Initialize from Template'}
              </button>
              {initMutation.isError && (
                <p className="text-xs text-red-500 mt-1">
                  {(initMutation.error as any)?.response?.data?.error || 'No template defined for this project'}
                </p>
              )}
            </div>
          ) : items.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-2">No criteria in checklist</p>
          ) : (
            <div className="space-y-1.5">
              {items.map((item) => (
                <label
                  key={item.id}
                  className="flex items-start gap-2 cursor-pointer group"
                >
                  <button
                    onClick={() => updateMutation.mutate({ criterionId: item.id, checked: !item.checked })}
                    className="mt-0.5 flex-shrink-0"
                    tabIndex={0}
                    role="checkbox"
                    aria-checked={item.checked}
                    aria-label={item.label}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); updateMutation.mutate({ criterionId: item.id, checked: !item.checked }); } }}
                  >
                    {item.checked ? (
                      <CheckSquare className="w-4 h-4 text-green-500" />
                    ) : (
                      <Square className="w-4 h-4 text-gray-400 group-hover:text-gray-500" />
                    )}
                  </button>
                  <span className={`text-sm ${item.checked ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-700 dark:text-gray-300'}`}>
                    {item.label}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TaskChecklistPanel({ taskId, projectId }: TaskChecklistPanelProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['taskChecklists', taskId],
    queryFn: () => apiService.getTaskChecklists(taskId),
    enabled: !!taskId,
  });

  if (isLoading) {
    return <div className="h-20 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse" />;
  }

  const checklists = data?.checklists || { dor: null, dod: null };

  return (
    <div className="space-y-3">
      <ChecklistSection type="dor" label="Definition of Ready" icon={Shield} checklist={checklists.dor} taskId={taskId} projectId={projectId} />
      <ChecklistSection type="dod" label="Definition of Done" icon={ShieldCheck} checklist={checklists.dod} taskId={taskId} projectId={projectId} />
    </div>
  );
}
