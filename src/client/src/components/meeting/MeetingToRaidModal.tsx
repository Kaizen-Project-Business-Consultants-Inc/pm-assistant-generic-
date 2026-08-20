import { useState, useEffect } from 'react';
import {
  X, CheckSquare, Square, ChevronDown, ChevronUp,
  Shield, AlertTriangle, Zap, CheckCircle, Link2,
} from 'lucide-react';
import { useModal } from '../../hooks/useModal';
import type { RaidCandidate } from '../../utils/meetingToRaidMapper';

interface MeetingToRaidModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (items: RaidCandidate[]) => void;
  candidates: RaidCandidate[];
  importing: boolean;
}

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const CATEGORIES = [
  'schedule', 'budget', 'resource', 'technical',
  'regulatory', 'stakeholder', 'weather', 'dependency', 'other',
] as const;

const severityColor = (s: string) => {
  if (s === 'critical') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
  if (s === 'high') return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400';
  if (s === 'medium') return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
  return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
};

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  risk: { label: 'Risks', color: 'text-red-600 dark:text-red-400', icon: AlertTriangle },
  issue: { label: 'Issues', color: 'text-orange-600 dark:text-orange-400', icon: Zap },
  action: { label: 'Actions', color: 'text-blue-600 dark:text-blue-400', icon: CheckCircle },
  decision: { label: 'Decisions', color: 'text-purple-600 dark:text-purple-400', icon: Shield },
  dependency: { label: 'Dependencies', color: 'text-cyan-600 dark:text-cyan-400', icon: Link2 },
};

type GroupedCandidates = { sourceType: string; items: { candidate: RaidCandidate; idx: number }[] }[];

function groupBySourceType(candidates: RaidCandidate[]): GroupedCandidates {
  const groups = new Map<string, { candidate: RaidCandidate; idx: number }[]>();
  candidates.forEach((c, idx) => {
    const key = c.sourceType;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ candidate: c, idx });
  });
  const order = ['risk', 'issue', 'action', 'decision', 'dependency'];
  return order
    .filter(t => groups.has(t))
    .map(t => ({ sourceType: t, items: groups.get(t)! }));
}

