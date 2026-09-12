import { useNavigate } from 'react-router-dom';
import {
  Plus,
  ShieldAlert,
  AlertCircle,
  Upload,
  FileText,
  Bot,
} from 'lucide-react';
import { useUIStore } from '../../../stores/uiStore';

const actions = [
  { label: 'Add Task', icon: Plus, path: '/projects' },
  { label: 'Log Risk', icon: ShieldAlert, path: '/change-requests' },
  { label: 'Log Issue', icon: AlertCircle, path: '/change-requests' },
  { label: 'Upload Doc', icon: Upload, path: '/projects' },
  { label: 'Generate Report', icon: FileText, path: '/reports' },
  { label: 'Ask AI', icon: Bot, path: null },
] as const;

export function QuickActionsWidget() {
  const navigate = useNavigate();

  const handleClick = (action: (typeof actions)[number]) => {
    if (action.path) {
      navigate(action.path);
    } else {
      useUIStore.getState().setAIPanelOpen(true);
    }
  };

  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
        Quick Actions
      </h3>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {actions.map((action) => (
          <button
            key={action.label}
            onClick={() => handleClick(action)}
            className="flex flex-col items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3 hover:border-primary-400 dark:hover:border-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
          >
            <action.icon className="h-5 w-5 text-gray-600 dark:text-gray-400" />
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300 text-center leading-tight">
              {action.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
