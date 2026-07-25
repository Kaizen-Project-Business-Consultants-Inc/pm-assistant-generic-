import { useMemo, useState } from 'react';

interface BurndownDataPoint {
  date: string;
  ideal: number;
  actual: number;
  completed: number;
}

interface BurndownChartProps {
  dataPoints: BurndownDataPoint[];
  totalScope: number;
  height?: number;
}

export function BurndownChart({ dataPoints, totalScope, height = 300 }: BurndownChartProps) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; point: BurndownDataPoint } | null>(null);

  const { idealLine, actualLine, completedLine, todayX, xLabels, yLabels, padding, plotWidth, plotHeight } = useMemo(() => {
    const padding = { top: 20, right: 20, bottom: 40, left: 50 };
    const svgWidth = 700;
    const plotWidth = svgWidth - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;

    if (dataPoints.length === 0) return { idealLine: '', actualLine: '', completedLine: '', todayX: 0, xLabels: [], yLabels: [], padding, plotWidth, plotHeight };

    const maxVal = totalScope;
    const today = new Date().toISOString().slice(0, 10);
    let todayX = -1;

    const scaleX = (i: number) => padding.left + (i / Math.max(1, dataPoints.length - 1)) * plotWidth;
    const scaleY = (v: number) => padding.top + (1 - v / maxVal) * plotHeight;

    const idealPoints: string[] = [];
    const actualPoints: string[] = [];
    const completedPoints: string[] = [];

    dataPoints.forEach((p, i) => {
      const x = scaleX(i);
      idealPoints.push(`${x},${scaleY(p.ideal)}`);
      if (p.actual >= 0) actualPoints.push(`${x},${scaleY(p.actual)}`);
      if (p.completed >= 0) completedPoints.push(`${x},${scaleY(p.completed)}`);
      if (p.date === today) todayX = x;
      if (todayX < 0 && p.date > today && i > 0) todayX = scaleX(i - 0.5);
    });

    // X-axis labels (show ~6)
    const step = Math.max(1, Math.floor(dataPoints.length / 6));
    const xLabels = dataPoints
      .filter((_, i) => i % step === 0 || i === dataPoints.length - 1)
      .map((p) => ({
        label: new Date(p.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        x: scaleX(dataPoints.indexOf(p)),
      }));

    // Y-axis labels
    const ySteps = 5;
    const yLabels = Array.from({ length: ySteps + 1 }, (_, i) => {
      const val = Math.round((maxVal / ySteps) * i);
      return { val, y: scaleY(val) };
    });

    return {
      idealLine: idealPoints.join(' '),
      actualLine: actualPoints.join(' '),
      completedLine: completedPoints.join(' '),
      todayX,
      xLabels,
      yLabels,
      padding,
      plotWidth,
      plotHeight,
    };
  }, [dataPoints, totalScope, height]);

  if (dataPoints.length === 0) {
    return <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">No burndown data available</p>;
  }

  const svgWidth = 700;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${svgWidth} ${height}`} className="w-full" style={{ maxHeight: height }}>
        {/* Grid */}
        {yLabels.map((yl, i) => (
          <g key={i}>
            <line x1={padding.left} y1={yl.y} x2={padding.left + plotWidth} y2={yl.y} stroke="#e5e7eb" strokeWidth="1" />
            <text x={padding.left - 8} y={yl.y + 4} textAnchor="end" fontSize="10" fill="#9ca3af">{yl.val}</text>
          </g>
        ))}

        {/* X-axis labels */}
        {xLabels.map((xl, i) => (
          <text key={i} x={xl.x} y={height - 10} textAnchor="middle" fontSize="10" fill="#9ca3af">{xl.label}</text>
        ))}

        {/* Ideal line (dashed gray) */}
        <polyline points={idealLine} fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeDasharray="6 3" />

        {/* Actual remaining (indigo) */}
        {actualLine && <polyline points={actualLine} fill="none" stroke="#6366f1" strokeWidth="2.5" />}

        {/* Burnup completed (green) */}
        {completedLine && <polyline points={completedLine} fill="none" stroke="#22c55e" strokeWidth="2" />}

        {/* Today marker */}
        {todayX > 0 && (
          <g>
            <line x1={todayX} y1={padding.top} x2={todayX} y2={padding.top + plotHeight} stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4 2" />
            <text x={todayX} y={padding.top - 4} textAnchor="middle" fontSize="9" fill="#f59e0b" fontWeight="600">Today</text>
          </g>
        )}

        {/* Hover zones */}
        {dataPoints.map((p, i) => {
          const x = padding.left + (i / Math.max(1, dataPoints.length - 1)) * plotWidth;
          return (
            <rect
              key={i}
              x={x - 8}
              y={padding.top}
              width={16}
              height={plotHeight}
              fill="transparent"
              onMouseEnter={(e) => setTooltip({ x: e.clientX, y: e.clientY, point: p })}
              onMouseLeave={() => setTooltip(null)}
            />
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-5 justify-center mt-2 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-0.5 bg-gray-400" style={{ borderTop: '2px dashed #9ca3af' }} />
          <span className="text-gray-600 dark:text-gray-400">Ideal</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-0.5 bg-primary-500" />
          <span className="text-gray-600 dark:text-gray-400">Remaining</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-0.5 bg-green-500" />
          <span className="text-gray-600 dark:text-gray-400">Completed</span>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg px-3 py-2 pointer-events-none shadow-lg"
          style={{ left: tooltip.x + 10, top: tooltip.y - 50 }}
        >
          <p className="font-medium">{new Date(tooltip.point.date + 'T00:00:00').toLocaleDateString()}</p>
          <p>Ideal: {tooltip.point.ideal} tasks remaining</p>
          {tooltip.point.actual >= 0 && <p>Actual: {tooltip.point.actual} tasks remaining</p>}
          {tooltip.point.completed >= 0 && <p>Completed: {tooltip.point.completed} tasks</p>}
        </div>
      )}
    </div>
  );
}
