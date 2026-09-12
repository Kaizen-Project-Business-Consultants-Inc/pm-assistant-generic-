import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, CheckSquare, AlertTriangle, ClipboardList } from 'lucide-react';
import { apiService } from '../../../services/api';

interface AssignmentItem {
  id: string;
  name: string;
  status: string;
  priority: string;
  dueDate: string | null;
  projectId: string;
  projectName: string;
  itemType?: string;
  meetingId?: string;
}

interface MyAssignmentsData {
  tasks: AssignmentItem[];
  raidItems: AssignmentItem[];
  actionItems: AssignmentItem[];
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  in_review: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  testing: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  blocked: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  open: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  active: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};

const PRIORITY_DOTS: Record<string, string> = {
  critical: 'bg-red-500',
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-gray-400',
};

function formatDueDate(dateStr: string | null): { text: string; overdue: boolean } {
  if (!dateStr) return { text: '', overdue: false };
  const d = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = Math.floor((d.getTime() - now.getTime()) / 86400000);
  if (diff < 0) return { text: `${Math.abs(diff)}d overdue`, overdue: true };
  if (diff === 0) return { text: 'Today', overdue: false };
  if (diff === 1) return { text: 'Tomorrow', overdue: false };
  return { text: `${diff}d`, overdue: false };
}

function Section({ title, icon: Icon, items, linkFn, count }: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: AssignmentItem[];
  linkFn: (item: AssignmentItem) => string;
  count: number;
}) {
  const [open, setOpen] = useState(true);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left text-sm font-semibold text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 py-1"
      >
        <Chevron className="w-4 h-4 shrink-0" />
        <Icon className="w-4 h-4 shrink-0" />
        {title} ({count})
      </button>
      {open && (
        <ul className="ml-6 space-y-1 mt-1">
          {items.length === 0 && (
            <li className="text-xs text-gray-400 dark:text-gray-500 py-1">No items</li>
          )}
          {items.map(item => {
            const due = formatDueDate(item.dueDate);
            return (
              <li key={item.id} className="flex items-center gap-2 text-sm py-0.5">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_DOTS[item.priority] || 'bg-gray-400'}`} />
                <Link
                  to={linkFn(item)}
                  className="min-w-0 truncate text-gray-900 dark:text-gray-100 hover:text-primary-600 dark:hover:text-primary-400"
                >
                  {item.name}
                </Link>
                <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLORS[item.status] || 'bg-gray-100 text-gray-600'}`}>
                  {item.status.replace(/_/g, ' ')}
                </span>
                {due.text && (
                  <span className={`shrink-0 text-xs ${due.overdue ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                    {due.text}
                  </span>
                )}
                <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500 truncate max-w-[100px]">
                  {item.projectName}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function MyAssignmentsWidget() {
  const { data, isLoading } = useQuery<MyAssignmentsData>({
    queryKey: ['dashboard-my-assignments'],
    queryFn: () => apiService.getMyAssignments(),
    staleTime: 60_000,
  });

  if (isLoading) {
    return <div className="h-40 rounded-lg bg-gray-100 dark:bg-gray-700 animate-pulse" />;
  }

  if (!data) return null;

  const total = data.tasks.length + data.raidItems.length + data.actionItems.length;
  if (total === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">
        No items assigned to you.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <Section
        title="Tasks"
        icon={CheckSquare}
        items={data.tasks}
        count={data.tasks.length}
        linkFn={item => `/project/${item.projectId}/schedule`}
      />
      <Section
        title="RAID Items"
        icon={AlertTriangle}
        items={data.raidItems}
        count={data.raidItems.length}
        linkFn={item => `/project/${item.projectId}/risks`}
      />
      <Section
        title="Action Items"
        icon={ClipboardList}
        items={data.actionItems}
        count={data.actionItems.length}
        linkFn={item => `/project/${item.projectId}/meetings`}
      />
    </div>
  );
}
