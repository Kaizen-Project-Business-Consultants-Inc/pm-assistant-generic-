import { useState, useMemo, useCallback } from 'react';
import type { GanttTask } from '../../GanttChart';
import { compareOutlineOrder } from '../../gantt/types';
import type { ColumnKey } from '../../tableColumns';
import type { SortDir, GroupByField, CpmTaskData, BaselineTaskVariance } from '../types';
import { workingDaysBetween, type WorkCalendar } from '../../../../utils/workingDays';
import {
  buildSuccessorIds,
  firstPredecessorRowNum,
  firstSuccessorRowNum,
  resourceSortName,
  assignedSortName,
  notesSortText,
  compareSortValues,
} from '../../sortValues';

const EMPTY_ROW_NUMS = new Map<string, number>();
const EMPTY_NAMES = new Map<string, string>();

/**
 * The Table view's sort and grouping: column-header sort (asc -> desc -> off), sort values
 * for every column, the outline-ordered (or sorted-within-siblings) flattened row list that
 * respects collapsed summaries, and the group-by buckets with their collapse state.
 * Moved out of TableView.tsx unchanged (2026-10-05, code-health item 4 phase 3).
 * 2026-10-06: Predecessor, Successor, Resource, the cost columns and the constraint columns
 * sort; Notes, Predecessor, Successor and Resource put blanks last; Assigned sorts by the name
 * shown. The per-column values are shared with the Gantt (schedule/sortValues.ts).
 */
