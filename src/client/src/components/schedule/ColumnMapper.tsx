import { useEffect, useCallback, useState, useId, useRef } from 'react';
import { Sparkles } from 'lucide-react';
import { fuzzyMatchColumn } from '../../utils/fuzzyMatch';
import { apiService } from '../../services/api';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

export const TARGET_COLUMNS = [
  { value: '', label: '-- skip --' },
  { value: 'name', label: 'Task Name' },
  { value: 'phase', label: 'Phase / Group' },
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'startDate', label: 'Start' },
  { value: 'endDate', label: 'Finish' },
  { value: 'assignedTo', label: 'Resource Names' },
  { value: 'progressPercentage', label: '% Complete' },
  { value: 'estimatedDurationHours', label: 'Duration' },
  { value: 'description', label: 'Notes' },
  { value: 'actualStartDate', label: 'Actual Start' },
  { value: 'actualEndDate', label: 'Actual Finish' },
  { value: 'baselineStartDate', label: 'Baseline Start' },
  { value: 'baselineFinishDate', label: 'Baseline Finish' },
  { value: 'baselineDurationDays', label: 'Baseline Duration' },
  { value: 'baselineCost', label: 'Baseline Cost' },
] as const;

const ALIASES: Record<string, string> = {
  name: 'name', title: 'name', activity: 'name', taskname: 'name',
  status: 'status', state: 'status',
  priority: 'priority',
  start: 'startDate', startdate: 'startDate', start_date: 'startDate',
  plannedstartdate: 'startDate', plannedstart: 'startDate', targetstart: 'startDate',
  finish: 'endDate', end: 'endDate', enddate: 'endDate', end_date: 'endDate', due: 'endDate', duedate: 'endDate', due_date: 'endDate',
  plannedenddate: 'endDate', plannedend: 'endDate', targetend: 'endDate',
  resourcenames: 'assignedTo', assigned: 'assignedTo', assignedto: 'assignedTo', assigned_to: 'assignedTo', owner: 'assignedTo', assignee: 'assignedTo',
  responsibility: 'assignedTo', resource: 'assignedTo',
  complete: 'progressPercentage', progress: 'progressPercentage', progresspercentage: 'progressPercentage', percent: 'progressPercentage', percentcomplete: 'progressPercentage',
  duration: 'estimatedDurationHours', estimateddurationhours: 'estimatedDurationHours', hours: 'estimatedDurationHours',
  planneddays: 'estimatedDurationHours', days: 'estimatedDurationHours',
  notes: 'description', description: 'description', desc: 'description',
  phase: 'phase', group: 'phase', category: 'phase', section: 'phase', stage: 'phase', workstream: 'phase',
  actualstart: 'actualStartDate', actual_start: 'actualStartDate', actual_start_date: 'actualStartDate', actualstartdate: 'actualStartDate',
  actualfinish: 'actualEndDate', actual_finish: 'actualEndDate', actual_end: 'actualEndDate', actual_end_date: 'actualEndDate', actualenddate: 'actualEndDate', actual_finish_date: 'actualEndDate', actualfinishdate: 'actualEndDate',
  baselinestart: 'baselineStartDate', baseline_start: 'baselineStartDate', baseline_start_date: 'baselineStartDate', baselinestartdate: 'baselineStartDate',
  baselinefinish: 'baselineFinishDate', baseline_finish: 'baselineFinishDate', baseline_finish_date: 'baselineFinishDate', baselinefinishdate: 'baselineFinishDate', baseline_end: 'baselineFinishDate', baselineend: 'baselineFinishDate',
  baselineduration: 'baselineDurationDays', baseline_duration: 'baselineDurationDays', baseline_duration_days: 'baselineDurationDays', baselinedurationdays: 'baselineDurationDays',
  baselinecost: 'baselineCost', baseline_cost: 'baselineCost',
};

// Human-readable labels for the target fields (used in fuzzy matching)
const TARGET_LABELS: Record<string, string[]> = {
  name: ['task name', 'name', 'activity'],
  status: ['status'],
  priority: ['priority'],
  startDate: ['start', 'start date', 'planned start'],
  endDate: ['finish', 'end date', 'planned end', 'due date'],
  assignedTo: ['resource names', 'assigned to', 'assignee', 'owner', 'resource', 'responsibility'],
  progressPercentage: ['% complete', 'progress', 'percent complete'],
  estimatedDurationHours: ['duration', 'hours', 'days', 'estimated duration'],
  description: ['notes', 'description'],
  phase: [], // exact aliases only: short words like "stage" fuzzy-match "Date"
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
  /** Override target columns (default: task import columns) */
  targetColumns?: readonly { value: string; label: string }[];
  /** Override alias map (default: task import aliases) */
  aliases?: Record<string, string>;
  /** Override fuzzy-match labels (default: task import labels) */
  targetLabels?: Record<string, string[]>;
  /** First few data rows, so the AI can see what each column holds */
  sampleRows?: string[][];
  /** Target for columns nothing matched (default: skip). RAID import keeps them in notes. */
  fillUnmapped?: string;
}

