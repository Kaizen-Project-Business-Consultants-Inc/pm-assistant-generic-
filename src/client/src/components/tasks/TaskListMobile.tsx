import React, { useState } from 'react';
import { TaskCardMobile } from './TaskCardMobile';

interface Task {
  id: string;
  name: string;
  status: string;
  priority?: string;
  assignedTo?: string;
  assigned_to?: string;
  endDate?: string;
  end_date?: string;
}

interface TaskListMobileProps {
  tasks: Task[];
  currentUser?: string;
  onStatusChange?: (taskId: string, newStatus: string) => void;
  onTaskClick?: (taskId: string) => void;
}

const statusFilters = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Done' },
];

export const TaskListMobile: React.FC<TaskListMobileProps> = ({
  tasks,
  currentUser,
  onStatusChange,
  onTaskClick,
}) => {
  const [statusFilter, setStatusFilter] = useState('');
  const [myTasksOnly, setMyTasksOnly] = useState(false);

  const filtered = tasks.filter((t) => {
    if (statusFilter && t.status !== statusFilter) return false;
    if (myTasksOnly && currentUser) {
      const assignee = t.assignedTo || t.assigned_to || '';
      if (assignee !== currentUser) return false;
    }
    return true;
  });

  return (
    <div className="space-y-3">
      {/* Filter chips */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {statusFilters.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              statusFilter === f.value
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
            }`}
          >
            {f.label}
          </button>
        ))}
        {currentUser && (
          <button
            onClick={() => setMyTasksOnly(!myTasksOnly)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              myTasksOnly
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
            }`}
          >
            My Tasks
          </button>
        )}
      </div>

      {/* Task list */}
      {filtered.length === 0 ? (
        <div className="text-center py-8 text-sm text-gray-500">No tasks match the filter</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((task) => (
            <TaskCardMobile
              key={task.id}
              task={{
                id: task.id,
                name: task.name,
                status: task.status,
                priority: task.priority,
                assignedTo: task.assignedTo || task.assigned_to,
                endDate: task.endDate || task.end_date,
              }}
              onStatusCycle={onStatusChange}
              onClick={onTaskClick}
            />
          ))}
        </div>
      )}
    </div>
  );
};