export function useTableGrouping({
  tasks,
  cpmMap,
  baselineMap,
  workCalendar,
  rowNumMap = EMPTY_ROW_NUMS,
  resourceNameOf = EMPTY_NAMES,
}: {
  tasks: GanttTask[];
  cpmMap: Map<string, CpmTaskData>;
  baselineMap: Map<string, BaselineTaskVariance>;
  workCalendar?: WorkCalendar | null;
  /** Fixed row numbers (whole plan), for the Predecessor / Successor sorts */
  rowNumMap?: Map<string, number>;
  /** Resource / person id → name, for the Assigned and Resource sorts */
  resourceNameOf?: Map<string, string>;
}) {
  const [sortField, setSortField] = useState<ColumnKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [groupBy, setGroupBy] = useState<GroupByField>('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [collapsedSummaries, setCollapsedSummaries] = useState<Set<string>>(new Set());

  const toggleSort = useCallback((field: ColumnKey) => {
    if (sortField === field) {
      if (sortDir === 'asc') {
        setSortDir('desc');
      } else {
        setSortField(null);
        setSortDir('asc');
      }
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }, [sortField, sortDir]);

  const successorIds = useMemo(
    () => (sortField === 'successor' ? buildSuccessorIds(tasks) : new Map<string, string[]>()),
    [sortField, tasks],
  );

  // Get a sortable value for any column (null = blank, sorts last either way)
  const getSortValue = useCallback((task: GanttTask, field: ColumnKey): any => {
    switch (field) {
      case 'name': return task.name.toLowerCase();
      case 'status': return task.status;
      case 'priority': {
        const order = { urgent: 0, high: 1, medium: 2, low: 3 };
        return order[(task.priority || 'medium') as keyof typeof order] ?? 2;
      }
      case 'startDate': return task.startDate || '';
      case 'endDate': return task.endDate || '';
      case 'progressPercentage': return task.progressPercentage ?? 0;
      case 'assignedTo': return assignedSortName(task, resourceNameOf);
      case 'notes': return notesSortText(task);
      case 'dependency': return firstPredecessorRowNum(task, rowNumMap);
      case 'successor': return firstSuccessorRowNum(task.id, successorIds, rowNumMap);
      case 'resource': return resourceSortName(task, resourceNameOf);
      case 'budgetAllocated': return (task as any).budgetAllocated ?? null;
      case 'actualCost': return (task as any).actualCost ?? null;
      case 'budgetVariance': {
        const budget = (task as any).budgetAllocated;
        const actual = (task as any).actualCost;
        if (budget == null && actual == null) return null;
        return Number(budget ?? 0) - Number(actual ?? 0);
      }
      case 'constraintType': return (task as any).constraintType || 'ASAP';
      case 'constraintDate': return (task as any).constraintDate || null;
      case 'duration': {
        const span = workingDaysBetween(task.startDate, task.endDate, workCalendar);
        if (span) return span;
        return task.estimatedDays ?? 0;
      }
      case 'earlyStart': return cpmMap.get(task.id)?.ES ?? Infinity;
      case 'earlyFinish': return cpmMap.get(task.id)?.EF ?? Infinity;
      case 'lateStart': return cpmMap.get(task.id)?.LS ?? Infinity;
      case 'lateFinish': return cpmMap.get(task.id)?.LF ?? Infinity;
      case 'totalFloat': return cpmMap.get(task.id)?.totalFloat ?? Infinity;
      case 'freeFloat': return cpmMap.get(task.id)?.freeFloat ?? Infinity;
      case 'critical': return cpmMap.get(task.id)?.isCritical ? 0 : 1;
      case 'baselineStart': return (task as any).baselineStartDate || baselineMap.get(task.id)?.baselineStart || '';
      case 'baselineEnd': return (task as any).baselineFinishDate || baselineMap.get(task.id)?.baselineEnd || '';
      case 'startVariance': return baselineMap.get(task.id)?.startVarianceDays ?? Infinity;
      case 'endVariance': return baselineMap.get(task.id)?.endVarianceDays ?? Infinity;
      case 'actualStartDate': return (task as any).actualStartDate || '';
      case 'actualEndDate': return (task as any).actualEndDate || '';
      case 'baselineDuration': return (task as any).baselineDurationDays ?? Infinity;
      case 'baselineCost': return (task as any).baselineCost ?? Infinity;
      default: return '';
    }
  }, [cpmMap, baselineMap, workCalendar, rowNumMap, successorIds, resourceNameOf]);

  const sorted = useMemo(() => {
    const taskIds = new Set(tasks.map(t => t.id));
    const childrenOf = new Map<string | null, GanttTask[]>();
    for (const t of tasks) {
      const parent = (t.parentTaskId && taskIds.has(t.parentTaskId)) ? t.parentTaskId : null;
      if (!childrenOf.has(parent)) childrenOf.set(parent, []);
      childrenOf.get(parent)!.push(t);
    }

    const sortChildren = (list: GanttTask[]) => {
      if (!sortField) {
        return [...list].sort(compareOutlineOrder);
      }
      const dir = sortDir === 'asc' ? 1 : -1;
      return [...list].sort((a, b) => compareSortValues(getSortValue(a, sortField), getSortValue(b, sortField), dir));
    };

    const summaryIds = new Set<string>();
    for (const [parentId] of childrenOf) {
      if (parentId !== null) summaryIds.add(parentId);
    }

    const result: GanttTask[] = [];
    const flatten = (parentId: string | null) => {
      const children = childrenOf.get(parentId);
      if (!children) return;
      for (const child of sortChildren(children)) {
        result.push(child);
        if (!collapsedSummaries.has(child.id)) {
          flatten(child.id);
        }
      }
    };
    flatten(null);
    return { rows: result, summaryIds };
  }, [tasks, sortField, sortDir, getSortValue, collapsedSummaries]);

  const visibleSorted = sorted.rows;
  const summaryTaskIds = sorted.summaryIds;

  const toggleSummaryCollapse = useCallback((taskId: string) => {
    setCollapsedSummaries(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  // Group tasks
  const groupedSorted = useMemo(() => {
    if (!groupBy) return null;
    const groups = new Map<string, GanttTask[]>();
    for (const task of visibleSorted) {
      let key: string;
      if (groupBy === 'status') key = task.status || 'unknown';
      else if (groupBy === 'priority') key = task.priority || 'medium';
      else key = task.assignedTo || 'Unassigned';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(task);
    }
    return groups;
  }, [visibleSorted, groupBy]);

  const toggleGroupCollapse = useCallback((key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  return {
    sortField, setSortField, sortDir, setSortDir,
    groupBy, setGroupBy,
    collapsedGroups, setCollapsedGroups,
    collapsedSummaries, setCollapsedSummaries,
    toggleSort, getSortValue,
    visibleSorted, summaryTaskIds, toggleSummaryCollapse,
    groupedSorted, toggleGroupCollapse,
  };
}
