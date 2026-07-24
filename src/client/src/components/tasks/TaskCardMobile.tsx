import React, { useRef, useState, useCallback } from 'react';
import { Calendar, User, Check } from 'lucide-react';

interface TaskCardMobileProps {
  task: {
    id: string;
    name: string;
    status: string;
    priority?: string;
    assignedTo?: string;
    endDate?: string;
  };
  onStatusCycle?: (taskId: string, newStatus: string) => void;
  onClick?: (taskId: string) => void;
}

const statusCycle: Record<string, string> = {
  pending: 'in_progress',
  in_progress: 'completed',
  completed: 'pending',
};

const statusStyles: Record<string, string> = {
  pending: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
  in_progress: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
  completed: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  cancelled: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
  blocked: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
};

const statusLabels: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  blocked: 'Blocked',
};

const priorityStyles: Record<string, string> = {
  critical: 'bg-red-500 text-white',
  high: 'bg-orange-500 text-white',
  medium: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400',
  low: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
};

export const TaskCardMobile: React.FC<TaskCardMobileProps> = ({ task, onStatusCycle, onClick }) => {
  const [swipeX, setSwipeX] = useState(0);
  const [swiped, setSwiped] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (task.status === 'completed' || task.status === 'cancelled') return;
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      time: Date.now(),
    };
    setSwipeX(0);
  }, [task.status]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const dx = e.touches[0].clientX - touchStartRef.current.x;
    const dy = e.touches[0].clientY - touchStartRef.current.y;
    // Only track horizontal swipes
    if (Math.abs(dy) > Math.abs(dx)) { touchStartRef.current = null; setSwipeX(0); return; }
    if (dx > 0) setSwipeX(Math.min(dx, 120));
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!touchStartRef.current) { setSwipeX(0); return; }
    if (swipeX > 80 && onStatusCycle) {
      setSwiped(true);
      onStatusCycle(task.id, 'completed');
      setTimeout(() => { setSwiped(false); setSwipeX(0); }, 600);
    } else {
      setSwipeX(0);
    }
    touchStartRef.current = null;
  }, [swipeX, task.id, onStatusCycle]);

  const handleStatusTap = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onStatusCycle && task.status !== 'cancelled') {
      const nextStatus = statusCycle[task.status] || 'pending';
      onStatusCycle(task.id, nextStatus);
    }
  };

  const canSwipe = task.status !== 'completed' && task.status !== 'cancelled';
  const swipeProgress = Math.min(swipeX / 80, 1);

  return (
    <div className="relative overflow-hidden rounded-xl">
      {/* Swipe background */}
      {canSwipe && swipeX > 0 && (
        <div
          className="absolute inset-0 flex items-center pl-4 rounded-xl transition-colors"
          style={{ backgroundColor: swipeProgress >= 1 ? '#22c55e' : '#86efac' }}
        >
          <Check className={`w-5 h-5 transition-transform ${swipeProgress >= 1 ? 'text-white scale-110' : 'text-green-700'}`} />
          <span className={`ml-2 text-xs font-semibold ${swipeProgress >= 1 ? 'text-white' : 'text-green-800'}`}>
            {swipeProgress >= 1 ? 'Release to complete' : 'Swipe to complete'}
          </span>
        </div>
      )}
    <div
      onClick={() => onClick?.(task.id)}
      onTouchStart={canSwipe ? handleTouchStart : undefined}
      onTouchMove={canSwipe ? handleTouchMove : undefined}
      onTouchEnd={canSwipe ? handleTouchEnd : undefined}
      className={`bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 min-h-[56px] active:bg-gray-50 dark:active:bg-gray-700 cursor-pointer relative ${swiped ? 'transition-transform duration-300' : 'transition-transform duration-150'}`}
      style={{ transform: swiped ? 'translateX(120px)' : `translateX(${swipeX}px)` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{task.name}</p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {task.assignedTo && (
              <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                <User className="w-3 h-3" />
                {task.assignedTo}
              </span>
            )}
            {task.endDate && (
              <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                <Calendar className="w-3 h-3" />
                {task.endDate.substring(0, 10)}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          {task.priority && (
            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${priorityStyles[task.priority] || 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
              {task.priority}
            </span>
          )}
          <button
            onClick={handleStatusTap}
            className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusStyles[task.status] || 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
          >
            {statusLabels[task.status] || task.status}
          </button>
        </div>
      </div>
    </div>
    </div>
  );
};
