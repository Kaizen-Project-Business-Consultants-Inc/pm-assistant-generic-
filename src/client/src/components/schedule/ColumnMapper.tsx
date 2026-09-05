import { useEffect, useCallback, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { fuzzyMatchColumn } from '../../utils/fuzzyMatch';
import { apiService } from '../../services/api';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

export const TARGET_COLUMNS = [
  { value: '', label: '-- skip --' },
  { value: 'name', label: 'Name' },
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'startDate', label: 'Start Date' },
  { value: 'endDate', label: 'End Date' },
  { value: 'assignedTo', label: 'Assigned To' },
  { value: 'progressPercentage', label: 'Progress %' },
  { value: 'estimatedDurationHours', label: 'Est. Duration (hrs)' },
  { value: 'description', label: 'Description' },
  { value: 'actualStartDate', label: 'Actual Start' },
  { value: 'actualEndDate', label: 'Actual Finish' },
  { value: 'baselineStartDate', label: 'Baseline Start' },
  { value: 'baselineFinishDate', label: 'Baseline Finish' },
  { value: 'baselineDurationDays', label: 'Baseline Duration' },
  { value: 'baselineCost', label: 'Baseline Cost' },
] as const;

const TARGET_VALUES = TARGET_COLUMNS.filter(c => c.value).map(c => c.value);

const ALIASES: Record<string, string> = {
  name: 'name', title: 'name', task: 'name', activity: 'name', taskname: 'name',
  status: 'status', state: 'status', schedulestatus: 'status',
  priority: 'priority',
  start: 'startDate', startdate: 'startDate', start_date: 'startDate',
  plannedstartdate: 'startDate', plannedstart: 'startDate', targetstart: 'startDate',
  end: 'endDate', enddate: 'endDate', end_date: 'endDate', due: 'endDate', duedate: 'endDate', due_date: 'endDate',
  plannedenddate: 'endDate', plannedend: 'endDate', targetend: 'endDate',
  assigned: 'assignedTo', assignedto: 'assignedTo', assigned_to: 'assignedTo', owner: 'assignedTo', assignee: 'assignedTo',
  responsibility: 'assignedTo', resource: 'assignedTo',
  progress: 'progressPercentage', progresspercentage: 'progressPercentage', percent: 'progressPercentage',
  duration: 'estimatedDurationHours', estimateddurationhours: 'estimatedDurationHours', hours: 'estimatedDurationHours',
  planneddays: 'estimatedDurationHours', days: 'estimatedDurationHours',
  description: 'description', desc: 'description', notes: 'description',
  actualstart: 'actualStartDate', actual_start: 'actualStartDate', actual_start_date: 'actualStartDate', actualstartdate: 'actualStartDate',
  actualfinish: 'actualEndDate', actual_finish: 'actualEndDate', actual_end: 'actualEndDate', actual_end_date: 'actualEndDate', actualenddate: 'actualEndDate', actual_finish_date: 'actualEndDate', actualfinishdate: 'actualEndDate',
  baselinestart: 'baselineStartDate', baseline_start: 'baselineStartDate', baseline_start_date: 'baselineStartDate', baselinestartdate: 'baselineStartDate',
  baselinefinish: 'baselineFinishDate', baseline_finish: 'baselineFinishDate', baseline_finish_date: 'baselineFinishDate', baselinefinishdate: 'baselineFinishDate', baseline_end: 'baselineFinishDate', baselineend: 'baselineFinishDate',
  baselineduration: 'baselineDurationDays', baseline_duration: 'baselineDurationDays', baseline_duration_days: 'baselineDurationDays', baselinedurationdays: 'baselineDurationDays',
  baselinecost: 'baselineCost', baseline_cost: 'baselineCost',
};

// Human-readable labels for the target fields (used in fuzzy matching)
const TARGET_LABELS: Record<string, string[]> = {
  name: ['name', 'task name', 'activity'],
  status: ['status'],
  priority: ['priority'],
  startDate: ['start date', 'planned start'],
  endDate: ['end date', 'planned end', 'due date'],
  assignedTo: ['assigned to', 'assignee', 'owner', 'resource', 'responsibility'],
  progressPercentage: ['progress', 'percent complete'],
  estimatedDurationHours: ['duration', 'hours', 'days', 'estimated duration'],
  description: ['description', 'notes'],
  actualStartDate: ['actual start', 'actual start date'],
  actualEndDate: ['actual finish', 'actual end', 'actual finish date', 'actual end date'],
  baselineStartDate: ['baseline start', 'baseline start date'],
  baselineFinishDate: ['baseline finish', 'baseline finish date', 'baseline end'],
  baselineDurationDays: ['baseline duration', 'baseline duration days'],
  baselineCost: ['baseline cost'],
};

