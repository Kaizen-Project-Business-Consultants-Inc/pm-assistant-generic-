/**
 * The Schedule workspace's task changes: create / update / delete mutations, undo-redo (with the
 * Undo toast), the over-100% load warning, bar-drag / reorder / bulk edit / bulk link / group /
 * bulk delete / duplicate, all with their optimistic cache patches and the exact (schedule-scoped)
 * query keys they invalidate. Moved out of ScheduleGantt in ScheduleTab.tsx unchanged — same code,
 * same order of hook calls — code health item 4, phase 4 batch B (2026-10-05).
 *
 * A failed save (2026-10-05): the screen goes back to the last saved values (only the fields that
 * save changed, and only where no later edit has changed them since), the Undo entry for it is
 * taken off the list, and `saveError` says what did not save and what to do.
 */
import { useState, useRef, useCallback, useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import { useMutation, type QueryClient } from '@tanstack/react-query';
import { apiService } from '../../../services/api';
import type { RescheduledTask } from '../../../services/api';
import { describeOverload } from '../../../utils/resourceLoad';
import type { GanttTask } from '../../../components/schedule/GanttChart';
import type { TaskFormData } from '../../../components/schedule/TaskFormModal';
import { useUndoRedo } from '../../../hooks/useUndoRedo';
import { buildRowNumberMap } from '../../../components/schedule/gantt/types';
import { buildBulkLinks, type BulkLinkMode } from '../../../components/schedule/bulkLink';
import { announce } from '../../../utils/announce';
import { SHOWN_AGAIN, TRY_AGAIN, saveFailedMessage } from '../../../utils/saveFailedMessage';

/** " · 3 tasks moved later" — appended to link messages when the re-flow moved dates */
const movedSuffix = (n: number) => (n > 0 ? ` · ${n} task${n > 1 ? 's' : ''} moved later` : '');

/** The fields an optimistic edit changed: what they were before, and what the edit set */
export interface OptimisticPatch {
  taskId: string;
  before: Record<string, { had: boolean; value: unknown }>;
  after: Record<string, unknown>;
}

type UpdateVars = { taskId: string; data: TaskFormData | Record<string, unknown>; optimistic?: OptimisticPatch };

const sameValue = (a: unknown, b: unknown) => Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);

export interface ScheduleMutationsArgs {
  schedule: { id: string };
  tasks: GanttTask[];
  queryClient: QueryClient;
  setShowAddForm: Dispatch<SetStateAction<boolean>>;
  setActiveTaskId: Dispatch<SetStateAction<string | null>>;
  setEditingTask: Dispatch<SetStateAction<GanttTask | null>>;
}

/** Plain-English Undo text for a bulk change, e.g. "Status changed on 3 tasks" */
export function bulkUpdateDescription(field: string, value: string, count: number): string {
  const tasks = `${count} task${count === 1 ? '' : 's'}`;
  if (field === 'parentTaskId') return value ? `Indented ${tasks}` : `Outdented ${tasks}`;
  const label: Record<string, string> = { status: 'Status', priority: 'Priority', assignedTo: 'Assignee' };
  return `${label[field] ?? field} changed on ${tasks}`;
}

