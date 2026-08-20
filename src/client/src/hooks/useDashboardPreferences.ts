import { useState, useEffect, useCallback, useRef } from 'react';
import { apiService } from '../services/api';
import type { WidgetDef } from '../components/dashboard/WidgetRegistry';
import { getDefaultWidgetIds } from '../components/dashboard/WidgetRegistry';

type WidgetSize = 'full' | 'half' | 'third';

interface DashboardPrefs {
  enabledWidgets: string[];
  widgetOrder: string[];
  widgetSizes?: Record<string, WidgetSize>;
}

const STORAGE_KEY = 'dashboard-pm-prefs';

function loadLocal(): DashboardPrefs | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored) as DashboardPrefs;
  } catch { /* ignore */ }
  return null;
}

/** Merge newly added widgets into existing prefs so they appear for returning users. */
function mergeNewWidgets(prefs: DashboardPrefs, widgets: WidgetDef[]): DashboardPrefs {
  const knownIds = new Set(prefs.widgetOrder);
  const newWidgets = widgets.filter(w => !knownIds.has(w.id));
  if (newWidgets.length === 0) return prefs;

  // Also remove widget IDs that no longer exist in the registry
  const registryIds = new Set(widgets.map(w => w.id));
  const cleanedOrder = prefs.widgetOrder.filter(id => registryIds.has(id));
  const cleanedEnabled = prefs.enabledWidgets.filter(id => registryIds.has(id));

  return {
    ...prefs,
    widgetOrder: [...cleanedOrder, ...newWidgets.map(w => w.id)],
    enabledWidgets: [...cleanedEnabled, ...newWidgets.filter(w => w.defaultOn).map(w => w.id)],
  };
}

function saveLocal(prefs: DashboardPrefs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

export function useDashboardPreferences(widgets: WidgetDef[]) {
  const defaultIds = getDefaultWidgetIds(widgets);
  const defaultOrder = widgets.map(w => w.id);

  const [enabledIds, setEnabledIds] = useState<Set<string>>(() => {
    const raw = loadLocal();
    const local = raw ? mergeNewWidgets(raw, widgets) : null;
    return local ? new Set(local.enabledWidgets) : new Set(defaultIds);
  });

  const [widgetOrder, setWidgetOrder] = useState<string[]>(() => {
    const raw = loadLocal();
    const local = raw ? mergeNewWidgets(raw, widgets) : null;
    return local?.widgetOrder ?? defaultOrder;
  });

  const [widgetSizes, setWidgetSizes] = useState<Record<string, WidgetSize>>(() => {
    const raw = loadLocal();
    return raw?.widgetSizes ?? {};
  });

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced save to server
  const scheduleSave = useCallback((prefs: DashboardPrefs) => {
    saveLocal(prefs);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      apiService.updateDashboardPreferences(prefs).catch(() => {/* silent */});
    }, 500);
  }, []);

  // On mount: fetch from server in background and overwrite if exists
  useEffect(() => {
    apiService.getDashboardPreferences()
      .then((res: any) => {
        const raw = res?.preferences;
        if (raw?.enabledWidgets && raw?.widgetOrder) {
          const prefs = mergeNewWidgets(raw, widgets);
          setEnabledIds(new Set(prefs.enabledWidgets));
          setWidgetOrder(prefs.widgetOrder);
          if (prefs.widgetSizes) setWidgetSizes(prefs.widgetSizes);
          saveLocal(prefs);
        }
      })
      .catch(() => {/* no server prefs yet, use local */});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleWidget = useCallback((id: string) => {
    setEnabledIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      const prefs: DashboardPrefs = { enabledWidgets: [...next], widgetOrder, widgetSizes };
      scheduleSave(prefs);
      return next;
    });
  }, [widgetOrder, widgetSizes, scheduleSave]);

  const reorder = useCallback((newOrder: string[]) => {
    setWidgetOrder(newOrder);
    const prefs: DashboardPrefs = { enabledWidgets: [...enabledIds], widgetOrder: newOrder, widgetSizes };
    scheduleSave(prefs);
  }, [enabledIds, widgetSizes, scheduleSave]);

  const resizeWidget = useCallback((id: string, size: WidgetSize) => {
    setWidgetSizes(prev => {
      const next = { ...prev, [id]: size };
      const prefs: DashboardPrefs = { enabledWidgets: [...enabledIds], widgetOrder, widgetSizes: next };
      scheduleSave(prefs);
      return next;
    });
  }, [enabledIds, widgetOrder, scheduleSave]);

  const resetLayout = useCallback(() => {
    const defaults: DashboardPrefs = {
      enabledWidgets: defaultIds,
      widgetOrder: defaultOrder,
      widgetSizes: {},
    };
    setEnabledIds(new Set(defaultIds));
    setWidgetOrder(defaultOrder);
    setWidgetSizes({});
    scheduleSave(defaults);
  }, [defaultIds, defaultOrder, scheduleSave]);

  return {
    enabledIds,
    widgetOrder,
    widgetSizes,
    toggleWidget,
    reorder,
    resizeWidget,
    resetLayout,
  };
}