export function MeetingToRaidModal({ isOpen, onClose, onImport, candidates, importing }: MeetingToRaidModalProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [edits, setEdits] = useState<Map<number, { title?: string; severity?: string; category?: string }>>(new Map());
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen && candidates.length > 0) {
      const initial = new Set<number>();
      candidates.forEach((c, i) => {
        if (!c.duplicate) initial.add(i);
      });
      setSelected(initial);
      setEdits(new Map());
      setExpandedIdx(null);
    }
  }, [isOpen, candidates]);

  const { dialogRef, handleKeyDown } = useModal(isOpen, onClose);

  if (!isOpen) return null;

  const grouped = groupBySourceType(candidates);

  const toggleSelect = (idx: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const selectAllInGroup = (items: { idx: number }[]) => {
    setSelected(prev => {
      const next = new Set(prev);
      items.forEach(i => next.add(i.idx));
      return next;
    });
  };

  const deselectAllInGroup = (items: { idx: number }[]) => {
    setSelected(prev => {
      const next = new Set(prev);
      items.forEach(i => next.delete(i.idx));
      return next;
    });
  };

  const updateEdit = (idx: number, field: string, value: string) => {
    setEdits(prev => {
      const next = new Map(prev);
      const existing = next.get(idx) || {};
      next.set(idx, { ...existing, [field]: value });
      return next;
    });
  };

  const getEffective = (idx: number) => {
    const c = candidates[idx];
    const e = edits.get(idx) || {};
    return {
      title: e.title ?? c.title,
      severity: e.severity ?? c.severity ?? 'medium',
      category: e.category ?? c.category ?? 'other',
    };
  };

  const handleImport = () => {
    const items = Array.from(selected).map(idx => {
      const c = candidates[idx];
      const eff = getEffective(idx);
      return { ...c, title: eff.title, severity: eff.severity, category: eff.category };
    });
    onImport(items);
  };

  const selectedCount = selected.size;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Send to RAID Log"
        onKeyDown={handleKeyDown}
        tabIndex={-1}
        className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Shield className="w-5 h-5 text-indigo-500" />
              Send to RAID Log
              <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
                ({candidates.length} items)
              </span>
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Review and import meeting items into the RAID log
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {candidates.length === 0 ? (
            <div className="text-center py-12">
              <Shield className="mx-auto mb-3 h-12 w-12 text-gray-300 dark:text-gray-600" />
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">No items to import</h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                This analysis did not produce any RAID-eligible items.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {grouped.map(({ sourceType, items }) => {
                const cfg = TYPE_CONFIG[sourceType] || TYPE_CONFIG.risk;
                const Icon = cfg.icon;
                const allSelected = items.every(i => selected.has(i.idx));

                return (
                  <div key={sourceType}>
                    {/* Section Header */}
                    <div className="flex items-center justify-between mb-2">
                      <h3 className={`text-sm font-semibold flex items-center gap-1.5 ${cfg.color}`}>
                        <Icon className="w-4 h-4" />
                        {cfg.label} ({items.length})
                      </h3>
                      <div className="flex gap-2">
                        <button
                          onClick={() => allSelected ? deselectAllInGroup(items) : selectAllInGroup(items)}
                          className="text-[10px] text-gray-500 dark:text-gray-400 hover:underline"
                        >
                          {allSelected ? 'Deselect All' : 'Select All'}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {items.map(({ candidate: c, idx }) => {
                        const eff = getEffective(idx);
                        const isSelected = selected.has(idx);
                        const isExpanded = expandedIdx === idx;

                        return (
                          <div
                            key={idx}
                            className={`rounded-lg border transition-colors ${
                              c.duplicate
                                ? 'border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-900/10'
                                : isSelected
                                ? 'border-primary-200 dark:border-primary-800/50 bg-primary-50/30 dark:bg-primary-900/10'
                                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
                            }`}
                          >
                            <div className="flex items-start gap-3 px-4 py-3">
                              <button onClick={() => toggleSelect(idx)} className="mt-0.5 flex-shrink-0">
                                {isSelected
                                  ? <CheckSquare className="w-4.5 h-4.5 text-primary-600 dark:text-primary-400" />
                                  : <Square className="w-4.5 h-4.5 text-gray-400 dark:text-gray-500" />
                                }
                              </button>

                              <div className="flex-1 min-w-0 space-y-1.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <input
                                    type="text"
                                    value={eff.title}
                                    onChange={e => updateEdit(idx, 'title', e.target.value)}
                                    className="flex-1 min-w-[200px] text-sm font-medium text-gray-900 dark:text-white bg-transparent border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-primary-500 focus:outline-none px-0 py-0.5"
                                  />

                                  {/* Type badge */}
                                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                                    {c.type}
                                  </span>

                                  {c.duplicate && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                                      <AlertTriangle className="w-3 h-3" />
                                      Already exists &mdash; {c.duplicate.currentStatus.replace(/_/g, ' ')}
                                    </span>
                                  )}
                                </div>

                                {/* Inline controls */}
                                <div className="flex items-center gap-3 text-xs">
                                  <select
                                    value={eff.severity}
                                    onChange={e => updateEdit(idx, 'severity', e.target.value)}
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium border-0 cursor-pointer ${severityColor(eff.severity)}`}
                                  >
                                    {SEVERITIES.map(s => (
                                      <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                                    ))}
                                  </select>

                                  {(c.type === 'risk' || c.type === 'issue') && (
                                    <select
                                      value={eff.category}
                                      onChange={e => updateEdit(idx, 'category', e.target.value)}
                                      className="px-2 py-0.5 rounded text-[10px] font-medium border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 cursor-pointer capitalize"
                                    >
                                      {CATEGORIES.map(cat => (
                                        <option key={cat} value={cat}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
                                      ))}
                                    </select>
                                  )}

                                  {c.dueDate && (
                                    <span className="text-gray-500 dark:text-gray-400">
                                      Due: {c.dueDate}
                                    </span>
                                  )}

                                  {(c.description || c.mitigationPlan || c.rationale) && (
                                    <button
                                      onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                                      className="ml-auto text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1"
                                    >
                                      <span className="text-[10px]">Details</span>
                                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                    </button>
                                  )}
                                </div>

                                {/* Expanded details */}
                                {isExpanded && (
                                  <div className="mt-2 space-y-1.5 text-xs text-gray-600 dark:text-gray-400">
                                    {c.description && (
                                      <p className="whitespace-pre-wrap">{c.description}</p>
                                    )}
                                    {c.mitigationPlan && (
                                      <div>
                                        <span className="font-medium text-gray-700 dark:text-gray-300">Mitigation:</span>
                                        <span className="ml-1">{c.mitigationPlan}</span>
                                      </div>
                                    )}
                                    {c.rationale && (
                                      <div>
                                        <span className="font-medium text-gray-700 dark:text-gray-300">Rationale:</span>
                                        <span className="ml-1">{c.rationale}</span>
                                      </div>
                                    )}
                                    {c.decidedBy && (
                                      <div>
                                        <span className="font-medium text-gray-700 dark:text-gray-300">Decided by:</span>
                                        <span className="ml-1">{c.decidedBy}</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={selectedCount === 0 || importing}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            <Shield className="w-4 h-4" />
            {importing ? 'Importing...' : `Import ${selectedCount} to RAID`}
          </button>
        </div>
      </div>
    </div>
  );
}