const NOTES_HEADER = /note|desc|comment|remark|detail/i;

/** AI may only put a column into Notes when its header actually means notes —
 *  otherwise codes like "T1" end up as every task's note. */
export function acceptAiSuggestion(header: string, target: string): boolean {
  return target !== 'description' || NOTES_HEADER.test(header);
}

/** A "Task" column next to a separate task-name column (e.g. "Activity") holds
 *  the group each row belongs to — T1, T2… — so it becomes the phase. Same rule
 *  the server applies to a "task" header. */
export function taskColumnAsPhase(headers: string[], map: Record<number, string>, targetValues: string[]): Record<number, string> {
  const values = Object.values(map);
  if (!targetValues.includes('phase') || !values.includes('name') || values.includes('phase')) return map;
  const i = headers.findIndex((h, idx) => !map[idx] && h.trim().toLowerCase() === 'task');
  return i < 0 ? map : { ...map, [i]: 'phase' };
}

/** Up to 5 non-empty sample values per header, trimmed to keep the AI call small. */
export function sampleValues(headers: string[], headerNames: string[], rows: string[][]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const h of headerNames) {
    const i = headers.indexOf(h);
    if (i < 0) continue;
    // the first 5 non-empty values: stops reading rows once it has them (a file can have thousands)
    const values: string[] = [];
    for (const r of rows) {
      const v = (r[i] ?? '').trim();
      if (!v) continue;
      values.push(v.slice(0, 80));
      if (values.length === 5) break;
    }
    out[h] = values;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Smart auto-map: exact alias → fuzzy → AI
// ---------------------------------------------------------------------------

/** Layer 1: Exact alias matching (same as ImportModal's existing autoMap). */
function exactAliasMap(headers: string[], aliases: Record<string, string>): Record<number, string> {
  const map: Record<number, string> = {};
  const used = new Set<string>();
  headers.forEach((h, i) => {
    const key = h.toLowerCase().replace(/[^a-z0-9]/g, '');
    const target = aliases[key];
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
  targetValues: string[],
  targetLabelsMap: Record<string, string[]>,
): Record<number, string> {
  const map = { ...existing };
  const used = new Set(Object.values(map));

  // Build flat list of all label variants for unused targets
  const availableTargets: { field: string; label: string }[] = [];
  for (const field of targetValues) {
    if (used.has(field)) continue;
    for (const label of (targetLabelsMap[field] || [field])) {
      availableTargets.push({ field, label });
    }
  }

  headers.forEach((h, i) => {
    if (map[i]) return; // already mapped
    // eslint-disable-next-line no-restricted-syntax -- small: the file's column headers × the import fields' names (17 fields for a schedule)
    const labels = availableTargets.filter(t => !used.has(t.field)).map(t => t.label);
    const match = fuzzyMatchColumn(h, labels);
    if (match) {
      // eslint-disable-next-line no-restricted-syntax -- small: the file's column headers × the import fields' names (17 fields for a schedule)
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

/** Columns nothing mapped get `fillUnmapped` (RAID import keeps them in notes); without it, left as is */
function withFill(headers: string[], m: Record<number, string>, fillUnmapped?: string): Record<number, string> {
  return fillUnmapped
    ? Object.fromEntries(headers.map((_, i) => [i, m[i] || fillUnmapped])) as Record<number, string>
    : m;
}

/**
 * The AI's suggestions merged into the mappings as they are NOW (the person may have changed some
 * while waiting): only columns the rules left unmapped and nobody has set since are filled, and a
 * target already in use is never given twice.
 */
export function mergeAiSuggestions(
  headers: string[],
  current: Record<number, string>,
  rulesMap: Record<number, string>,
  suggestions: Record<string, string>,
  targets: string[],
  fillUnmapped?: string,
): { map: Record<number, string>; fromAI: Set<number> } {
  const map = { ...current };
  const used = new Set(Object.values(map).filter((v) => v && v !== fillUnmapped));
  const fromAI = new Set<number>();
  headers.forEach((h, i) => {
    if (rulesMap[i] || (map[i] && map[i] !== fillUnmapped)) return;
    const suggested = suggestions[h];
    if (suggested && targets.includes(suggested) && !used.has(suggested) && acceptAiSuggestion(h, suggested)) {
      map[i] = suggested;
      used.add(suggested);
      fromAI.add(i);
    }
  });
  return { map: withFill(headers, map, fillUnmapped), fromAI };
}

export function ColumnMapper({ headers, mappings, onMappingsChange, enableAI = true, targetColumns: customTargetColumns, aliases: customAliases, targetLabels: customTargetLabels, sampleRows, fillUnmapped }: ColumnMapperProps) {
  const mapperId = useId();
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSource, setAiSource] = useState<Set<number>>(new Set()); // indices that came from AI
  // What the rules mapped, and the headers they left for the AI. The AI is asked only when the
  // person presses "Suggest with AI" (it ran by itself on every import — audit 2026-10-10 M1).
  const [rulesMap, setRulesMap] = useState<Record<number, string>>({});
  const [unmappedHeaders, setUnmappedHeaders] = useState<string[]>([]);
  const [aiAsked, setAiAsked] = useState(false);
  const [aiFailed, setAiFailed] = useState(false);
  // The mappings as they are when the AI answers, not when it was asked
  const mappingsRef = useRef(mappings);
  useEffect(() => { mappingsRef.current = mappings; }, [mappings]);

  // Resolve effective columns/aliases/labels (custom or default)
  const effectiveTargetColumns = customTargetColumns ?? TARGET_COLUMNS;
  const effectiveAliases = customAliases ?? ALIASES;
  const effectiveTargetLabels = customTargetLabels ?? TARGET_LABELS;
  const effectiveTargetValues = effectiveTargetColumns.filter(c => c.value).map(c => c.value);

  // Run smart auto-map on mount or when headers change
  useEffect(() => {
    if (headers.length === 0) return;

    const step1 = exactAliasMap(headers, effectiveAliases);
    const step2 = taskColumnAsPhase(
      headers,
      fuzzyMap(headers, step1, effectiveTargetValues, effectiveTargetLabels),
      effectiveTargetValues,
    );
    onMappingsChange(withFill(headers, step2, fillUnmapped));
    setRulesMap(step2);
    setUnmappedHeaders(headers.filter((_, i) => !step2[i]));
    setAiSource(new Set());
    setAiAsked(false);
    setAiFailed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers.join(',')]);

  // Layer 3, on request: AI suggestions for the columns the rules left unmapped
  const suggestWithAI = () => {
    if (unmappedHeaders.length === 0) return;
    setAiAsked(true);
    setAiFailed(false);
    setAiLoading(true);
    apiService.suggestColumns(headers, unmappedHeaders, effectiveTargetValues as string[], sampleValues(headers, unmappedHeaders, (sampleRows ?? []).slice(0, 10)))
      .then(suggestions => {
        const { map, fromAI } = mergeAiSuggestions(headers, mappingsRef.current, rulesMap, suggestions, effectiveTargetValues as string[], fillUnmapped);
        setAiSource(fromAI);
        onMappingsChange(map);
      })
      .catch(() => {
        // Say so, and let them press the button again; manual mapping still works
        setAiFailed(true);
        setAiAsked(false);
      })
      .finally(() => setAiLoading(false));
  };

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
          <span className="flex items-center gap-1 text-xs text-purple-500 dark:text-purple-400">
            <Sparkles size={12} className="animate-pulse" />
            AI analyzing columns...
          </span>
        )}
        {enableAI && !aiAsked && unmappedHeaders.length > 0 && (
          <button
            type="button"
            onClick={suggestWithAI}
            className="inline-flex items-center gap-1 rounded-md bg-purple-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-purple-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2"
          >
            <Sparkles size={12} aria-hidden="true" />
            Suggest {unmappedHeaders.length === 1 ? 'the unmapped column' : `the ${unmappedHeaders.length} unmapped columns`} with AI
          </button>
        )}
      </div>
      {aiFailed && (
        <p role="alert" className="mb-2 text-xs text-red-700 dark:text-red-400">
          The AI couldn&apos;t suggest mappings just now. Map the columns yourself, or try the button again.
        </p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {headers.map((h, i) => (
          <div key={i} className="flex flex-col gap-1">
            <span id={`${mapperId}-col-${i}`} className="text-xs text-gray-500 dark:text-gray-400 truncate" title={h}>
              {h}
              {aiSource.has(i) && (
                <span className="ml-1 inline-flex items-center gap-0.5 text-purple-500 dark:text-purple-400" title="AI suggested">
                  <Sparkles size={10} />
                </span>
              )}
            </span>
            <select
              aria-labelledby={`${mapperId}-col-${i}`}
              value={mappings[i] ?? ''}
              onChange={(e) => handleChange(i, e.target.value)}
              className={`text-sm rounded border dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-1 ${
                aiSource.has(i) ? 'ring-1 ring-purple-300 dark:ring-purple-700' : ''
              }`}
            >
              {effectiveTargetColumns.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
