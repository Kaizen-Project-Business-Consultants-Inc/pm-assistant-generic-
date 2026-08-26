import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, Clock, CalendarCheck, Play, CalendarDays } from 'lucide-react';
import WorkItemRow from './WorkItemRow';

interface CommitmentItem {
  id: string | number;
  type: 'task' | 'action_item' | 'raid_action';
  name: string;
  projectId: string | number;
  projectName: string;
  scheduleId?: number;
  meetingTitle?: string;
  dueDate: string | null;
  priority: string;
  status: string;
  percentComplete?: number;
}

interface BucketDef {
  key: string;
  label: string;
  icon: React.ElementType;
  color: string;
  items: CommitmentItem[];
}

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function bucketItems(items: CommitmentItem[]): BucketDef[] {
  const today = toLocalDateStr(new Date());
  const d = new Date();
  const day = d.getDay();
  const daysUntilSunday = day === 0 ? 0 : 7 - day;
  d.setDate(d.getDate() + daysUntilSunday);
  const endOfWeek = toLocalDateStr(d);

  // Two weeks from now
  const twoWeeks = new Date();
  twoWeeks.setDate(twoWeeks.getDate() + 14);
  const twoWeeksStr = toLocalDateStr(twoWeeks);

  const overdue: CommitmentItem[] = [];
  const dueToday: CommitmentItem[] = [];
  const dueThisWeek: CommitmentItem[] = [];
  const inProgress: CommitmentItem[] = [];
  const upcoming: CommitmentItem[] = [];

  for (const item of items) {
    if (!item.dueDate) {
      if (item.status === 'in-progress' || item.status === 'in_progress') {
        inProgress.push(item);
      } else {
        upcoming.push(item);
      }
      continue;
    }

    if (item.dueDate < today) {
      overdue.push(item);
    } else if (item.dueDate === today) {
      dueToday.push(item);
    } else if (item.dueDate <= endOfWeek) {
      dueThisWeek.push(item);
    } else if (item.status === 'in-progress' || item.status === 'in_progress') {
      inProgress.push(item);
    } else if (item.dueDate <= twoWeeksStr) {
      upcoming.push(item);
    } else {
      upcoming.push(item);
    }
  }

  // Sort overdue by days overdue desc
  overdue.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));

  return [
    { key: 'overdue', label: 'Overdue', icon: AlertTriangle, color: 'text-red-600 dark:text-red-400', items: overdue },
    { key: 'dueToday', label: 'Due Today', icon: Clock, color: 'text-orange-600 dark:text-orange-400', items: dueToday },
    { key: 'dueThisWeek', label: 'Due This Week', icon: CalendarCheck, color: 'text-yellow-600 dark:text-yellow-400', items: dueThisWeek },
    { key: 'inProgress', label: 'In Progress', icon: Play, color: 'text-blue-600 dark:text-blue-400', items: inProgress },
    { key: 'upcoming', label: 'Upcoming', icon: CalendarDays, color: 'text-gray-600 dark:text-gray-400', items: upcoming },
  ].filter(b => b.items.length > 0);
}

function CommitmentBucket({
  bucket,
  onMarkDone,
  markingId,
}: {
  bucket: BucketDef;
  onMarkDone: (item: CommitmentItem) => void;
  markingId: string | number | null;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const Icon = bucket.icon;
  const Chevron = collapsed ? ChevronRight : ChevronDown;

  return (
    <div className="mb-3">
      <button
        className="flex items-center gap-2 w-full px-2 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
      >
        <Chevron className="w-4 h-4 text-gray-400" />
        <Icon className={`w-4 h-4 ${bucket.color}`} />
        <span className={`text-sm font-semibold ${bucket.color}`}>{bucket.label}</span>
        <span className="ml-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full px-2 py-0.5">
          {bucket.items.length}
        </span>
      </button>
      {!collapsed && (
        <div className="ml-2 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
          {bucket.items.map(item => (
            <WorkItemRow
              key={`${item.type}-${item.id}`}
              item={item}
              onMarkDone={onMarkDone}
              isMarking={markingId === item.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function CommitmentsSection({
  items,
  counts,
  onMarkDone,
  markingId,
}: {
  items: CommitmentItem[];
  counts: { tasks: number; actionItems: number; raidActions: number };
  onMarkDone: (item: CommitmentItem) => void;
  markingId: string | number | null;
}) {
  const [activeTab, setActiveTab] = useState<'all' | 'task' | 'action_item' | 'raid_action'>('all');
  const [projectFilter, setProjectFilter] = useState<string>('');

  const projects = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      map.set(String(item.projectId), item.projectName);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);

  const filtered = useMemo(() => {
    let result = items;
    if (activeTab !== 'all') {
      result = result.filter(i => i.type === activeTab);
    }
    if (projectFilter) {
      result = result.filter(i => String(i.projectId) === projectFilter);
    }
    return result;
  }, [items, activeTab, projectFilter]);

  const buckets = useMemo(() => bucketItems(filtered), [filtered]);

  const tabs = [
    { key: 'all' as const, label: 'All', count: items.length },
    { key: 'task' as const, label: 'Tasks', count: counts.tasks },
    { key: 'action_item' as const, label: 'Action Items', count: counts.actionItems },
    { key: 'raid_action' as const, label: 'RAID Actions', count: counts.raidActions },
  ];

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">My Commitments</h2>

        {/* Project filter */}
        {projects.length > 1 && (
          <select
            value={projectFilter}
            onChange={e => setProjectFilter(e.target.value)}
            className="text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
          >
            <option value="">All Projects</option>
            {projects.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-700">
        {tabs.filter(t => t.count > 0 || t.key === 'all').map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-primary-600 text-primary-600 dark:text-primary-400 dark:border-primary-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className="ml-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full px-1.5">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Buckets */}
      {buckets.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
          No items to show{activeTab !== 'all' ? ' for this filter' : ''}.
        </p>
      ) : (
        buckets.map(bucket => (
          <CommitmentBucket
            key={bucket.key}
            bucket={bucket}
            onMarkDone={onMarkDone}
            markingId={markingId}
          />
        ))
      )}
    </div>
  );
}
