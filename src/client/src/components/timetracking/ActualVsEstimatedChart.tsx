import { useMemo, useState } from 'react';

interface TaskComparison {
  taskId: string;
  taskName: string;
  estimatedHours: number;
  actualHours: number;
}

interface ActualVsEstimatedChartProps {
  tasks: TaskComparison[];
  height?: number;
}

export function ActualVsEstimatedChart({ tasks, height = 300 }: ActualVsEstimatedChartProps) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; task: TaskComparison } | null>(null);

  const filtered = tasks.filter(t => t.estimatedHours > 0 || t.actualHours > 0);

  const { bars, svgWidth, svgHeight, yLabels } = useMemo(() => {
    const padding = { top: 20, right: 20, bottom: 40, left: 160 };
    const barHeight = 20;
    const barGap = 8;
    const groupGap = 16;
    const groupHeight = barHeight * 2 + barGap;

    const svgHeight = Math.max(height, padding.top + padding.bottom + filtered.length * (groupHeight + groupGap));
    const svgWidth = 600;
    const plotWidth = svgWidth - padding.left - padding.right;

    const maxHours = Math.max(...filtered.flatMap(t => [t.estimatedHours, t.actualHours]), 1);

    const bars = filtered.map((task, i) => {
      const y = padding.top + i * (groupHeight + groupGap);
      const estWidth = (task.estimatedHours / maxHours) * plotWidth;
      const actWidth = (task.actualHours / maxHours) * plotWidth;
      return {
        task,
        nameY: y + groupHeight / 2,
        estBar: { x: padding.left, y, width: Math.max(1, estWidth), height: barHeight },
        actBar: { x: padding.left, y: y + barHeight + barGap, width: Math.max(1, actWidth), height: barHeight },
      };
    });

    // Y-axis labels (hour marks)
    const yLabelCount = 5;
    const yLabels = Array.from({ length: yLabelCount + 1 }, (_, i) => {
      const val = Math.round((maxHours / yLabelCount) * i);
      const x = padding.left + (val / maxHours) * plotWidth;
      return { val, x };
    });

    return { bars, svgWidth, svgHeight, maxHours, yLabels };
  }, [filtered, height]);

  if (filtered.length === 0) {
    return <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">No data to compare</p>;
  }

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full" style={{ maxHeight: svgHeight }}>
        {/* Grid lines */}
        {yLabels.map((yl, i) => (
          <g key={i}>
            <line x1={yl.x} y1={15} x2={yl.x} y2={svgHeight - 30} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4" />
            <text x={yl.x} y={svgHeight - 15} textAnchor="middle" fontSize="10" fill="#9ca3af">{yl.val}h</text>
          </g>
        ))}

        {bars.map((b, i) => (
          <g key={i}>
            {/* Task name */}
            <text x={155} y={b.nameY + 4} textAnchor="end" fontSize="11" fill="#374151" className="font-medium">
              {b.task.taskName.length > 20 ? b.task.taskName.slice(0, 20) + '...' : b.task.taskName}
            </text>

            {/* Estimated bar */}
            <rect
              x={b.estBar.x} y={b.estBar.y} width={b.estBar.width} height={b.estBar.height}
              rx="3" fill="#a5b4fc"
              onMouseEnter={(e) => setTooltip({ x: e.clientX, y: e.clientY, task: b.task })}
              onMouseLeave={() => setTooltip(null)}
            />
            <text x={b.estBar.x + b.estBar.width + 4} y={b.estBar.y + 14} fontSize="10" fill="#6366f1">
              {b.task.estimatedHours}h
            </text>

            {/* Actual bar */}
            <rect
              x={b.actBar.x} y={b.actBar.y} width={b.actBar.width} height={b.actBar.height}
              rx="3" fill={b.task.actualHours > b.task.estimatedHours ? '#f87171' : '#34d399'}
              onMouseEnter={(e) => setTooltip({ x: e.clientX, y: e.clientY, task: b.task })}
              onMouseLeave={() => setTooltip(null)}
            />
            <text x={b.actBar.x + b.actBar.width + 4} y={b.actBar.y + 14} fontSize="10" fill={b.task.actualHours > b.task.estimatedHours ? '#dc2626' : '#059669'}>
              {b.task.actualHours}h
            </text>
          </g>
        ))}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-5 justify-center mt-2 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-primary-300" />
          <span className="text-gray-600 dark:text-gray-400">Estimated</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-emerald-400" />
          <span className="text-gray-600 dark:text-gray-400">Actual (under)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-red-400" />
          <span className="text-gray-600 dark:text-gray-400">Actual (over)</span>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg px-3 py-2 pointer-events-none shadow-lg"
          style={{ left: tooltip.x + 10, top: tooltip.y - 40 }}
        >
          <p className="font-medium">{tooltip.task.taskName}</p>
          <p>Estimated: {tooltip.task.estimatedHours}h</p>
          <p>Actual: {tooltip.task.actualHours}h</p>
          <p>Variance: {(tooltip.task.actualHours - tooltip.task.estimatedHours).toFixed(1)}h</p>
        </div>
      )}
    </div>
  );
}
