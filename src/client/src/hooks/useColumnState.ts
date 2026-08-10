import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { COLUMN_DEFS, DEFAULT_VISIBLE_KEYS, SCHEDULING_KEYS } from '../components/schedule/tableColumns';
import type { ColumnKey, ColumnGroup, ColumnDef } from '../components/schedule/tableColumns';
import { apiService } from '../services/api';

export interface ColumnState {
  visibleKeys: Set<ColumnKey>;
  columnOrder: ColumnKey[];
  colWidths: Record<string, number>;
  visibleColumns: ColumnDef[];
  toggleColumn: (key: ColumnKey) => void;
  toggleGroup: (group: ColumnGroup, visible: boolean) => void;
  setVisibleKeys: React.Dispatch<React.SetStateAction<Set<ColumnKey>>>;
  setColumnOrder: React.Dispatch<React.SetStateAction<ColumnKey[]>>;
  setColWidths: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  moveColumn: (colKey: ColumnKey, direction: 'left' | 'right') => void;
  cpmNeeded: boolean;
}

interface PerScheduleColumnState {
  visibleKeys: ColumnKey[];
  columnOrder: ColumnKey[];
  colWidths: Record<string, number>;
}

/** Debounce timer for server sync — shared across instances */
let syncTimer: ReturnType<typeof setTimeout> | null = null;

function syncToServer(scheduleId: string, state: PerScheduleColumnState) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    apiService.getViewPreferences()
      .then((res: any) => {
        const existing = res?.preferences || {};
        const columnStates = existing.columnStates || {};
        columnStates[scheduleId] = state;
        return apiService.updateViewPreferences({ ...existing, columnStates });
      })
      .catch(() => {/* silent */});
  }, 1500);
}

