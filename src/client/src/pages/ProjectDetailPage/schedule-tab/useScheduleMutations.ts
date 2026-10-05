/**
 * The Schedule workspace's task changes: create / update / delete mutations, undo-redo (with the
 * Undo toast), the over-100% load warning, bar-drag / reorder / bulk edit / bulk link / group /
 * bulk delete / duplicate, all with their optimistic cache patches and the exact (schedule-scoped)
 * query keys they invalidate. Moved out of ScheduleGantt in ScheduleTab.tsx unchanged — same code,
 * same order of hook calls — code health item 4, phase 4 batch B (2026-10-05).
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

/** " · 3 tasks moved later" — appended to link messages when the re-flow moved dates */
const movedSuffix = (n: number) => (n > 0 ? ` · ${n} task${n > 1 ? 's' : ''} moved later` : '');

export interface ScheduleMutationsArgs {
  schedule: { id: string };
  tasks: GanttTask[];
  queryClient: QueryClient;
  setShowAddForm: Dispatch<SetStateAction<boolean>>;
  setActiveTaskId: Dispatch<SetStateAction<string | null>>;
  setEditingTask: Dispatch<SetStateAction<GanttTask | null>>;
}

export function useScheduleMutations({ schedule, tasks, queryClient, setShowAddForm, setActiveTaskId, setEditingTask }: ScheduleMutationsArgs) {
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
  });

  // Update task mutation
  const updateMutation = useMutation({
    mutationFn: ({ taskId, data }: { taskId: string; data: TaskFormData | Record<string, unknown> }) => {
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
      queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
      setEditingTask(null);
      announce('Task updated');
    },
    onError: (error: any) => {
      const msg = error?.response?.data?.message || error?.message || 'Failed to update task';
      console.error('Task update failed:', msg);
      announce('Error: ' + msg);
    },
  });

  // Undo/redo
  const { canUndo, canRedo, undoDescription, redoDescription, pushAction: rawPushAction, undo: rawUndo, redo } = useUndoRedo();

  // Undo toast
  const [undoToast, setUndoToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const pushAction = useCallback((action: Parameters<typeof rawPushAction>[0]) => {
    rawPushAction(action);
    setUndoToast(action.description);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setUndoToast(null), 4000);
  }, [rawPushAction]);

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
    queryClient.setQueryData(['tasks', schedule.id], (old: any) => {
      if (!old) return old;
      const list = old.data || old.tasks || old;
      if (!Array.isArray(list)) return old;
      const updated = list.map((t: any) =>
        t.id === taskId ? { ...t, ...data } : t
      );
      if (old.data) return { ...old, data: updated };
      if (old.tasks) return { ...old, tasks: updated };
      return updated;
    });
  }, [queryClient, schedule.id]);

  // Update task with undo support
  const updateTaskWithUndo = useCallback((taskId: string, data: Record<string, unknown>) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) { updateMutation.mutate({ taskId, data }); return; }
    const oldValues: Record<string, unknown> = {};
    for (const key of Object.keys(data)) {
      const val = (task as unknown as Record<string, unknown>)[key];
      oldValues[key] = val === undefined ? null : val;
    }
    // Optimistically update the cache for instant UI feedback
    patchTaskInCache(taskId, data);
    const fieldNames = Object.keys(data).join(', ');
    if ('dependencies' in data) {
      // A new predecessor can push this task and its successors later (server re-flow).
      // Undo must put those dates back as well as the old links.
      let moved: RescheduledTask[] = [];
      const run = async () => {
        const res: any = await updateMutation.mutateAsync({ taskId, data });
        moved = res?.rescheduled ?? [];
        if (moved.length) {
          const msg = `Edit ${task.name} (predecessors)${movedSuffix(moved.length)}`;
          setUndoToast(msg);
          announce(msg);
          clearTimeout(toastTimerRef.current);
          toastTimerRef.current = setTimeout(() => setUndoToast(null), 4000);
        }
      };
      pushAction({
        description: `Edit ${task.name} (${fieldNames})`,
        undo: async () => {
          await updateMutation.mutateAsync({ taskId, data: oldValues });
          if (moved.length) {
            await apiService.restoreTaskDates(schedule.id, moved.map(m => ({ taskId: m.taskId, startDate: m.oldStart, endDate: m.oldEnd })));
            queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
          }
        },
        redo: () => { run().catch(() => {}); },
      });
      run().catch(() => {});
      return;
    }
    pushAction({
      description: `Edit ${task.name} (${fieldNames})`,
      undo: () => updateMutation.mutate({ taskId, data: oldValues }),
      redo: () => updateMutation.mutate({ taskId, data }),
    });
    updateMutation.mutate({ taskId, data });
    if (typeof data.assignedTo === 'string' && data.assignedTo && data.assignedTo !== task.assignedTo) {
      warnIfOverloaded({ ...task, ...(data as Partial<GanttTask>) }, data.assignedTo);
    }
  }, [tasks, updateMutation, pushAction, patchTaskInCache, schedule.id, queryClient, warnIfOverloaded]);

  // Drag-end with undo (bar drag for dates)
  const handleTaskDragEndWithUndo = useCallback((taskId: string, newStart: string, newEnd: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const oldStart = task.startDate;
    const oldEnd = task.endDate;

    queryClient.setQueryData(['tasks', schedule.id], (old: any) => {
      if (!old) return old;
      const list = old.data || old.tasks || old;
      if (!Array.isArray(list)) return old;
      const updated = list.map((t: any) =>
        t.id === taskId ? { ...t, startDate: newStart, endDate: newEnd } : t
      );
      if (old.data) return { ...old, data: updated };
      if (old.tasks) return { ...old, tasks: updated };
      return updated;
    });

    pushAction({
      description: `Move ${task.name}`,
      undo: () => updateMutation.mutate({ taskId, data: { startDate: oldStart, endDate: oldEnd } }),
      redo: () => updateMutation.mutate({ taskId, data: { startDate: newStart, endDate: newEnd } }),
    });
    updateMutation.mutate({ taskId, data: { startDate: newStart, endDate: newEnd } });
  }, [tasks, updateMutation, pushAction, queryClient, schedule.id]);

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
    pushAction({
      description: `Reorder tasks`,
      undo: async () => {
        await apiService.bulkUpdateTasks(toBulk(oldValues));
        queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
      },
      redo: async () => {
        await apiService.bulkUpdateTasks(toBulk(updates));
        queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
      },
    });
    apiService.bulkUpdateTasks(toBulk(updates))
      .then(() => queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] }));
  }, [tasks, schedule.id, pushAction, queryClient]);

  // Bulk update with undo
  const handleBulkUpdate = useCallback(async (taskIds: string[], field: string, value: string) => {
    const oldValues = taskIds.map(id => {
      const t = tasks.find(tt => tt.id === id);
      const val = t ? (t as unknown as Record<string, unknown>)[field] : undefined;
      return { id, oldValue: val === undefined ? null : val };
    });
    const apiValue = (field === 'parentTaskId' && !value) ? null : value;
    pushAction({
      description: `Bulk update ${field} on ${taskIds.length} tasks`,
      undo: async () => {
        await apiService.bulkUpdateTasks(oldValues.map(o => ({ id: o.id, scheduleId: schedule.id, [field]: o.oldValue })));
        queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
      },
      redo: async () => {
        await apiService.bulkUpdateTasks(taskIds.map(id => ({ id, scheduleId: schedule.id, [field]: apiValue })));
        queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
      },
    });
    await apiService.bulkUpdateTasks(taskIds.map(id => ({ id, scheduleId: schedule.id, [field]: apiValue })));
    queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
  }, [tasks, schedule.id, pushAction, queryClient]);

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
    let changeId = (await apiService.bulkDeleteTasks(schedule.id, taskIds)).changeId;
    refresh();

    pushAction({
      description: `Delete ${taskIds.length} task${taskIds.length > 1 ? 's' : ''}`,
      undo: async () => { if (changeId) await apiService.undoScheduleChange(schedule.id, changeId); refresh(); },
      redo: async () => { changeId = (await apiService.bulkDeleteTasks(schedule.id, taskIds)).changeId; refresh(); },
    });
  }, [schedule.id, queryClient, pushAction]);

  // Duplicate/paste tasks — creates copies with "(copy)" suffix
  const handleDuplicateTasks = useCallback(async (srcTasks: GanttTask[]) => {
    for (const t of srcTasks) {
      await createMutation.mutateAsync({
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
      } as any);
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
    deleteMutation,
    loadWarning, setLoadWarning, loadTimerRef, warnIfOverloaded,
    patchTaskInCache, updateTaskWithUndo, handleTaskDragEndWithUndo, handleTaskReorder, handleBulkUpdate,
    rowNumbers, handleBulkLink, handleGroupTasks, handleBulkDelete, handleDuplicateTasks,
    handleKanbanStatusChange,
  };
}
