import React from 'react';
import { LayoutDashboard, FolderKanban, FileBarChart } from 'lucide-react';
import type { AIPanelContext } from '../../stores/uiStore';

interface AIChatContextProps {
  context: AIPanelContext;
}

const contextConfig: Record<AIPanelContext['type'], { icon: React.ElementType; label: string; color: string }> = {
  dashboard: { icon: LayoutDashboard, label: 'Dashboard', color: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30' },
  project: { icon: FolderKanban, label: 'Project', color: 'text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30' },
  schedule: { icon: FolderKanban, label: 'Schedule', color: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30' },
  reports: { icon: FileBarChart, label: 'Reports', color: 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30' },
  general: { icon: LayoutDashboard, label: 'General', color: 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700' },
};

export function AIChatContext({ context }: AIChatContextProps) {
  const config = contextConfig[context.type] || contextConfig.general;
  const Icon = config.icon;

  return (
    <div className="flex items-center gap-2 px-2 py-1">
      <span className="text-xs text-gray-500 dark:text-gray-500">Context:</span>
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.color}`}>
        <Icon className="h-3 w-3" />
        {config.label}
        {context.projectName && (
          <span className="max-w-[140px] truncate">
            &middot; {context.projectName}
          </span>
        )}
      </span>
    </div>
  );
}
