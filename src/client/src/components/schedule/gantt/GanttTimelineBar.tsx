import React from 'react';
import {
  type GanttTask,
  HEADER_H,
  ROW_H,
  toDate,
  daysBetween,
  formatShortDate,
  avatarColor,
  avatarInitials,
  healthColor,
} from './types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GanttTimelineBarProps {
  task: GanttTask;
  idx: number;
  // Pre-computed positioning
  left: number;
  width: number;
  top: number;
  barH: number;
  pct: number;
  // Boolean flags
  isCritical: boolean;
  isSelected: boolean;
  isOverallocated: boolean;
  isParent: boolean;
  isDragging: boolean;
  canDrag: boolean;
  isDepDrawSource: boolean;
  // Data
  floatDays: number;
  dayPx: number;
  colors: { bg: string; fill: string; text: string };
  // For tooltip
  tasks: GanttTask[];
  rowNumMap: Map<string, number>;
  getDepHealth: (depTaskId: string) => 'satisfied' | 'in_progress' | 'at_risk';
  // Callbacks
  onBarMouseDown?: (e: React.MouseEvent, task: GanttTask) => void;
  onBarTouchStart?: (e: React.TouchEvent, task: GanttTask) => void;
  onBarClick: (e: React.MouseEvent, task: GanttTask) => void;
  onProgressMouseDown?: (e: React.MouseEvent, task: GanttTask, barWidth: number, barLeft: number) => void;
  onDepDrawMouseDown?: (e: React.MouseEvent, task: GanttTask, edge: 'start' | 'finish') => void;
  hasOnTaskUpdate: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const GanttTimelineBar = React.memo(function GanttTimelineBar({
  task,
  idx,
  left,
  width,
  top,
  barH,
  pct,
  isCritical,
  isSelected,
  isOverallocated,
  isParent,
  isDragging,
  canDrag,
  isDepDrawSource,
  floatDays,
  dayPx,
  colors,
  tasks,
  rowNumMap,
  getDepHealth,
  onBarMouseDown,
  onBarTouchStart,
  onBarClick,
  onProgressMouseDown,
  onDepDrawMouseDown,
  hasOnTaskUpdate,
}: GanttTimelineBarProps) {
  const start = toDate(task.startDate);
  const end = toDate(task.endDate);
  if (!start || !end) return null;

  const handleClick = (e: React.MouseEvent) => onBarClick(e, task);

  // Milestone: render as a diamond instead of a bar
  if (task.isMilestone) {
    const diamondSize = 14;
    const cx = left;
    const cy = HEADER_H + idx * ROW_H + ROW_H / 2;
    return (
      <div
        className="absolute group/bar"
        style={{ left: cx - diamondSize / 2, top: cy - diamondSize / 2, width: diamondSize, height: diamondSize }}
        onClick={handleClick}
      >
        <div
          className="w-full h-full rotate-45"
          style={{
            backgroundColor: colors.fill,
            border: isSelected ? '2px solid #3b82f6' : isCritical ? '2px solid #dc2626' : `1px solid ${colors.fill}`,
            boxShadow: isSelected ? '0 0 0 2px rgba(59,130,246,0.3)' : undefined,
          }}
        />
        {/* Milestone tooltip */}
        <div className="invisible group-hover/bar:visible absolute z-30 left-1/2 -translate-x-1/2 -top-14 bg-gray-900 dark:bg-gray-700 text-white rounded-lg px-3 py-2 text-xs whitespace-nowrap shadow-lg pointer-events-none">
          <div className="font-semibold">
            {isCritical && <span className="text-red-400">[Critical] </span>}
            Milestone: {task.name}
          </div>
          <div className="text-gray-300 mt-0.5">{formatShortDate(start, new Date().getFullYear())}</div>
        </div>
      </div>
    );
  }

  // Summary task: thin black bar with downward triangles at ends (MS Project style)
  if (task.isSummary || isParent) {
    const summaryH = 6;
    const summaryTop = HEADER_H + idx * ROW_H + ROW_H / 2 - summaryH / 2;
    const triSize = 5;
    return (
      <div
        className="absolute group/bar"
        style={{ left, top: summaryTop, width, height: summaryH + triSize, cursor: 'pointer' }}
        onClick={handleClick}
      >
        {/* Thin bar */}
        <div
          className="absolute inset-x-0 top-0 rounded-sm"
          style={{
            height: summaryH,
            backgroundColor: isSelected ? '#3b82f6' : '#374151',
            boxShadow: isSelected ? '0 0 0 2px rgba(59,130,246,0.3)' : undefined,
          }}
        />
        {/* Progress fill on thin bar */}
        {(task.progressPercentage ?? 0) > 0 && (
          <div
            className="absolute top-0.5 left-0.5 rounded-sm"
            style={{
              height: summaryH - 2,
              width: `${Math.min(task.progressPercentage ?? 0, 100)}%`,
              backgroundColor: isSelected ? '#60a5fa' : '#111827',
            }}
          />
        )}
        {/* Left triangle */}
        <div
          className="absolute"
          style={{
            left: 0, top: summaryH,
            width: 0, height: 0,
            borderLeft: `${triSize}px solid transparent`,
            borderRight: `${triSize}px solid transparent`,
            borderTop: `${triSize}px solid ${isSelected ? '#3b82f6' : '#374151'}`,
          }}
        />
        {/* Right triangle */}
        <div
          className="absolute"
          style={{
            right: 0, top: summaryH,
            width: 0, height: 0,
            borderLeft: `${triSize}px solid transparent`,
            borderRight: `${triSize}px solid transparent`,
            borderTop: `${triSize}px solid ${isSelected ? '#3b82f6' : '#374151'}`,
          }}
        />
        {/* Tooltip */}
        <div className="invisible group-hover/bar:visible absolute z-30 left-1/2 -translate-x-1/2 -top-16 bg-gray-900 dark:bg-gray-700 text-white rounded-lg px-3 py-2 text-xs whitespace-nowrap shadow-lg pointer-events-none">
          <div className="font-semibold">{task.name}</div>
          <div className="text-gray-300 mt-0.5">{formatShortDate(start, new Date().getFullYear())} – {formatShortDate(end, new Date().getFullYear())} | {task.progressPercentage ?? 0}%</div>
        </div>
      </div>
    );
  }

  // Normal task bar
  return (
    <div
      className={`absolute group/bar ${isDragging ? 'opacity-80 z-20' : ''}`}
      style={{
        left, top, width, height: barH,
        cursor: canDrag ? (isDragging ? 'grabbing' : 'grab') : undefined,
        userSelect: isDragging ? 'none' : undefined,
      }}
      onMouseDown={canDrag && onBarMouseDown ? (e) => onBarMouseDown(e, task) : undefined}
      onTouchStart={canDrag && onBarTouchStart ? (e) => onBarTouchStart(e, task) : undefined}
      onClick={handleClick}
    >
      {/* Background bar */}
      <div
        className="absolute inset-0 rounded-sm"
        style={{
          backgroundColor: colors.bg,
          border: isSelected ? '2px solid #3b82f6' : isCritical ? '2px solid #dc2626' : isOverallocated ? '2px solid #f59e0b' : `1px solid ${colors.fill}40`,
          boxShadow: isSelected ? '0 0 0 2px rgba(59,130,246,0.3)' : isOverallocated ? '0 0 0 2px rgba(245,158,11,0.3)' : undefined,
        }}
      />

      {/* Progress fill */}
      {pct > 0 && (
        <div
          className="absolute top-0 left-0 bottom-0 rounded-sm"
          style={{
            width: `${Math.min(pct, 100)}%`,
            backgroundColor: colors.fill,
            opacity: isParent ? 0.7 : 0.5,
          }}
        />
      )}

      {/* Progress drag handle */}
      {hasOnTaskUpdate && !isParent && !task.isMilestone && onProgressMouseDown && (
        <div
          className="absolute top-0 bottom-0 w-2 cursor-col-resize z-10 opacity-0 group-hover/bar:opacity-100 transition-opacity"
          style={{ left: `calc(${Math.min(pct, 100)}% - 4px)` }}
          onMouseDown={(e) => {
            const barEl = (e.currentTarget as HTMLElement).parentElement;
            if (barEl) {
              const rect = barEl.getBoundingClientRect();
              onProgressMouseDown(e, task, rect.width, rect.left);
            }
          }}
          title={`Progress: ${pct}% — drag to adjust`}
        >
          <div className="w-1 h-full mx-auto rounded-full" style={{ backgroundColor: colors.fill }} />
        </div>
      )}

      {/* Summary bar style — diamond markers for parent tasks */}
      {isParent && (
        <>
          <div
            className="absolute top-1/2 -translate-y-1/2 -left-[3px] w-[6px] h-[6px] rotate-45"
            style={{ backgroundColor: colors.fill }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 -right-[3px] w-[6px] h-[6px] rotate-45"
            style={{ backgroundColor: colors.fill }}
          />
        </>
      )}

      {/* Bar label (shows on hover or if bar is wide enough) */}
      {width > 60 && (
        <div
          className="absolute inset-0 flex items-center px-1.5 z-10"
          style={task.assignedTo && !isParent && width > 60 ? { paddingRight: 22 } : undefined}
        >
          <span
            className="text-xs font-medium truncate"
            style={{ color: colors.text }}
          >
            {task.name}
          </span>
        </div>
      )}

      {/* Resource avatar */}
      {task.assignedTo && !isParent && width > 40 && (
        <div
          className="absolute top-1/2 -translate-y-1/2 rounded-full flex items-center justify-center pointer-events-none z-10"
          style={{
            right: 2,
            width: 18,
            height: 18,
            backgroundColor: avatarColor(task.assignedTo),
            fontSize: 9,
            fontWeight: 700,
            color: '#fff',
            lineHeight: 1,
          }}
          title={task.assignedTo}
        >
          {avatarInitials(task.assignedTo)}
        </div>
      )}

      {/* Overallocation warning dot */}
      {isOverallocated && (
        <div
          className="absolute -top-1 -left-1 w-3.5 h-3.5 rounded-full bg-amber-500 text-white flex items-center justify-center z-10 pointer-events-none"
          style={{ fontSize: 9, fontWeight: 700, lineHeight: 1 }}
          title="Resource overallocated"
        >
          !
        </div>
      )}

      {/* Recurring task indicator */}
      {task.isRecurrenceTemplate && (
        <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-primary-500 text-white flex items-center justify-center z-10" title="Recurring task">
          <svg className="w-2 h-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" /><path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" />
          </svg>
        </div>
      )}

      {/* Resize handle on right edge */}
      {canDrag && (
        <div
          className="absolute top-0 right-0 w-2 h-full cursor-ew-resize opacity-0 group-hover/bar:opacity-100 transition-opacity z-10"
          style={{ borderRight: `2px solid ${colors.fill}` }}
        />
      )}

      {/* Float/slack extension */}
      {floatDays > 0 && !isCritical && !isParent && (
        <div
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{
            left: width,
            width: floatDays * dayPx,
            background: 'repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(234,179,8,0.25) 3px, rgba(234,179,8,0.25) 6px)',
            borderTop: '1px dashed #eab308',
            borderBottom: '1px dashed #eab308',
            borderRight: '1px dashed #eab308',
            borderRadius: '0 2px 2px 0',
            opacity: 0.7,
          }}
        />
      )}

      {/* Dependency connector dots */}
      {hasOnTaskUpdate && !isParent && !task.isMilestone && onDepDrawMouseDown && (
        <>
          <div
            className={`absolute top-1/2 -translate-y-1/2 -left-[4px] w-[8px] h-[8px] rounded-full border-2 z-20 transition-opacity cursor-crosshair ${isDepDrawSource ? 'opacity-100' : 'opacity-0 group-hover/bar:opacity-100'}`}
            style={{ backgroundColor: '#fff', borderColor: colors.fill }}
            onMouseDown={(e) => onDepDrawMouseDown(e, task, 'start')}
            title="Drag to create dependency (Start)"
          />
          <div
            className={`absolute top-1/2 -translate-y-1/2 -right-[4px] w-[8px] h-[8px] rounded-full border-2 z-20 transition-opacity cursor-crosshair ${isDepDrawSource ? 'opacity-100' : 'opacity-0 group-hover/bar:opacity-100'}`}
            style={{ backgroundColor: '#fff', borderColor: colors.fill }}
            onMouseDown={(e) => onDepDrawMouseDown(e, task, 'finish')}
            title="Drag to create dependency (Finish)"
          />
        </>
      )}

      {/* Tooltip on hover */}
      <div className={`${isDragging ? 'invisible' : 'invisible group-hover/bar:visible'} absolute z-30 left-0 -top-16 bg-gray-900 dark:bg-gray-700 text-white rounded-lg px-3 py-2 text-xs whitespace-nowrap shadow-lg pointer-events-none`}>
        <div className="font-semibold">
          {isCritical && <span className="text-red-400">[Critical] </span>}
          {task.name}
        </div>
        <div className="text-gray-300 mt-0.5">
          {formatShortDate(start, new Date().getFullYear())} — {formatShortDate(end, new Date().getFullYear())} &middot;{' '}
          {daysBetween(start, end)}d &middot; {pct}% complete
          {floatDays > 0 && <span className="text-yellow-400"> &middot; Float: {floatDays}d</span>}
        </div>
        {task.assignedTo && (
          <div className="text-gray-300">
            Assigned: {task.assignedTo}
          </div>
        )}
        {task.dependencies && task.dependencies.length > 0 && (() => {
          return task.dependencies.map((dep, di) => {
            const depTask = tasks.find(t => t.id === dep.dependencyId);
            const depRowNum = rowNumMap.get(dep.dependencyId);
            const depType = (dep.dependencyType || 'FS').toUpperCase();
            const lag = dep.lagDays || 0;
            const health = getDepHealth(dep.dependencyId);
            let label = depRowNum != null ? String(depRowNum) : '?';
            if (depType !== 'FS') label += depType;
            if (lag !== 0) label += (lag > 0 ? `+${lag}d` : `${lag}d`);
            const healthLabel = health === 'satisfied' ? 'Done' : health === 'in_progress' ? 'Active' : 'At Risk';
            return (
              <div key={di} className="text-gray-300">
                Pred: <span className="font-mono">{label}</span> {depTask ? `(${depTask.name})` : ''}{' '}
                <span style={{ color: healthColor(health) }}>[{healthLabel}]</span>
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
});
