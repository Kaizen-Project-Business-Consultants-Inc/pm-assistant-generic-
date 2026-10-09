import type { WorkCalendar } from '../../../utils/workingDays';
import type { TaskRiskLevel } from '../../../utils/taskRiskAssessment';
import {
  type GanttTask,
  type ZoomLevel,
  toDate,
  daysBetween,
  barColors,
  ROW_H,
  HEADER_H,
} from './types';
import { GanttTimelineBar, type GanttTimelineBarProps } from './GanttTimelineBar';
import type { useTaskFiltering } from './hooks/useTaskFiltering';
import type { useGanttLayout } from './hooks/useGanttLayout';
import type { useDependencyDraw } from './hooks/useDependencyDraw';
import type { useBarDrag } from './hooks/useBarDrag';

type Layout = ReturnType<typeof useGanttLayout>;
type Links = ReturnType<typeof useDependencyDraw>;
type Drags = ReturnType<typeof useBarDrag>;

/**
 * Everything the Gantt's right-hand timeline shows or calls. All state lives in GanttChart (and
 * its hooks); this component only draws it. Prop names match GanttChart's own locals, so the JSX
 * below is the JSX that used to sit inline in GanttChart (code-health item 4, phase 4, 2026-10-05).
 */
export interface GanttTimelinePanelProps {
  /** Attached to the scrolling timeline div (layout, drags, link drawing and scroll-to read it) */
  timelineRef: React.RefObject<HTMLDivElement>;
  rows: ReturnType<typeof useTaskFiltering>['rows'];
  taskById: ReadonlyMap<string, GanttTask>;
  zoom: ZoomLevel;
  dayPx: number;
  nonWorkingDates?: Set<string>;
  workCalendar?: WorkCalendar | null;
  // layout
  minDate: Layout['minDate'];
  totalDays: Layout['totalDays'];
  timelineWidth: Layout['timelineWidth'];
  contentHeight: Layout['contentHeight'];
  timescale: Layout['timescale'];
  todayOffset: Layout['todayOffset'];
  rowTop: Layout['rowTop'];
  rowNumMap: Layout['rowNumMap'];
  shouldVirtualize: Layout['shouldVirtualize'];
  visStart: Layout['visStart'];
  visEnd: Layout['visEnd'];
  // bar looks
  baselineMap: Map<string, { startDate: string; endDate: string }>;
  criticalSet: Set<string>;
  selectedIds: Set<string>;
  parentTaskIds: Set<string>;
  overallocatedTaskIds: Set<string>;
  conflictNotes: Map<string, string[]>;
  taskFloatMap?: Record<string, number>;
  taskRiskMap?: Map<string, TaskRiskLevel>;
  // links
  depDraw: Links['depDraw'];
  depDrawHoverIdx: Links['depDrawHoverIdx'];
  arrowPaths: Links['arrowPaths'];
  getDepHealth: Links['getDepHealth'];
  handleDepDrawMouseDown: Links['handleDepDrawMouseDown'];
  // drags
  drag: Drags['drag'];
  progressDrag: Drags['progressDrag'];
  createDrag: Drags['createDrag'];
  getDragOffset: Drags['getDragOffset'];
  handleBarMouseDown: Drags['handleBarMouseDown'];
  handleBarTouchStart: Drags['handleBarTouchStart'];
  handleProgressMouseDown: Drags['handleProgressMouseDown'];
  handleTimelineMouseDown: Drags['handleTimelineMouseDown'];
  handleTimelineTouchStart: Drags['handleTimelineTouchStart'];
  handleBarClickCb: GanttTimelineBarProps['onBarClick'];
  // GanttChart's own callbacks (only whether they exist matters here)
  onTaskDragEnd?: (taskId: string, newStartDate: string, newEndDate: string) => void;
  onTaskUpdate?: (taskId: string, data: Record<string, unknown>) => void;
  onCreateTaskWithDates?: (startDate: string, endDate: string, parentTaskId?: string) => void;
}

