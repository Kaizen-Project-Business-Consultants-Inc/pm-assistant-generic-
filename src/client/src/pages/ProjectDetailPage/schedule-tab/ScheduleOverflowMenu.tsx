/** The Schedule tab's ⋯ menu (baselines, scenarios, import, re-plan, levelling, export, shortcuts,
 * delete). Moved out of ScheduleTab.tsx unchanged (code health item 4, Phase 1, 2026-10-04). */
import { useState, useRef, useEffect, useId } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Upload, BarChart3, Save, Bot, Download, Trash2, MoreVertical } from 'lucide-react';
import { apiService } from '../../../services/api';

// ---------------------------------------------------------------------------
// Schedule Overflow Menu (⋯)
// ---------------------------------------------------------------------------

export interface ScheduleOverflowMenuProps {
  schedule: any;
  projectId: string;
  baselines: any[];
  selectedBaselineId: string;
  setSelectedBaselineId: (id: string) => void;
  showComparison: boolean;
  setShowComparison: (v: boolean) => void;
  createBaselineMutation: { mutate: () => void; isPending: boolean };
  scenarios: any[];
  selectedScenarioId: string;
  setSelectedScenarioId: (id: string) => void;
  showScenarioCompare: boolean;
  setShowScenarioCompare: (v: boolean) => void;
  setShowImportModal: (v: boolean) => void;
  setShowReschedulePanel: (v: boolean) => void;
  levelingBusy: boolean;
  onLevelResources: () => void;
  exportCSV: () => void;
  queryClient: ReturnType<typeof useQueryClient>;
  onDeleteSchedule: () => void;
  onCreateScenario: () => void;
}

export function ScheduleOverflowMenu(props: ScheduleOverflowMenuProps) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const itemClass = 'w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2';
  const groupLabel = 'px-3 pt-2 pb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider';
  const divider = 'border-t border-gray-100 dark:border-gray-700 my-1';

  return (
    <div className="relative ml-auto" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-7 h-7 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-600 rounded-md transition-colors hover:bg-gray-50 dark:hover:bg-gray-700"
        title="More actions"
        aria-label="More actions"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 py-1 max-h-[70vh] overflow-y-auto">
          {/* Baseline */}
          <div className={groupLabel}>Baseline</div>
          <button
            onClick={() => { props.createBaselineMutation.mutate(); }}
            disabled={props.createBaselineMutation.isPending}
            className={itemClass}
          >
            <Save className="w-3.5 h-3.5 text-primary-500" />
            Save Baseline
          </button>
          {props.baselines.length > 0 && (
            <div className="px-3 py-1.5">
              <select
                aria-label="Baseline to show"
                value={props.selectedBaselineId}
                onChange={(e) => { props.setSelectedBaselineId(e.target.value); props.setShowComparison(false); }}
                className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800"
              >
                <option value="">No baseline overlay</option>
                {props.baselines.map((b: any) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({new Date(b.createdAt).toLocaleDateString('en-US')})
                  </option>
                ))}
              </select>
            </div>
          )}
          {props.selectedBaselineId && (
            <button
              onClick={() => props.setShowComparison(!props.showComparison)}
              className={itemClass}
            >
              <BarChart3 className="w-3.5 h-3.5 text-primary-500" />
              {props.showComparison ? 'Hide Variance Report' : 'Variance Report'}
            </button>
          )}

          <div className={divider} />

          {/* Scenarios */}
          {!props.schedule.isScenario && (
            <>
              <div className={groupLabel}>Scenarios</div>
              <button
                onClick={() => { props.onCreateScenario(); setOpen(false); }}
                className={itemClass}
              >
                <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                Create Scenario
              </button>
              {props.scenarios.length > 0 && (
                <div className="px-3 py-1.5">
                  <select
                    aria-label="Scenario to compare"
                    value={props.selectedScenarioId}
                    onChange={(e) => { props.setSelectedScenarioId(e.target.value); props.setShowScenarioCompare(false); }}
                    className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800"
                  >
                    <option value="">Select scenario...</option>
                    {props.scenarios.map((s: any) => (
                      <option key={s.id} value={s.id}>{s.scenarioLabel || s.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {props.selectedScenarioId && (
                <button
                  onClick={() => props.setShowScenarioCompare(!props.showScenarioCompare)}
                  className={itemClass}
                >
                  <BarChart3 className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                  {props.showScenarioCompare ? 'Hide Comparison' : 'Compare'}
                </button>
              )}
              <div className={divider} />
            </>
          )}

          {/* Data */}
          <div className={groupLabel}>Data</div>
          <button
            onClick={() => { props.setShowImportModal(true); setOpen(false); }}
            className={itemClass}
          >
            <Upload className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
            Import
          </button>
          <button
            onClick={() => { props.exportCSV(); setOpen(false); }}
            className={itemClass}
          >
            <Download className="w-3.5 h-3.5" />
            Export visible tasks (CSV)
          </button>

          <div className={divider} />

          {/* Automation */}
          <div className={groupLabel}>Automation</div>
          <button
            onClick={() => { props.setShowReschedulePanel(true); setOpen(false); }}
            className={itemClass}
          >
            <Bot className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
            AI Reschedule
          </button>
          <button
            onClick={() => { props.onLevelResources(); setOpen(false); }}
            disabled={props.levelingBusy}
            className={`${itemClass} disabled:opacity-50`}
          >
            <BarChart3 className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
            Level Resources
          </button>
          <div className="px-3 py-1.5 flex items-center gap-2">
            <span id={`${uid}-mode`} className="text-xs font-semibold text-gray-500 uppercase">% Mode:</span>
            <select
              aria-labelledby={`${uid}-mode`}
              value={props.schedule.progressMode || 'duration'}
              onChange={async (e) => {
                const mode = e.target.value as 'duration' | 'work';
                await apiService.updateSchedule(props.schedule.id, { progressMode: mode } as any);
                props.queryClient.invalidateQueries({ queryKey: ['schedules', props.projectId] });
                props.queryClient.invalidateQueries({ queryKey: ['tasks', props.schedule.id] });
              }}
              className="text-xs border border-gray-200 dark:border-gray-700 rounded-md px-1.5 py-0.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
            >
              <option value="duration">Duration</option>
              <option value="work">Work (Hours)</option>
            </select>
          </div>

          <div className={divider} />

          {/* Help */}
          <div className={groupLabel}>Help</div>
          <button
            onClick={() => setShowShortcuts(!showShortcuts)}
            className={itemClass}
          >
            <span className="w-3.5 h-3.5 flex items-center justify-center text-xs font-bold border border-gray-300 dark:border-gray-600 rounded">?</span>
            Keyboard Shortcuts
          </button>
          {showShortcuts && (
            <div className="px-3 pb-2 space-y-1 text-xs">
              {[
                ['Ctrl+Z', 'Undo'],
                ['Ctrl+Y', 'Redo'],
                ['Delete', 'Delete task'],
                ['Click', 'Select'],
                ['Dbl-click', 'Edit'],
                ['Drag bar', 'Move dates'],
                ['Drag handle', 'Reorder'],
                ['Shift+Click', 'Multi-select'],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-gray-500 dark:text-gray-400">{desc}</span>
                  <kbd className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-mono text-xs">{key}</kbd>
                </div>
              ))}
            </div>
          )}

          <div className={divider} />

          {/* Danger */}
          <button
            onClick={() => { props.onDeleteSchedule(); setOpen(false); }}
            className="w-full text-left px-3 py-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center gap-2"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete Schedule
          </button>
        </div>
      )}
    </div>
  );
}