export function useColumnState(scheduleId: string): ColumnState {
  const [visibleKeys, setVisibleKeys] = useState<Set<ColumnKey>>(() => {
    try {
      const stored = localStorage.getItem(`tableview-cols:${scheduleId}`);
      if (stored) {
        const keys = new Set(JSON.parse(stored) as ColumnKey[]);
        keys.add('rowNum'); // always visible
        return keys;
      }
    } catch {}
    return new Set(DEFAULT_VISIBLE_KEYS);
  });

  const [columnOrder, setColumnOrder] = useState<ColumnKey[]>(() => {
    try {
      const stored = localStorage.getItem(`tableview-col-order:${scheduleId}`);
      if (stored) return JSON.parse(stored) as ColumnKey[];
    } catch {}
    return [];
  });

  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    try {
      const stored = localStorage.getItem(`tableview-col-widths:${scheduleId}`);
      if (stored) return JSON.parse(stored);
    } catch {}
    return {};
  });

  // Track whether server prefs have been loaded to avoid overwriting on first persist
  const serverLoaded = useRef(false);

  // On mount: fetch server-side column state and apply if present
  useEffect(() => {
    apiService.getViewPreferences()
      .then((res: any) => {
        const prefs = res?.preferences;
        const saved: PerScheduleColumnState | undefined = prefs?.columnStates?.[scheduleId];
        if (saved) {
          if (saved.visibleKeys?.length) {
            const keys = new Set(saved.visibleKeys as ColumnKey[]);
            keys.add('rowNum');
            setVisibleKeys(keys);
            localStorage.setItem(`tableview-cols:${scheduleId}`, JSON.stringify(saved.visibleKeys));
          }
          if (saved.columnOrder?.length) {
            setColumnOrder(saved.columnOrder);
            localStorage.setItem(`tableview-col-order:${scheduleId}`, JSON.stringify(saved.columnOrder));
          }
          if (saved.colWidths && Object.keys(saved.colWidths).length) {
            setColWidths(saved.colWidths);
            localStorage.setItem(`tableview-col-widths:${scheduleId}`, JSON.stringify(saved.colWidths));
          }
        }
        serverLoaded.current = true;
      })
      .catch(() => { serverLoaded.current = true; });
  }, [scheduleId]);

  // Persist to localStorage + server
  useEffect(() => {
    localStorage.setItem(`tableview-cols:${scheduleId}`, JSON.stringify([...visibleKeys]));
    if (serverLoaded.current) {
      syncToServer(scheduleId, { visibleKeys: [...visibleKeys], columnOrder, colWidths });
    }
  }, [visibleKeys, scheduleId]);

  useEffect(() => {
    if (columnOrder.length > 0) {
      localStorage.setItem(`tableview-col-order:${scheduleId}`, JSON.stringify(columnOrder));
    }
    if (serverLoaded.current) {
      syncToServer(scheduleId, { visibleKeys: [...visibleKeys], columnOrder, colWidths });
    }
  }, [columnOrder, scheduleId]);

  useEffect(() => {
    if (Object.keys(colWidths).length > 0) {
      localStorage.setItem(`tableview-col-widths:${scheduleId}`, JSON.stringify(colWidths));
    }
    if (serverLoaded.current) {
      syncToServer(scheduleId, { visibleKeys: [...visibleKeys], columnOrder, colWidths });
    }
  }, [colWidths, scheduleId]);

  // Cleanup sync timer on unmount — flush pending sync
  useEffect(() => {
    return () => {
      if (syncTimer) {
        clearTimeout(syncTimer);
        syncTimer = null;
      }
    };
  }, []);

  const toggleColumn = useCallback((key: ColumnKey) => {
    if (key === 'name' || key === 'rowNum') return;
    setVisibleKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((group: ColumnGroup, visible: boolean) => {
    setVisibleKeys(prev => {
      const next = new Set(prev);
      for (const col of COLUMN_DEFS) {
        if (col.group === group && col.key !== 'name' && col.key !== 'rowNum') {
          if (visible) next.add(col.key);
          else next.delete(col.key);
        }
      }
      return next;
    });
  }, []);

  // Ensure rowNum is always in the visible set
  useEffect(() => {
    if (!visibleKeys.has('rowNum')) {
      setVisibleKeys(prev => {
        const next = new Set(prev);
        next.add('rowNum');
        return next;
      });
    }
  }, [visibleKeys]);

  const visibleColumns = useMemo(() => {
    // Always include rowNum even if somehow missing from visibleKeys
    const keysWithRowNum = new Set(visibleKeys);
    keysWithRowNum.add('rowNum');
    const visible = COLUMN_DEFS.filter(c => keysWithRowNum.has(c.key));
    if (columnOrder.length === 0) return visible;
    const orderMap = new Map(columnOrder.map((k, i) => [k, i]));
    // rowNum always first (use -1 so it sorts before everything)
    return [...visible].sort((a, b) => {
      const ia = a.key === 'rowNum' ? -1 : (orderMap.get(a.key) ?? 999);
      const ib = b.key === 'rowNum' ? -1 : (orderMap.get(b.key) ?? 999);
      return ia - ib;
    });
  }, [visibleKeys, columnOrder]);

  const moveColumn = useCallback((colKey: ColumnKey, direction: 'left' | 'right') => {
    const currentOrder = visibleColumns.map(c => c.key);
    const idx = currentOrder.indexOf(colKey);
    if (idx === -1) return;
    const targetIdx = direction === 'left' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= currentOrder.length) return;
    const newOrder = [...currentOrder];
    [newOrder[idx], newOrder[targetIdx]] = [newOrder[targetIdx], newOrder[idx]];
    setColumnOrder(newOrder);
  }, [visibleColumns]);

  const cpmNeeded = useMemo(
    () => [...visibleKeys].some(k => SCHEDULING_KEYS.has(k)),
    [visibleKeys],
  );

  return {
    visibleKeys,
    columnOrder,
    colWidths,
    visibleColumns,
    toggleColumn,
    toggleGroup,
    setVisibleKeys,
    setColumnOrder,
    setColWidths,
    moveColumn,
    cpmNeeded,
  };
}
