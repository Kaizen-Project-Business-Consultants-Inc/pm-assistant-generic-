import React, { useState } from 'react';
import {
  FileText,
  CheckSquare,
  Scale,
  AlertTriangle,
  ListChecks,
  Check,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActionItem {
  description: string;
  assignee: string;
  dueDate: string;
  priority: string;
}

interface Decision {
  decision: string;
  rationale: string;
}

interface Risk {
  risk: string;
  severity: string;
  mitigation: string;
}

interface TaskUpdate {
  type: 'create' | 'update' | 'reschedule';
  taskName: string;
  proposedChanges: string;
}

interface MeetingAnalysis {
  id?: string;
  summary?: string;
  actionItems?: ActionItem[];
  decisions?: Decision[];
  risks?: Risk[];
  taskUpdates?: TaskUpdate[];
}

interface MeetingResultPanelProps {
  analysis: MeetingAnalysis;
  onApply: (indices: number[]) => void;
  isApplying: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TABS = [
  { key: 'summary', label: 'Summary', icon: FileText },
  { key: 'actions', label: 'Action Items', icon: CheckSquare },
  { key: 'decisions', label: 'Decisions', icon: Scale },
  { key: 'risks', label: 'Risks', icon: AlertTriangle },
  { key: 'tasks', label: 'Task Updates', icon: ListChecks },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function priorityBadge(priority: string) {
  const p = priority?.toLowerCase() || '';
  const colors: Record<string, string> = {
    critical: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
    high: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
    medium: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
    low: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${colors[p] || 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}
    >
      {priority}
    </span>
  );
}

function severityBadge(severity: string) {
  const s = severity?.toLowerCase() || '';
  const colors: Record<string, string> = {
    critical: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800',
    high: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800',
    medium: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800',
    low: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800',
  };
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${colors[s] || 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}
    >
      {severity}
    </span>
  );
}

function typeBadge(type: string) {
  const colors: Record<string, string> = {
    create: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
    update: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
    reschedule: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
  };
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${colors[type] || 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}
    >
      {type}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MeetingResultPanel: React.FC<MeetingResultPanelProps> = ({
  analysis,
  onApply,
  isApplying,
}) => {
  const [activeTab, setActiveTab] = useState<TabKey>('summary');
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

  const taskUpdates = analysis.taskUpdates || [];

  const toggleIndex = (idx: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIndices.size === taskUpdates.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(taskUpdates.map((_, i) => i)));
    }
  };

  const handleApply = () => {
    onApply(Array.from(selectedIndices));
  };

  return (
    <div className="card">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-4 -mx-4 px-4 overflow-x-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                isActive
                  ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="min-h-[200px]">
        {/* Summary */}
        {activeTab === 'summary' && (
          <div>
            {analysis.summary ? (
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
                {analysis.summary}
              </p>
            ) : (
              <p className="text-sm text-gray-400 italic">No summary available.</p>
            )}
          </div>
        )}

        {/* Action Items */}
        {activeTab === 'actions' && (
          <div className="overflow-x-auto">
            {(analysis.actionItems || []).length === 0 ? (
              <p className="text-sm text-gray-400 italic">No action items identified.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-2 pr-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      Description
                    </th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      Assignee
                    </th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      Due Date
                    </th>
                    <th className="text-center py-2 pl-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      Priority
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {analysis.actionItems!.map((item, idx) => (
                    <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                      <td className="py-2.5 pr-4 text-gray-900 dark:text-white">{item.description}</td>
                      <td className="py-2.5 px-3 text-gray-600 dark:text-gray-400">{item.assignee}</td>
                      <td className="py-2.5 px-3 text-gray-600 dark:text-gray-400">{item.dueDate}</td>
                      <td className="py-2.5 pl-3 text-center">{priorityBadge(item.priority)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Decisions */}
        {activeTab === 'decisions' && (
          <div>
            {(analysis.decisions || []).length === 0 ? (
              <p className="text-sm text-gray-400 italic">No decisions recorded.</p>
            ) : (
              <div className="space-y-3">
                {analysis.decisions!.map((d, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:shadow-sm transition-shadow"
                  >
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">{d.decision}</h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                      <span className="font-medium text-gray-600 dark:text-gray-300">Rationale:</span> {d.rationale}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Risks */}
        {activeTab === 'risks' && (
          <div>
            {(analysis.risks || []).length === 0 ? (
              <p className="text-sm text-gray-400 italic">No risks identified.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {analysis.risks!.map((r, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:shadow-sm transition-shadow"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4 text-orange-500 flex-shrink-0" />
                      <h4 className="text-sm font-semibold text-gray-900 dark:text-white flex-1">{r.risk}</h4>
                      {severityBadge(r.severity)}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                      <span className="font-medium text-gray-600 dark:text-gray-300">Mitigation:</span> {r.mitigation}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Task Updates */}
        {activeTab === 'tasks' && (
          <div>
            {taskUpdates.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No task updates proposed.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700">
                        <th className="text-left py-2 pr-2 w-8">
                          <input
                            type="checkbox"
                            checked={selectedIndices.size === taskUpdates.length}
                            onChange={toggleAll}
                            className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
                          />
                        </th>
                        <th className="text-center py-2 px-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                          Type
                        </th>
                        <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                          Task Name
                        </th>
                        <th className="text-left py-2 pl-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                          Proposed Changes
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {taskUpdates.map((tu, idx) => (
                        <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                          <td className="py-2.5 pr-2">
                            <input
                              type="checkbox"
                              checked={selectedIndices.has(idx)}
                              onChange={() => toggleIndex(idx)}
                              className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
                            />
                          </td>
                          <td className="py-2.5 px-3 text-center">{typeBadge(tu.type)}</td>
                          <td className="py-2.5 px-3 font-medium text-gray-900 dark:text-white">{tu.taskName}</td>
                          <td className="py-2.5 pl-3 text-gray-600 dark:text-gray-400">{tu.proposedChanges}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Apply button */}
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {selectedIndices.size} of {taskUpdates.length} selected
                  </p>
                  <button
                    onClick={handleApply}
                    disabled={selectedIndices.size === 0 || isApplying}
                    className="btn btn-primary flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isApplying ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Applying...
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        Apply Selected
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
