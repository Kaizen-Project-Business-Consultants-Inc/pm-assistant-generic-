import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, ChevronDown, ChevronUp, RefreshCw, Mail, CheckCircle, ArrowRightLeft, Plus, AlertTriangle, Ban } from 'lucide-react';
import { apiService } from '../../../services/api';

interface Props {
  projects: Array<{ id: string; name: string }>;
}

export function StandupSummaryWidget({ projects }: Props) {
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('standup-collapsed') === 'true'; } catch { return false; }
  });
  const [selectedProjectId, setSelectedProjectId] = useState<string>(() => {
    try { return localStorage.getItem('standup-project') || ''; } catch { return ''; }
  });
  const [emailing, setEmailing] = useState(false);

  const projectId = selectedProjectId || projects[0]?.id || '';

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['standup-summary', projectId],
    queryFn: () => apiService.getStandupSummary(projectId),
    staleTime: 120_000,
    enabled: !!projectId,
  });

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('standup-collapsed', String(next));
  };

  const handleProjectChange = (id: string) => {
    setSelectedProjectId(id);
    localStorage.setItem('standup-project', id);
  };

  const handleRefresh = async () => {
    if (!projectId) return;
    await queryClient.fetchQuery({
      queryKey: ['standup-summary', projectId],
      queryFn: () => apiService.getStandupSummary(projectId, true),
    });
  };

  const handleEmail = async () => {
    if (!projectId || emailing) return;
    setEmailing(true);
    try {
      await apiService.emailStandupSummary(projectId);
    } catch { /* ignore */ }
    setEmailing(false);
  };

  const standup = data?.data;
  const changes = standup?.changes;

  if (!projects.length) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <button onClick={toggle} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <ClipboardList className="w-4 h-4 text-indigo-500" />
          <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">Standup Summary</span>
          {collapsed ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronUp className="w-4 h-4 text-gray-400" />}
        </button>
        <div className="flex items-center gap-2">
          <select
            value={projectId}
            onChange={e => handleProjectChange(e.target.value)}
            className="text-xs border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300"
          >
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button onClick={handleRefresh} disabled={isFetching} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50" title="Refresh" aria-label="Refresh">
            <RefreshCw className={`w-3.5 h-3.5 text-gray-500 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={handleEmail} disabled={emailing} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50" title="Email standup" aria-label="Email standup">
            <Mail className={`w-3.5 h-3.5 text-gray-500 ${emailing ? 'opacity-50' : ''}`} />
          </button>
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="p-4">
          {isLoading ? (
            <div className="animate-pulse">
              <div className="h-16 bg-gray-100 dark:bg-gray-700 rounded-lg mb-3" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="space-y-2 p-3 border border-gray-100 dark:border-gray-700 rounded-lg">
                    <div className="h-3.5 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
                    <div className="h-3 w-full bg-gray-100 dark:bg-gray-700/60 rounded" />
                    <div className="h-3 w-3/4 bg-gray-100 dark:bg-gray-700/60 rounded" />
                  </div>
                ))}
              </div>
            </div>
          ) : !changes ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No data available. Select a project and refresh.</p>
          ) : (
            <div className="space-y-4">
              {/* AI Narrative */}
              {standup?.narrative && (
                <div className="text-sm text-gray-700 dark:text-gray-300 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-3 whitespace-pre-wrap">
                  {standup.narrative}
                </div>
              )}

              {/* Sections */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <Section icon={CheckCircle} title="Completed" color="green" items={changes.completions} render={(c: any) => (
                  <span>{c.taskName} <span className="text-gray-400">by {c.completedBy}</span></span>
                )} />
                <Section icon={ArrowRightLeft} title="Status Changes" color="blue" items={changes.statusChanges} render={(c: any) => (
                  <span>{c.taskName} <span className="text-gray-400">{c.fromStatus} → {c.toStatus}</span></span>
                )} />
                <Section icon={Plus} title="New Tasks" color="indigo" items={changes.newTasks} render={(c: any) => (
                  <span>{c.taskName}</span>
                )} />
                <Section icon={AlertTriangle} title="New Risks" color="amber" items={changes.newRisks} render={(c: any) => (
                  <span>{c.title} <span className={`text-xs font-medium ${c.severity === 'critical' ? 'text-red-500' : 'text-amber-500'}`}>({c.severity})</span></span>
                )} />
                <Section icon={Ban} title="Blockers" color="red" items={changes.blockers} render={(c: any) => (
                  <span>{c.taskName}{c.assignee ? <span className="text-gray-400"> — {c.assignee}</span> : ''}</span>
                )} />
              </div>

              {/* Empty state */}
              {changes.completions.length === 0 && changes.statusChanges.length === 0 &&
               changes.newTasks.length === 0 && changes.newRisks.length === 0 && changes.blockers.length === 0 && (
                <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">No notable changes yesterday.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ icon: Icon, title, color, items, render }: {
  icon: any;
  title: string;
  color: string;
  items: any[];
  render: (item: any) => JSX.Element;
}) {
  if (!items || items.length === 0) return null;

  const colorMap: Record<string, string> = {
    green: 'text-green-600 dark:text-green-400',
    blue: 'text-blue-600 dark:text-blue-400',
    indigo: 'text-indigo-600 dark:text-indigo-400',
    amber: 'text-amber-600 dark:text-amber-400',
    red: 'text-red-600 dark:text-red-400',
  };

  return (
    <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className={`w-3.5 h-3.5 ${colorMap[color] || 'text-gray-500'}`} />
        <h4 className={`text-xs font-bold uppercase tracking-wide ${colorMap[color] || 'text-gray-500'}`}>
          {title} ({items.length})
        </h4>
      </div>
      <ul className="space-y-1">
        {items.slice(0, 8).map((item: any, i: number) => (
          <li key={i} className="text-xs text-gray-700 dark:text-gray-300 truncate">
            {render(item)}
          </li>
        ))}
        {items.length > 8 && (
          <li className="text-xs text-gray-400 dark:text-gray-500">+{items.length - 8} more</li>
        )}
      </ul>
    </div>
  );
}
