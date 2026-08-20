export interface WidgetDef {
  id: string;
  label: string;
  group: string;
  defaultOn: boolean;
  size: 'full' | 'half' | 'third';
}

// Unified dashboard widgets — fixed layout order, togglable visibility
export const UNIFIED_WIDGETS: WidgetDef[] = [
  { id: 'briefing', label: 'Morning Briefing', group: 'Overview', defaultOn: true, size: 'full' },
  { id: 'kpi', label: 'KPI Tiles', group: 'Overview', defaultOn: true, size: 'full' },
  { id: 'intel', label: 'Portfolio Intelligence', group: 'Overview', defaultOn: true, size: 'full' },
  { id: 'projects', label: 'Projects Table', group: 'Overview', defaultOn: true, size: 'full' },
  { id: 'trend', label: 'Issues Trend', group: 'Charts', defaultOn: true, size: 'full' },
  { id: 'milestones', label: 'Milestones', group: 'Details', defaultOn: true, size: 'third' },
  { id: 'budget', label: 'Budget Watch', group: 'Details', defaultOn: true, size: 'third' },
  { id: 'activity', label: 'Recent Activity', group: 'Details', defaultOn: true, size: 'third' },
  { id: 'next-actions', label: 'Next Best Actions', group: 'Overview', defaultOn: true, size: 'full' },
  { id: 'sprints', label: 'Sprint Snapshot', group: 'Agile', defaultOn: false, size: 'full' },
  { id: 'goals', label: 'Goals', group: 'Overview', defaultOn: false, size: 'full' },
  { id: 'workload', label: 'Team Workload', group: 'Details', defaultOn: false, size: 'full' },
  { id: 'standup', label: 'Standup Summary', group: 'Overview', defaultOn: false, size: 'full' },
];

export function getDefaultWidgetIds(widgets: WidgetDef[]): string[] {
  return widgets.filter(w => w.defaultOn).map(w => w.id);
}

export function loadWidgetIds(storageKey: string, widgets: WidgetDef[]): Set<string> {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const arr = JSON.parse(stored) as string[];
      return new Set(arr);
    }
  } catch { /* ignore */ }
  return new Set(getDefaultWidgetIds(widgets));
}

export function saveWidgetIds(storageKey: string, ids: Set<string>) {
  localStorage.setItem(storageKey, JSON.stringify([...ids]));
}

export function loadWidgetOrder(storageKey: string, widgets: WidgetDef[]): string[] {
  try {
    const stored = localStorage.getItem(storageKey + ':order');
    if (stored) return JSON.parse(stored) as string[];
  } catch { /* ignore */ }
  return widgets.map(w => w.id);
}

export function saveWidgetOrder(storageKey: string, order: string[]) {
  localStorage.setItem(storageKey + ':order', JSON.stringify(order));
}
