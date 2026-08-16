import { useState, useEffect } from 'react';
import { X, AlertTriangle, CheckSquare, Square, ChevronDown, ChevronUp, Bot } from 'lucide-react';
import { useModal } from '../../hooks/useModal';

interface AIScanCandidate {
  title: string;
  description: string;
  severity: string;
  category: string;
  probability: number;
  impact: number;
  mitigations: string[];
  affectedTasks: string[];
  duplicate?: { existingId: string; currentSeverity: string; currentStatus: string };
}

interface AIScanReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (items: Record<string, any>[]) => void;
  candidates: AIScanCandidate[];
  importing: boolean;
  aiPowered: boolean;
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

export function AIScanReviewModal({ isOpen, onClose, onImport, candidates, importing, aiPowered }: AIScanReviewModalProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [edits, setEdits] = useState<Map<number, { title?: string; severity?: string; category?: string }>>(new Map());
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  // Pre-select non-duplicates on open
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

  const toggleSelect = (idx: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const selectAll = () => {
    const all = new Set<number>();
    candidates.forEach((_, i) => all.add(i));
    setSelected(all);
  };

  const deselectAll = () => setSelected(new Set());

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
      severity: e.severity ?? c.severity,
      category: e.category ?? c.category,
    };
  };

  const handleImport = () => {
    const items = Array.from(selected).map(idx => {
      const c = candidates[idx];
      const eff = getEffective(idx);
      return {
        title: eff.title,
        description: c.description,
        category: eff.category,
        severity: eff.severity,
        probability: c.probability,
        impact: c.impact,
        mitigationPlan: c.mitigations?.length ? c.mitigations.join('\n') : undefined,
        linkedTaskIds: c.affectedTasks?.length ? c.affectedTasks : undefined,
      };
    });
    onImport(items);
  };

  const selectedCount = selected.size;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Review AI-Detected Risks" onKeyDown={handleKeyDown} tabIndex={-1} className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Bot className="w-5 h-5 text-purple-500" />
              Review AI-Detected Risks
              <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
                ({candidates.length} found)
              </span>
            </h2>
            {!aiPowered && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                Rule-based estimates (AI unavailable)
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {candidates.length === 0 ? (
            <div className="text-center py-12">
              <Bot className="mx-auto mb-3 h-12 w-12 text-gray-300 dark:text-gray-600" />
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">No risks detected</h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                The AI scan did not identify any new risks for this project.
              </p>
            </div>
          ) : (
            <>
              {/* Select All / Deselect All */}
              <div className="flex items-center gap-3 mb-3">
                <button onClick={selectAll} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">
                  Select All
                </button>
                <button onClick={deselectAll} className="text-xs text-gray-500 dark:text-gray-400 hover:underline">
                  Deselect All
                </button>
              </div>

              <div className="space-y-2">
                {candidates.map((c, idx) => {
                  const eff = getEffective(idx);
                  const isSelected = selected.has(idx);
                  const isExpanded = expandedIdx === idx;
                  const score = c.probability * c.impact;

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
                        {/* Checkbox */}
                        <button onClick={() => toggleSelect(idx)} className="mt-0.5 flex-shrink-0">
                          {isSelected
                            ? <CheckSquare className="w-4.5 h-4.5 text-primary-600 dark:text-primary-400" />
                            : <Square className="w-4.5 h-4.5 text-gray-400 dark:text-gray-500" />
                          }
                        </button>

                        {/* Content */}
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            {/* Editable title */}
                            <input
                              type="text"
                              value={eff.title}
                              onChange={e => updateEdit(idx, 'title', e.target.value)}
                              className="flex-1 min-w-[200px] text-sm font-medium text-gray-900 dark:text-white bg-transparent border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-primary-500 focus:outline-none px-0 py-0.5"
                            />

                            {/* Duplicate badge */}
                            {c.duplicate && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                                <AlertTriangle className="w-3 h-3" />
                                Already exists &mdash; {c.duplicate.currentStatus.replace('_', ' ')}
                              </span>
                            )}
                          </div>

                          {/* Inline controls row */}
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

                            <select
                              value={eff.category}
                              onChange={e => updateEdit(idx, 'category', e.target.value)}
                              className="px-2 py-0.5 rounded text-[10px] font-medium border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 cursor-pointer capitalize"
                            >
                              {CATEGORIES.map(cat => (
                                <option key={cat} value={cat}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
                              ))}
                            </select>

                            <span className="text-gray-500 dark:text-gray-400">
                              P{c.probability} x I{c.impact} = <span className="font-bold">{score}</span>
                            </span>

                            {/* Expand toggle */}
                            <button
                              onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                              className="ml-auto text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                            >
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                          </div>

                          {/* Expanded details */}
                          {isExpanded && (
                            <div className="mt-2 space-y-2 text-xs text-gray-600 dark:text-gray-400">
                              {c.description && (
                                <div>
                                  <span className="font-medium text-gray-700 dark:text-gray-300">Description:</span>
                                  <p className="mt-0.5 whitespace-pre-wrap">{c.description}</p>
                                </div>
                              )}
                              {c.mitigations?.length > 0 && (
                                <div>
                                  <span className="font-medium text-gray-700 dark:text-gray-300">Mitigations:</span>
                                  <ul className="mt-0.5 list-disc list-inside space-y-0.5">
                                    {c.mitigations.map((m, i) => <li key={i}>{m}</li>)}
                                  </ul>
                                </div>
                              )}
                              {c.affectedTasks?.length > 0 && (
                                <div>
                                  <span className="font-medium text-gray-700 dark:text-gray-300">Affected Tasks:</span>
                                  <span className="ml-1">{c.affectedTasks.join(', ')}</span>
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
            </>
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
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {importing ? 'Importing…' : `Import ${selectedCount} Selected`}
          </button>
        </div>
      </div>
    </div>
  );
}
