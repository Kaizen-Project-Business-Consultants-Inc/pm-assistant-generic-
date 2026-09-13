import { useMemo, useState } from 'react';

interface VelocityDataPoint {
  weekStart: string;
  completed: number;
}

interface VelocityChartProps {
  weeks: VelocityDataPoint[];
  averageVelocity: number;
  height?: number;
}

export function VelocityChart({ weeks, averageVelocity, height = 250 }: VelocityChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const { bars, avgY, xLabels, yLabels, padding, plotWidth } = useMemo(() => {
    const padding = { top: 20, right: 20, bottom: 40, left: 40 };
    const svgWidth = 700;
    const plotWidth = svgWidth - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;

    const maxVal = Math.max(...weeks.map(w => w.completed), averageVelocity, 1);
    const barWidth = Math.min(40, (plotWidth / Math.max(weeks.length, 1)) * 0.6);
    const gap = (plotWidth - barWidth * weeks.length) / Math.max(weeks.length, 1);

    const scaleY = (v: number) => padding.top + (1 - v / maxVal) * plotHeight;

    const bars = weeks.map((w, i) => ({
      x: padding.left + i * (barWidth + gap) + gap / 2,
      y: scaleY(w.completed),
      width: barWidth,
      height: Math.max(1, plotHeight - (scaleY(w.completed) - padding.top)),
      week: w,
    }));

    const avgY = scaleY(averageVelocity);

    // Show ~6 x-axis labels
    const step = Math.max(1, Math.floor(weeks.length / 6));
    const xLabels = weeks
      .filter((_, i) => i % step === 0 || i === weeks.length - 1)
      .map(w => ({
        label: new Date(w.weekStart + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        x: padding.left + weeks.indexOf(w) * (barWidth + gap) + gap / 2 + barWidth / 2,
      }));

    const ySteps = 4;
    const yLabels = Array.from({ length: ySteps + 1 }, (_, i) => {
      const val = Math.round((maxVal / ySteps) * i);
      return { val, y: scaleY(val) };
    });

    return { bars, avgY, xLabels, yLabels, padding, plotWidth, plotHeight };
  }, [weeks, averageVelocity, height]);

  if (weeks.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-500 text-center py-8">No velocity data available</p>;
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

        {/* Average velocity line */}
        <line x1={padding.left} y1={avgY} x2={padding.left + plotWidth} y2={avgY} stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="6 3" />
        <text x={padding.left + plotWidth + 2} y={avgY + 4} fontSize="9" fill="#f59e0b">Avg: {averageVelocity}</text>

        {/* Bars */}
        {bars.map((b, i) => (
          <g key={i}>
            <rect
              x={b.x} y={b.y} width={b.width} height={b.height}
              rx="3" fill={hoverIndex === i ? '#4f46e5' : '#818cf8'}
              onMouseEnter={() => setHoverIndex(i)}
              onMouseLeave={() => setHoverIndex(null)}
            />
            {b.week.completed > 0 && (
              <text x={b.x + b.width / 2} y={b.y - 4} textAnchor="middle" fontSize="10" fill="#4f46e5" fontWeight="600">
                {b.week.completed}
              </text>
            )}
          </g>
        ))}
      </svg>

      {/* Hover tooltip */}
      {hoverIndex !== null && bars[hoverIndex] && (
        <div className="text-center text-xs text-gray-500 dark:text-gray-400 mt-1">
          Week of {new Date(bars[hoverIndex].week.weekStart + 'T00:00:00').toLocaleDateString()} — {bars[hoverIndex].week.completed} tasks completed
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-5 justify-center mt-2 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-primary-400" />
          <span className="text-gray-600 dark:text-gray-400">Tasks Completed</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-0.5" style={{ borderTop: '2px dashed #f59e0b' }} />
          <span className="text-gray-600 dark:text-gray-400">Average Velocity</span>
        </div>
      </div>
    </div>
  );
}