export function useScheduleMutations({ schedule, tasks, queryClient, setShowAddForm, setActiveTaskId, setEditingTask }: ScheduleMutationsArgs) {
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const taskName = (taskId: string) => tasksRef.current.find(t => t.id === taskId)?.name;

  // What did not save: shown until dismissed, replaced by the next one, or cleared by a good save
  const [saveError, setSaveError] = useState<string | null>(null);

  // Every task list in the cache for this plan is the one key ['tasks', schedule.id] (Lesson 5)
  const mapCachedTasks = useCallback((fn: (t: any) => any) => {
    queryClient.setQueryData(['tasks', schedule.id], (old: any) => {
      if (!old) return old;
      const list = old.data || old.tasks || old;
      if (!Array.isArray(list)) return old;
      const updated = list.map(fn);
      if (old.data) return { ...old, data: updated };
      if (old.tasks) return { ...old, tasks: updated };
      return updated;
    });
  }, [queryClient, schedule.id]);

  // Put back the fields a failed save changed, but not a field a later edit has changed since
  // (that edit is still on its way, or saved; the refetch after the last save shows the truth)
  const rollbackPatch = useCallback((p: OptimisticPatch) => {
    mapCachedTasks(t => {
      if (t.id !== p.taskId) return t;
      let next = t;
      for (const [key, snap] of Object.entries(p.before)) {
        if (!sameValue(t[key], p.after[key])) continue;
        if (next === t) next = { ...t };
        if (snap.had) next[key] = snap.value; else delete next[key];
      }
      return next;
    });
  }, [mapCachedTasks]);

  const updateKey = useMemo(() => ['updateTask', schedule.id], [schedule.id]);

  // The error replaces the Undo toast in the same spot; screen readers hear it via announce()
  const showSaveError = useCallback((message: string) => {
    setSaveError(message);
    setUndoToast(null); // declared below; only called from save callbacks, after render
    announce(message);
  }, []);
  const createBaselineMutation = useMutation({
    mutationFn: () => apiService.createBaseline(schedule.id, `Baseline ${new Date().toLocaleDateString()}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['baselines', schedule.id] });
    },
  });

  // Create task mutation
  const createMutation = useMutation({
    mutationFn: (data: TaskFormData & { afterTaskId?: string; beforeTaskId?: string }) => {
      const deps = (data.predecessors || [])
        .filter(p => p.dependencyId)
        .map(p => ({ dependencyId: p.dependencyId, dependencyType: p.dependencyType || 'FS', lagDays: parseInt(p.lagDays) || 0 }));
      const payload: Record<string, unknown> = {
        name: data.name,
        description: data.description || undefined,
        status: data.status,
        priority: data.priority,
        assignedTo: data.assignedTo || undefined,
        startDate: data.startDate || undefined,
        endDate: data.endDate || undefined,
        progressPercentage: data.progressPercentage,
        parentTaskId: data.parentTaskId || undefined,
        estimatedDays: data.estimatedDays ? parseInt(data.estimatedDays) : undefined,
        recurrenceRule: data.recurrenceRule || undefined,
        isRecurrenceTemplate: data.isRecurrenceTemplate || undefined,
        isMilestone: data.isMilestone || undefined,
        constraintType: data.constraintType && data.constraintType !== 'ASAP' ? data.constraintType : undefined,
        constraintDate: data.constraintDate || undefined,
        workHours: data.workHours ? parseFloat(data.workHours) : undefined,
        effortDriven: data.effortDriven || undefined,
        assignments: data.assignments?.filter(a => a.resourceId).length ? data.assignments.filter(a => a.resourceId) : undefined,
        dependencies: deps.length > 0 ? deps : undefined,
        afterTaskId: data.afterTaskId || undefined,
        beforeTaskId: data.beforeTaskId || undefined,
      };
      return apiService.createTask(schedule.id, payload as Parameters<typeof apiService.createTask>[1]);
    },
    onSuccess: (result: any) => {
      const createdTask = result?.task || result;
      // Auto-expand recurrence if this is a template
      if (createdTask?.isRecurrenceTemplate && createdTask?.id) {
        apiService.expandRecurrence(schedule.id, createdTask.id).then(() => {
          queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
        }).catch(() => { /* silent */ });
      }
      queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
      setShowAddForm(false);
      setActiveTaskId(null);
      announce('Task created');
    },
    onError: (error: unknown, data) => {
      showSaveError(saveFailedMessage(`The new task${data?.name ? ` "${data.name}"` : ''} was not created`, error, TRY_AGAIN));
    },
  });

  // Update task mutation
  const updateMutation = useMutation({
    mutationKey: updateKey,
    mutationFn: ({ taskId, data }: UpdateVars) => {
      if ('name' in data && 'status' in data && 'priority' in data && 'assignedTo' in data) {
        const d = data as TaskFormData;
        const deps = (d.predecessors || [])
          .filter(p => p.dependencyId)
          .map(p => ({ dependencyId: p.dependencyId, dependencyType: p.dependencyType || 'FS', lagDays: parseInt(p.lagDays) || 0 }));
        const payload: Record<string, unknown> = {
          name: d.name,
          description: d.description || undefined,
          status: d.status,
          priority: d.priority,
          assignedTo: d.assignedTo || undefined,
          startDate: d.startDate || undefined,
          endDate: d.endDate || undefined,
          progressPercentage: d.progressPercentage,
          parentTaskId: d.parentTaskId || undefined,
          estimatedDays: d.estimatedDays ? parseInt(d.estimatedDays) : undefined,
          recurrenceRule: d.recurrenceRule || undefined,
          isRecurrenceTemplate: d.isRecurrenceTemplate || undefined,
          isMilestone: d.isMilestone || undefined,
          constraintType: d.constraintType && d.constraintType !== 'ASAP' ? d.constraintType : undefined,
          constraintDate: d.constraintDate || undefined,
          workHours: d.workHours ? parseFloat(d.workHours) : undefined,
          effortDriven: d.effortDriven || undefined,
          assignments: d.assignments?.filter(a => a.resourceId).length ? d.assignments.filter(a => a.resourceId) : undefined,
          dependencies: deps,
        };
        return apiService.updateTask(schedule.id, taskId, payload);
      }
      return apiService.updateTask(schedule.id, taskId, data as Record<string, unknown>);
    },
    onSuccess: () => {
      setEditingTask(null);
      setSaveError(null);
      announce('Task updated');
    },
    onError: (error: any, vars) => {
      const msg = error?.response?.data?.message || error?.message || 'Failed to update task';
      console.error('Task update failed:', msg);
      if (vars.optimistic) rollbackPatch(vars.optimistic);
      const before = vars.optimistic?.before.name;
      const name = before?.had && typeof before.value === 'string' ? before.value : taskName(vars.taskId);
      showSaveError(saveFailedMessage(`Your change to ${name ? `"${name}"` : 'this task'} was not saved`, error, vars.optimistic ? SHOWN_AGAIN : TRY_AGAIN));
    },
    // Refetch when the last save still on its way has finished, failed or not (an earlier
    // refetch would briefly show a later edit as not made). Same key as before (Lesson 5).
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: updateKey }) <= 1) {
        queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
      }
    },
  });

  // Resolves true when saved, false when not (the message and the put-back are done by onError)
  const saveTask = useCallback((vars: UpdateVars): Promise<boolean> =>
    updateMutation.mutateAsync(vars).then(() => true, () => false), [updateMutation]);

  // Undo/redo
  const { canUndo, canRedo, undoDescription, redoDescription, pushAction: rawPushAction, removeAction, undo: rawUndo, redo } = useUndoRedo();

  // Undo toast
  const [undoToast, setUndoToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const toastActionRef = useRef<Parameters<typeof rawPushAction>[0] | null>(null);

  const pushAction = useCallback((action: Parameters<typeof rawPushAction>[0]) => {
    rawPushAction(action);
    toastActionRef.current = action;
    setUndoToast(action.description);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setUndoToast(null), 4000);
  }, [rawPushAction]);

  // The save behind an Undo entry failed: there is nothing to undo, so the entry (and its toast) goes
  const dropFailedAction = useCallback((action: Parameters<typeof rawPushAction>[0]) => {
    removeAction(action);
    if (toastActionRef.current === action) {
      toastActionRef.current = null;
      setUndoToast(null);
      clearTimeout(toastTimerRef.current);
    }
  }, [removeAction]);

  const undo = useCallback(() => {
    rawUndo();
    setUndoToast(null);
    clearTimeout(toastTimerRef.current);
  }, [rawUndo]);

  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  // Delete one task (task form, Gantt menu). Recorded in Schedule History like a bulk delete, so
  // Ctrl+Z goes through the History undo: the task comes back under its old id with its links,
  // booked hours, people and comments
  const deleteMutation = useMutation({
    mutationFn: (taskId: string) => apiService.deleteTask(schedule.id, taskId),
    onError: (error: unknown, taskId) => {
      const name = taskName(taskId);
      showSaveError(saveFailedMessage(`${name ? `"${name}"` : 'The task'} was not deleted`, error, TRY_AGAIN));
    },
    onSuccess: (res, taskId) => {
      const refresh = () => {
        queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
        queryClient.invalidateQueries({ queryKey: ['schedule-changes', schedule.id] });
      };
      refresh();
      setEditingTask(null);
      setActiveTaskId(null);
      announce('Task deleted');
      let changeId = res?.changeId ?? null;
      const name = tasks.find(t => t.id === taskId)?.name;
      pushAction({
        description: name ? `Delete ${name}` : 'Delete 1 task',
        undo: async () => { if (changeId) await apiService.undoScheduleChange(schedule.id, changeId); refresh(); },
        redo: async () => { changeId = (await apiService.deleteTask(schedule.id, taskId)).changeId; refresh(); },
      });
    },
  });

  // Over-100% warning after Assigned To is changed in the table/Gantt cell (warning only)
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const loadTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(loadTimerRef.current), []);
  const warnIfOverloaded = useCallback((task: GanttTask, resourceId: string) => {
    if (!resourceId || !task.startDate || !task.endDate || task.isMilestone || task.isSummary) return;
    const pct = task.assignments?.find(a => a.resourceId === resourceId)?.allocationPct ?? 100;
    apiService.checkResourceLoad({
      resourceId, startDate: String(task.startDate).slice(0, 10), endDate: String(task.endDate).slice(0, 10), allocationPct: pct, excludeTaskId: task.id,
    }).then(res => {
      const text = describeOverload(res);
      if (!text) return;
      setLoadWarning(text);
      announce(text);
      clearTimeout(loadTimerRef.current);
      loadTimerRef.current = setTimeout(() => setLoadWarning(null), 10_000);
    }).catch(() => {}); // not a resource (free text) or offline — nothing to warn about
  }, []);

  // Optimistically patch a single task in the query cache
  const patchTaskInCache = useCallback((taskId: string, data: Record<string, unknown>) => {
    mapCachedTasks((t: any) => (t.id === taskId ? { ...t, ...data } : t));
  }, [mapCachedTasks]);

  // The optimistic edit, react-query's onMutate steps done just before mutate() so the screen
  // changes in the same render as the drag or keystroke: stop a refetch of this plan's tasks that
  // is on its way (it would overwrite the edit with older data), note the fields' saved values,
  // patch. onError puts them back.
  const applyOptimisticPatch = useCallback((taskId: string, data: Record<string, unknown>): OptimisticPatch => {
    void queryClient.cancelQueries({ queryKey: ['tasks', schedule.id], exact: true });
    const old: any = queryClient.getQueryData(['tasks', schedule.id]);
    const list = old ? (old.data || old.tasks || old) : null;
    const current = Array.isArray(list) ? list.find((t: any) => t.id === taskId) : undefined;
    const before: OptimisticPatch['before'] = {};
    for (const key of Object.keys(data)) {
      before[key] = current && key in current ? { had: true, value: current[key] } : { had: false, value: undefined };
    }
    patchTaskInCache(taskId, data);
    return { taskId, before, after: data };
  }, [queryClient, schedule.id, patchTaskInCache]);

  // Update task with undo support. Resolves true when saved (the Table/Gantt cell flashes "saved"
  // only then), false when not.
  const updateTaskWithUndo = useCallback((taskId: string, data: Record<string, unknown>): Promise<boolean> => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return saveTask({ taskId, data });
    const oldValues: Record<string, unknown> = {};
    for (const key of Object.keys(data)) {
      const val = (task as unknown as Record<string, unknown>)[key];
      oldValues[key] = val === undefined ? null : val;
    }
    // Optimistically update the cache for instant UI feedback
    const optimistic = applyOptimisticPatch(taskId, data);
    const fieldNames = Object.keys(data).join(', ');
    if ('dependencies' in data) {
      // A new predecessor can push this task and its successors later (server re-flow).
      // Undo must put those dates back as well as the old links.
      let moved: RescheduledTask[] = [];
      const run = async (patch?: OptimisticPatch) => {
        const res: any = await updateMutation.mutateAsync({ taskId, data, optimistic: patch });
        moved = res?.rescheduled ?? [];
        if (moved.length) {
          const msg = `Edit ${task.name} (predecessors)${movedSuffix(moved.length)}`;
          setUndoToast(msg);
          announce(msg);
          clearTimeout(toastTimerRef.current);
          toastTimerRef.current = setTimeout(() => setUndoToast(null), 4000);
        }
      };
      const depAction = {
        description: `Edit ${task.name} (${fieldNames})`,
        undo: async () => {
          await updateMutation.mutateAsync({ taskId, data: oldValues });
          if (moved.length) {
            await apiService.restoreTaskDates(schedule.id, moved.map(m => ({ taskId: m.taskId, startDate: m.oldStart, endDate: m.oldEnd })));
            queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
          }
        },
        redo: () => { run().catch(() => {}); },
      };
      pushAction(depAction);
      return run(optimistic).then(() => true, () => { dropFailedAction(depAction); return false; });
    }
    const action = {
      description: `Edit ${task.name} (${fieldNames})`,
      undo: () => updateMutation.mutate({ taskId, data: oldValues }),
      redo: () => updateMutation.mutate({ taskId, data }),
    };
    pushAction(action);
    return saveTask({ taskId, data, optimistic }).then(ok => {
      if (!ok) { dropFailedAction(action); return false; }
      // The over-100% warning only for an assignment that was actually saved
      if (typeof data.assignedTo === 'string' && data.assignedTo && data.assignedTo !== task.assignedTo) {
        warnIfOverloaded({ ...task, ...(data as Partial<GanttTask>) }, data.assignedTo);
      }
      return true;
    });
  }, [tasks, updateMutation, saveTask, pushAction, dropFailedAction, applyOptimisticPatch, schedule.id, queryClient, warnIfOverloaded]);

  // Drag-end with undo (bar drag for dates)
  const handleTaskDragEndWithUndo = useCallback((taskId: string, newStart: string, newEnd: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const oldStart = task.startDate;
    const oldEnd = task.endDate;

    const optimistic = applyOptimisticPatch(taskId, { startDate: newStart, endDate: newEnd });

    const action = {
      description: `Move ${task.name}`,
      undo: () => updateMutation.mutate({ taskId, data: { startDate: oldStart, endDate: oldEnd } }),
      redo: () => updateMutation.mutate({ taskId, data: { startDate: newStart, endDate: newEnd } }),
    };
    pushAction(action);
    saveTask({ taskId, data: { startDate: newStart, endDate: newEnd }, optimistic })
      .then(ok => { if (!ok) dropFailedAction(action); });
  }, [tasks, updateMutation, saveTask, pushAction, dropFailedAction, applyOptimisticPatch]);

  // Row reorder with undo (supports cross-parent reparenting)
  const handleTaskReorder = useCallback((updates: Array<{ taskId: string; sortOrder: number; parentTaskId?: string | null }>) => {
    const oldValues = updates.map(u => {
      const t = tasks.find(tt => tt.id === u.taskId);
      return {
        taskId: u.taskId,
        sortOrder: t?.sortOrder ?? 0,
        ...(u.parentTaskId !== undefined ? { parentTaskId: t?.parentTaskId || null } : {}),
      };
    });
    const toBulk = (items: typeof updates) => items.map(u => {
      const entry: { id: string; scheduleId: string; sortOrder: number; parentTaskId?: string | null } = { id: u.taskId, scheduleId: schedule.id, sortOrder: u.sortOrder };
      if (u.parentTaskId !== undefined) entry.parentTaskId = u.parentTaskId;
      return entry;
    });
    const action = {
      description: `Reorder tasks`,
      undo: async () => {
        await apiService.bulkUpdateTasks(toBulk(oldValues));
        queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
      },
      redo: async () => {
        await apiService.bulkUpdateTasks(toBulk(updates));
        queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
      },
    };
    pushAction(action);
    apiService.bulkUpdateTasks(toBulk(updates))
      .then(() => queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] }), (error: unknown) => {
        dropFailedAction(action);
        queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
        showSaveError(saveFailedMessage('The new row order was not saved', error, TRY_AGAIN));
      });
  }, [tasks, schedule.id, pushAction, dropFailedAction, queryClient, showSaveError]);

  // Bulk update with undo
  const handleBulkUpdate = useCallback(async (taskIds: string[], field: string, value: string) => {
    const oldValues = taskIds.map(id => {
      const t = tasks.find(tt => tt.id === id);
      const val = t ? (t as unknown as Record<string, unknown>)[field] : undefined;
      return { id, oldValue: val === undefined ? null : val };
    });
    const apiValue = (field === 'parentTaskId' && !value) ? null : value;
    const action = {
      description: bulkUpdateDescription(field, value, taskIds.length),
      undo: async () => {
        await apiService.bulkUpdateTasks(oldValues.map(o => ({ id: o.id, scheduleId: schedule.id, [field]: o.oldValue })));
        queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
      },
      redo: async () => {
        await apiService.bulkUpdateTasks(taskIds.map(id => ({ id, scheduleId: schedule.id, [field]: apiValue })));
        queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
      },
    };
    pushAction(action);
    try {
      await apiService.bulkUpdateTasks(taskIds.map(id => ({ id, scheduleId: schedule.id, [field]: apiValue })));
    } catch (error) {
      // Thrown on, so the bulk bar does not say "Updated"
      dropFailedAction(action);
      showSaveError(saveFailedMessage(`The change to ${taskIds.length} task${taskIds.length === 1 ? '' : 's'} was not saved`, error, TRY_AGAIN));
      throw error;
    } finally {
      queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
    }
  }, [tasks, schedule.id, pushAction, dropFailedAction, queryClient, showSaveError]);

  // Link selected tasks (chain / all wait on a row / a row waits on all) with undo.
  // Rows are the fixed row numbers, so this works the same under any sort or filter.
  const rowNumbers = useMemo(() => buildRowNumberMap(tasks), [tasks]);
  const handleBulkLink = useCallback(async (mode: BulkLinkMode, taskIds: string[], target?: string): Promise<string> => {
    const built = buildBulkLinks(mode, taskIds, rowNumbers, target);
    if ('error' in built) throw new Error(built.error);
    let result;
    try {
      result = await apiService.bulkLinkTasks(schedule.id, built.links);
    } catch (e: any) {
      throw new Error(e?.response?.data?.message || 'Linking failed. Nothing was changed.');
    }
    if (result.added.length === 0) throw new Error('Those tasks are already linked — nothing was added');
    queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
    const added = result.added;
    let moved = result.moved ?? [];
    const refresh = () => queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
    const description = built.description + movedSuffix(moved.length);
    pushAction({
      description,
      // Undo removes the links, then puts every task the re-flow moved back on its old dates
      undo: async () => {
        await apiService.bulkUnlinkTasks(schedule.id, added);
        if (moved.length) await apiService.restoreTaskDates(schedule.id, moved.map(m => ({ taskId: m.taskId, startDate: m.oldStart, endDate: m.oldEnd })));
        refresh();
      },
      redo: async () => { moved = (await apiService.bulkLinkTasks(schedule.id, added)).moved ?? []; refresh(); },
    });
    announce(description);
    return description;
  }, [rowNumbers, schedule.id, queryClient, pushAction]);

  // Group the selected tasks under a new summary task; undo goes through Schedule History
  const handleGroupTasks = useCallback(async (taskIds: string[], name: string): Promise<string> => {
    let result;
    try {
      result = await apiService.groupTasks(schedule.id, taskIds, name);
    } catch (e: any) {
      throw new Error(e?.response?.data?.message || 'Grouping failed. Nothing was changed.');
    }
    const refresh = () => queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
    refresh();
    let changeId = result.changeId;
    const description = `Grouped ${result.grouped} tasks under '${name}'`;
    pushAction({
      description,
      undo: async () => { if (changeId) await apiService.undoScheduleChange(schedule.id, changeId); refresh(); },
      redo: async () => { changeId = (await apiService.groupTasks(schedule.id, taskIds, name)).changeId; refresh(); },
    });
    announce(description);
    return description;
  }, [schedule.id, queryClient, pushAction]);

  // Bulk delete; undo goes through Schedule History, which puts the tasks back under their old
  // ids with their links, booked hours, people and comments (it used to recreate them as new tasks)
  const handleBulkDelete = useCallback(async (taskIds: string[]) => {
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
      queryClient.invalidateQueries({ queryKey: ['schedule-changes', schedule.id] });
    };
    let changeId: Awaited<ReturnType<typeof apiService.bulkDeleteTasks>>['changeId'];
    try {
      changeId = (await apiService.bulkDeleteTasks(schedule.id, taskIds)).changeId;
    } catch (error) {
      // Nothing leaves the screen before the server agrees, so there is nothing to put back
      const n = taskIds.length;
      showSaveError(saveFailedMessage(`${n} task${n === 1 ? ' was' : 's were'} not deleted`, error, TRY_AGAIN));
      throw error;
    }
    refresh();

    pushAction({
      description: `Deleted ${taskIds.length} task${taskIds.length > 1 ? 's' : ''}`,
      undo: async () => { if (changeId) await apiService.undoScheduleChange(schedule.id, changeId); refresh(); },
      redo: async () => { changeId = (await apiService.bulkDeleteTasks(schedule.id, taskIds)).changeId; refresh(); },
    });
  }, [schedule.id, queryClient, pushAction, showSaveError]);

  // Duplicate/paste tasks — creates copies with "(copy)" suffix
  const handleDuplicateTasks = useCallback(async (srcTasks: GanttTask[]) => {
    for (const t of srcTasks) {
      // Stop at the first copy that fails (createMutation's onError says which); the callers don't wait
      const ok = await createMutation.mutateAsync({
        name: `${t.name} (copy)`,
        status: t.status || 'pending',
        priority: t.priority || 'medium',
        assignedTo: t.assignedTo || '',
        startDate: t.startDate || '',
        endDate: t.endDate || '',
        progressPercentage: t.progressPercentage || 0,
        description: t.description || '',
        parentTaskId: t.parentTaskId || undefined,
        estimatedDays: t.estimatedDays != null ? String(t.estimatedDays) : undefined,
        isMilestone: t.isMilestone || undefined,
      } as any).then(() => true, () => false);
      if (!ok) return;
    }
  }, [createMutation]);

  // Kanban status change
  const handleKanbanStatusChange = (taskId: string, newStatus: string) => {
    updateMutation.mutate({ taskId, data: { status: newStatus } });
  };

  return {
    createBaselineMutation, createMutation, updateMutation,
    canUndo, canRedo, undoDescription, redoDescription, pushAction, undo, redo,
    undoToast, setUndoToast, toastTimerRef,
    saveError, setSaveError,
    deleteMutation,
    loadWarning, setLoadWarning, loadTimerRef, warnIfOverloaded,
    patchTaskInCache, updateTaskWithUndo, handleTaskDragEndWithUndo, handleTaskReorder, handleBulkUpdate,
    rowNumbers, handleBulkLink, handleGroupTasks, handleBulkDelete, handleDuplicateTasks,
    handleKanbanStatusChange,
  };
}