/** The Gantt's right panel: timescale header, grid lines, non-working days, row stripes, today
 *  line, baseline ghosts, link/create previews, task bars and dependency arrows.
 *  Deliberately NOT React.memo: it re-renders whenever GanttChart does, exactly as the inline JSX did. */
export function GanttTimelinePanel({
  timelineRef, rows, taskById, zoom, dayPx, nonWorkingDates, workCalendar,
  minDate, totalDays, timelineWidth, contentHeight, timescale, todayOffset, rowTop, rowNumMap,
  shouldVirtualize, visStart, visEnd,
  baselineMap, criticalSet, selectedIds, parentTaskIds, overallocatedTaskIds, conflictNotes, taskFloatMap, taskRiskMap,
  depDraw, depDrawHoverIdx, arrowPaths, getDepHealth, handleDepDrawMouseDown,
  drag, progressDrag, createDrag, getDragOffset, handleBarMouseDown, handleBarTouchStart, handleProgressMouseDown,
  handleTimelineMouseDown, handleTimelineTouchStart, handleBarClickCb,
  onTaskDragEnd, onTaskUpdate, onCreateTaskWithDates,
}: GanttTimelinePanelProps) {
  return (
    <div className="relative flex-1 min-w-0 flex">
    <div
      ref={timelineRef}
      className="flex-1 overflow-x-auto overflow-y-auto"
      style={depDraw ? { cursor: 'crosshair' } : drag ? { cursor: 'grabbing', userSelect: 'none' } : onCreateTaskWithDates && !progressDrag ? { cursor: 'crosshair' } : undefined}
    >
      <div style={{ width: timelineWidth, position: 'relative' }} onMouseDown={handleTimelineMouseDown} onTouchStart={handleTimelineTouchStart}>
        {/* Timeline header — two-tier timescale */}
        <div
          className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600"
          style={{ height: HEADER_H }}
        >
          {/* Upper tier (26px) */}
          {timescale.upper.length > 0 && timescale.upper.map((band, i) => (
            <div
              key={`u-${i}`}
              className="absolute top-0 flex items-center border-l border-gray-300 dark:border-gray-500 overflow-hidden"
              style={{ left: band.left, width: band.width, height: 26 }}
            >
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide px-1.5 truncate">
                {band.label}
              </span>
            </div>
          ))}
          {/* Lower tier (26px) */}
          {timescale.lower.map((band, i) => (
            <div
              key={`l-${i}`}
              className="absolute flex items-center border-l border-gray-200 dark:border-gray-600 overflow-hidden"
              style={{ left: band.left, width: band.width, height: 26, top: timescale.upper.length > 0 ? 26 : 0 }}
            >
              <span className="text-xs text-gray-500 dark:text-gray-400 px-1 truncate">
                {band.label}
              </span>
            </div>
          ))}
        </div>

        {/* Grid lines (vertical from lower-tier boundaries) */}
        <div
          className="absolute top-0 left-0"
          style={{ width: timelineWidth, height: contentHeight }}
        >
          {timescale.lower.map((band, i) => (
            <div
              key={i}
              className="absolute top-0 bottom-0 border-l border-gray-100 dark:border-gray-700"
              style={{ left: band.left }}
            />
          ))}
        </div>

        {/* Non-working day shading (only at day/week zoom where individual days are visible) */}
        {nonWorkingDates && nonWorkingDates.size > 0 && (zoom === 'day' || zoom === 'week') && (() => {
          const shades: React.ReactNode[] = [];
          const h = contentHeight;
          // Iterate through each day in visible range
          const cursor = new Date(minDate);
          for (let d = 0; d < totalDays; d++) {
            const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
            if (nonWorkingDates.has(key)) {
              shades.push(
                <div
                  key={`nwd-${d}`}
                  className="absolute top-0 pointer-events-none bg-gray-200/40 dark:bg-gray-600/25"
                  style={{ left: d * dayPx, width: dayPx, height: h }}
                />
              );
            }
            cursor.setDate(cursor.getDate() + 1);
          }
          return shades;
        })()}

        {/* Row stripes (alternating background for readability) */}
        {rows.map((_, idx) => {
          if (shouldVirtualize && (idx < visStart || idx >= visEnd)) return null;
          return idx % 2 === 1 ? (
            <div
              key={`stripe-${idx}`}
              className="absolute left-0 bg-gray-50/60 dark:bg-gray-800/30 pointer-events-none"
              style={{
                top: rowTop(idx),
                width: timelineWidth,
                height: ROW_H,
              }}
            />
          ) : null;
        })}

        {/* Today line */}
        {todayOffset !== null && (
          <div
            className="absolute top-0 z-20"
            style={{
              left: todayOffset,
              height: contentHeight,
              width: 2,
              background: '#ef4444',
            }}
          >
            <div className="absolute -top-0.5 -left-[11px] bg-red-500 text-white text-[10px] font-bold px-1 py-0.5 rounded-sm">
              TODAY
            </div>
          </div>
        )}

        {/* Baseline ghost bars (only when baseline differs from actual) */}
        {rows.map(({ task }, idx) => {
          if (shouldVirtualize && (idx < visStart || idx >= visEnd)) return null;
          const bl = baselineMap.get(task.id);
          if (!bl) return null;
          if (bl.startDate === (task.startDate?.split('T')[0] || task.startDate) && bl.endDate === (task.endDate?.split('T')[0] || task.endDate)) return null;
          const bStart = toDate(bl.startDate);
          const bEnd = toDate(bl.endDate);
          if (!bStart || !bEnd) return null;

          const left = daysBetween(minDate, bStart) * dayPx;
          const width = Math.max(daysBetween(bStart, bEnd) * dayPx, 8);
          const top = rowTop(idx) + 2;
          const barH = ROW_H - 4;

          return (
            <div
              key={`bl-${task.id}`}
              className="absolute print-baseline-bar"
              style={{ left, top, width, height: barH }}
            >
              <div
                className="absolute inset-0 rounded-sm"
                style={{
                  backgroundColor: '#d1d5db',
                  opacity: 0.35,
                  border: '1px dashed #9ca3af',
                }}
              />
            </div>
          );
        })}

        {/* Dep-draw target row highlight */}
        {depDraw && depDrawHoverIdx >= 0 && depDrawHoverIdx < rows.length && rows[depDrawHoverIdx].task.id !== depDraw.sourceTaskId && !parentTaskIds.has(rows[depDrawHoverIdx].task.id) && (
          <div
            className="absolute left-0 pointer-events-none z-10"
            style={{
              top: HEADER_H + depDrawHoverIdx * ROW_H,
              width: timelineWidth,
              height: ROW_H,
              backgroundColor: 'rgba(59,130,246,0.08)',
              border: '1px dashed rgba(59,130,246,0.3)',
            }}
          />
        )}

        {/* Drag-to-create preview rectangle */}
        {createDrag && (() => {
          const left = Math.min(createDrag.startX, createDrag.currentX);
          const w = Math.abs(createDrag.currentX - createDrag.startX);
          return (
            <div
              className="absolute pointer-events-none z-20"
              style={{
                left,
                top: rowTop(createDrag.rowIdx) + 4,
                width: w,
                height: ROW_H - 8,
                border: '2px dashed #3b82f6',
                backgroundColor: 'rgba(59,130,246,0.12)',
                borderRadius: 4,
              }}
            />
          );
        })()}

        {/* Task bars */}
        {rows.map(({ task }, idx) => {
          if (shouldVirtualize && (idx < visStart || idx >= visEnd)) return null;
          const start = toDate(task.startDate);
          const end = toDate(task.endDate);
          if (!start || !end) return null;

          const baseLeft = daysBetween(minDate, start) * dayPx;
          const baseWidth = Math.max(daysBetween(start, end) * dayPx, 8);
          const { leftDelta, widthDelta } = getDragOffset(task.id);
          const left = baseLeft + leftDelta;
          const width = Math.max(baseWidth + widthDelta, 8);
          const isProgressDragging = progressDrag?.taskId === task.id;
          const pct = isProgressDragging ? progressDrag.currentPct : (task.progressPercentage ?? 0);
          const isCritical = criticalSet.has(task.id);
          const isSelected = selectedIds.has(task.id);
          const isOverallocated = overallocatedTaskIds.has(task.id);
          const floatDays = taskFloatMap?.[task.id] ?? 0;
          const colors = isCritical
            ? { bg: '#fef2f2', fill: '#dc2626', text: '#991b1b' }
            : barColors[task.status] || barColors.pending;
          const isParent = parentTaskIds.has(task.id);
          const top = rowTop(idx) + 6;
          const barH = ROW_H - 12;

          return (
            <GanttTimelineBar
              key={task.id}
              task={task}
              idx={idx}
              left={left}
              width={width}
              top={top}
              barH={barH}
              pct={pct}
              isCritical={isCritical}
              isSelected={isSelected}
              isOverallocated={isOverallocated}
              overallocationNote={conflictNotes.get(task.id)?.join('\n')}
              isParent={isParent}
              isDragging={drag?.taskId === task.id}
              canDrag={!!onTaskDragEnd}
              isDepDrawSource={depDraw?.sourceTaskId === task.id}
              floatDays={floatDays}
              dayPx={dayPx}
              colors={colors}
              taskById={taskById}
              rowNumMap={rowNumMap}
              getDepHealth={getDepHealth}
              onBarMouseDown={onTaskDragEnd ? handleBarMouseDown : undefined}
              onBarTouchStart={onTaskDragEnd ? handleBarTouchStart : undefined}
              onBarClick={handleBarClickCb}
              onProgressMouseDown={onTaskUpdate ? handleProgressMouseDown : undefined}
              onDepDrawMouseDown={onTaskUpdate ? handleDepDrawMouseDown : undefined}
              hasOnTaskUpdate={!!onTaskUpdate}
              riskLevel={taskRiskMap?.get(task.id)}
              workCalendar={workCalendar}
            />
          );
        })}

        {/* Dependency arrows */}
        <svg
          className="absolute top-0 left-0 pointer-events-none"
          style={{
            width: timelineWidth,
            height: contentHeight,
          }}
        >
          <defs>
            <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
              <polygon points="0 0, 6 2, 0 4" fill="#9ca3af" />
            </marker>
            <marker id="arrowhead-green" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
              <polygon points="0 0, 6 2, 0 4" fill="#22c55e" />
            </marker>
            <marker id="arrowhead-yellow" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
              <polygon points="0 0, 6 2, 0 4" fill="#eab308" />
            </marker>
            <marker id="arrowhead-red" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
              <polygon points="0 0, 6 2, 0 4" fill="#ef4444" />
            </marker>
          </defs>
          {arrowPaths.map(({ key, d, color, arrowheadId, tooltip }) => (
            <path
              key={key}
              d={d}
              fill="none"
              stroke={color}
              strokeWidth="1.5"
              markerEnd={`url(#${arrowheadId})`}
              opacity={0.7}
              style={{ pointerEvents: 'auto' }}
            >
              <title>{tooltip}</title>
            </path>
          ))}
          {/* Dep-draw preview line */}
          {depDraw && (
            <>
              <marker id="arrowhead-draw" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
                <polygon points="0 0, 6 2, 0 4" fill="#3b82f6" />
              </marker>
              <line
                x1={depDraw.sourceX}
                y1={depDraw.sourceY}
                x2={depDraw.currentX}
                y2={depDraw.currentY}
                stroke="#3b82f6"
                strokeWidth="2"
                strokeDasharray="6 3"
                markerEnd="url(#arrowhead-draw)"
              />
            </>
          )}
        </svg>
      </div>
    </div>

    </div>
  );
}