export interface ColumnMapperProps {
  headers: string[];
  mappings: Record<number, string>;
  onMappingsChange: (mappings: Record<number, string>) => void;
  enableAI?: boolean;
}

// ---------------------------------------------------------------------------
// Smart auto-map: exact alias → fuzzy → AI
// ---------------------------------------------------------------------------

/** Layer 1: Exact alias matching (same as ImportModal's existing autoMap). */
function exactAliasMap(headers: string[]): Record<number, string> {
  const map: Record<number, string> = {};
  const used = new Set<string>();
  headers.forEach((h, i) => {
    const key = h.toLowerCase().replace(/[^a-z0-9]/g, '');
    const target = ALIASES[key];
    if (target && !used.has(target)) {
      map[i] = target;
      used.add(target);
    }
  });
  return map;
}

/** Layer 2: Fuzzy matching for remaining unmapped headers. */
function fuzzyMap(
  headers: string[],
  existing: Record<number, string>,
): Record<number, string> {
  const map = { ...existing };
  const used = new Set(Object.values(map));

  // Build flat list of all label variants for unused targets
  const availableTargets: { field: string; label: string }[] = [];
  for (const field of TARGET_VALUES) {
    if (used.has(field)) continue;
    for (const label of (TARGET_LABELS[field] || [field])) {
      availableTargets.push({ field, label });
    }
  }

  headers.forEach((h, i) => {
    if (map[i]) return; // already mapped
    const labels = availableTargets.filter(t => !used.has(t.field)).map(t => t.label);
    const match = fuzzyMatchColumn(h, labels);
    if (match) {
      const target = availableTargets.find(t => t.label === match);
      if (target && !used.has(target.field)) {
        map[i] = target.field;
        used.add(target.field);
      }
    }
  });

  return map;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ColumnMapper({ headers, mappings, onMappingsChange, enableAI = true }: ColumnMapperProps) {
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSource, setAiSource] = useState<Set<number>>(new Set()); // indices that came from AI

  // Run smart auto-map on mount or when headers change
  useEffect(() => {
    if (headers.length === 0) return;

    const step1 = exactAliasMap(headers);
    const step2 = fuzzyMap(headers, step1);
    onMappingsChange(step2);

    // Layer 3: AI suggestions for remaining unmapped headers (async)
    if (enableAI) {
      const unmapped = headers.filter((_, i) => !step2[i]);
      if (unmapped.length > 0) {
        setAiLoading(true);
        apiService.suggestColumns(headers, unmapped, TARGET_VALUES as unknown as string[])
          .then(suggestions => {
            // Apply AI suggestions to currently unmapped columns
            const newMap = { ...step2 };
            const used = new Set(Object.values(newMap));
            const newAiSource = new Set<number>();
            headers.forEach((h, i) => {
              if (newMap[i]) return;
              const suggested = suggestions[h];
              if (suggested && TARGET_VALUES.includes(suggested as any) && !used.has(suggested)) {
                newMap[i] = suggested;
                used.add(suggested);
                newAiSource.add(i);
              }
            });
            setAiSource(newAiSource);
            onMappingsChange(newMap);
          })
          .catch(() => {
            // AI unavailable — no problem, manual mapping still works
          })
          .finally(() => setAiLoading(false));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers.join(',')]);

  const mappedCount = Object.values(mappings).filter(Boolean).length;

  const handleChange = useCallback((idx: number, value: string) => {
    onMappingsChange({ ...mappings, [idx]: value });
    // Clear AI source flag if user manually changes
    setAiSource(prev => {
      const next = new Set(prev);
      next.delete(idx);
      return next;
    });
  }, [mappings, onMappingsChange]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Column Mapping ({mappedCount} mapped)
        </h3>
        {aiLoading && (
          <span className="flex items-center gap-1 text-xs text-purple-500">
            <Sparkles size={12} className="animate-pulse" />
            AI analyzing columns...
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {headers.map((h, i) => (
          <div key={i} className="flex flex-col gap-1">
            <span className="text-xs text-gray-500 dark:text-gray-400 truncate" title={h}>
              {h}
              {aiSource.has(i) && (
                <span className="ml-1 inline-flex items-center gap-0.5 text-purple-500" title="AI suggested">
                  <Sparkles size={10} />
                </span>
              )}
            </span>
            <select
              value={mappings[i] ?? ''}
              onChange={(e) => handleChange(i, e.target.value)}
              className={`text-sm rounded border dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-1 ${
                aiSource.has(i) ? 'ring-1 ring-purple-300 dark:ring-purple-700' : ''
              }`}
            >
              {TARGET_COLUMNS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
