import { Link } from 'react-router-dom';
import { CheckCircle2, ArrowRight, ListTodo, Target, ClipboardCheck } from 'lucide-react';
import { routeTo } from '../../routes';

const priorityColors: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-400',
};

const statusLabels: Record<string, string> = {
  'not-started': 'Not Started',
  'in-progress': 'In Progress',
  'in_progress': 'In Progress',
  'completed': 'Complete',
  'done': 'Complete',
  'on-hold': 'On Hold',
  'blocked': 'Blocked',
  'cancelled': 'Cancelled',
  'open': 'Open',
  'monitoring': 'Monitoring',
  'mitigating': 'Mitigating',
};

const statusColors: Record<string, string> = {
  'not-started': 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  'in-progress': 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  'in_progress': 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  'completed': 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  'done': 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  'on-hold': 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  'blocked': 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  'cancelled': 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
  'open': 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  'monitoring': 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  'mitigating': 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
};

const typeIcons: Record<string, React.ElementType> = {
  task: ListTodo,
  action_item: ClipboardCheck,
  raid_action: Target,
};

interface WorkItem {
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

function relativeDate(dateStr: string | null): string {
  if (!dateStr) return '--';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  const diff = Math.floor((d.getTime() - today.getTime()) / 86400000);
  if (diff < -1) return `${Math.abs(diff)}d overdue`;
  if (diff === -1) return 'Yesterday';
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff <= 7) return `${diff}d`;
  return dateStr;
}

export default function WorkItemRow({
  item,
  onMarkDone,
  isMarking,
}: {
  item: WorkItem;
  onMarkDone?: (item: WorkItem) => void;
  isMarking?: boolean;
}) {
  const Icon = typeIcons[item.type] || ListTodo;
  const navUrl = item.type === 'task' && item.scheduleId
    ? routeTo.project(String(item.projectId), 'schedule') + `&taskId=${item.id}`
    : routeTo.project(String(item.projectId));

  return (
    <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3 px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 last:border-b-0 group">
      {/* Type icon */}
      <Icon className="w-4 h-4 text-gray-400 flex-shrink-0" title={item.type.replace('_', ' ')} />

      {/* Priority dot */}
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${priorityColors[item.priority] || priorityColors.medium}`}
        title={item.priority}
      />

      {/* Name */}
      <Link
        to={navUrl}
        className="flex-1 min-w-0 truncate text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-primary-600 dark:hover:text-primary-400"
      >
        {item.name}
      </Link>

      {/* Status badge */}
      <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${statusColors[item.status] || statusColors['not-started']}`}>
        {statusLabels[item.status] || item.status}
      </span>

      {/* Second row on mobile */}
      <div className="w-full sm:w-auto sm:contents flex items-center gap-2 pl-6 sm:pl-0">
        <Link
          to={routeTo.project(String(item.projectId))}
          className="text-xs text-primary-600 dark:text-primary-400 hover:underline truncate max-w-[140px] flex-shrink-0"
        >
          {item.projectName}
        </Link>
        <span className="text-xs text-gray-500 dark:text-gray-400 w-20 text-right flex-shrink-0 hidden sm:inline">
          {relativeDate(item.dueDate)}
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        {onMarkDone && (
          <button
            onClick={() => onMarkDone(item)}
            disabled={isMarking}
            className="p-1 rounded hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600 dark:text-green-400 disabled:opacity-50"
            title="Mark done"
          >
            <CheckCircle2 className="w-4 h-4" />
          </button>
        )}
        <Link to={navUrl} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
