import { useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, ListTodo, ClipboardCheck, Target } from 'lucide-react';

interface CompletedItem {
  id: string | number;
  type: 'task' | 'action_item' | 'raid_action';
  name: string;
  projectName: string;
  completedDate: string;
}

const typeIcons: Record<string, React.ElementType> = {
  task: ListTodo,
  action_item: ClipboardCheck,
  raid_action: Target,
};

export default function RecentlyCompletedSection({ items }: { items: CompletedItem[] }) {
  const [collapsed, setCollapsed] = useState(true); // starts collapsed

  if (items.length === 0) return null;

  const Chevron = collapsed ? ChevronRight : ChevronDown;

  return (
    <div className="mb-6">
      <button
        className="flex items-center gap-2 w-full px-1 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
      >
        <Chevron className="w-4 h-4 text-gray-400" />
        <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
        <span className="text-sm font-semibold text-green-600 dark:text-green-400">Recently Completed</span>
        <span className="ml-1 text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded-full px-2 py-0.5">
          {items.length}
        </span>
      </button>

      {!collapsed && (
        <div className="ml-2 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
          {items.map(item => {
            const Icon = typeIcons[item.type] || ListTodo;
            return (
              <div
                key={`${item.type}-${item.id}`}
                className="flex items-center gap-3 px-4 py-2 border-b border-gray-100 dark:border-gray-800 last:border-b-0"
              >
                <Icon className="w-4 h-4 text-green-500 flex-shrink-0" />
                <span className="flex-1 min-w-0 text-sm text-gray-600 dark:text-gray-400 truncate line-through decoration-gray-300 dark:decoration-gray-600">
                  {item.name}
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">{item.projectName}</span>
                <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 w-20 text-right">
                  {item.completedDate || '--'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
