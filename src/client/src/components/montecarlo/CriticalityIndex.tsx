import { useMemo, useState } from 'react';

interface CriticalityEntry {
  taskId: string;
  taskName: string;
  criticalityPercent: number;
}

interface CriticalityIndexProps {
  data: CriticalityEntry[];
}

function barColor(pct: number): string {
  if (pct > 80) return '#ef4444';
  if (pct > 50) return '#f97316';
  if (pct > 30) return '#eab308';
  return '#22c55e';
}

function barBgColor(pct: number): string {
  if (pct > 80) return '#fef2f2';
  if (pct > 50) return '#fff7ed';
  if (pct > 30) return '#fefce8';
  return '#f0fdf4';
}

export function CriticalityIndex({ data }: CriticalityIndexProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const svgHeight = useMemo(() => {
    const barH = 32;
    const padVert = 48;
    return Math.max(180, data.length * barH + padVert);
  }, [data.length]);

  const {
    svgWidth,
    padding,
    plotWidth,
    plotHeight,
    bars,
    xLabels,
  } = useMemo(() => {
    const svgW = 700;
    const pad = { top: 24, right: 50, bottom: 28, left: 180 };
    const pW = svgW - pad.left - pad.right;
    const pH = svgHeight - pad.top - pad.bottom;

    // Sort by criticalityPercent descending
    const sortedData = [...data].sort(
      (a, b) => b.criticalityPercent - a.criticalityPercent
    );

    const barH = 22;
    const barGap = 10;
    const totalBarHeight = sortedData.length * (barH + barGap) - barGap;
    const startY = pad.top + (pH - totalBarHeight) / 2;

    const barsData = sortedData.map((entry, i) => {
      const y = startY + i * (barH + barGap);
      const barWidth = (entry.criticalityPercent / 100) * pW;
      const x = pad.left;
      const color = barColor(entry.criticalityPercent);
      const bg = barBgColor(entry.criticalityPercent);

      return { entry, y, x, width: barWidth, height: barH, color, bg };
    });

    // X-axis labels (0%, 25%, 50%, 75%, 100%)
    const xL = [0, 25, 50, 75, 100].map((pct) => ({
      x: pad.left + (pct / 100) * pW,
      label: `${pct}%`,
    }));

    return {
      svgWidth: svgW,
      padding: pad,
      plotWidth: pW,
      plotHeight: pH,
      bars: barsData,
      xLabels: xL,
      sorted: sortedData,
    };
  }, [data, svgHeight]);

  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-500">
        No criticality data available.
      </div>
    );
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="w-full"
        style={{ maxHeight: Math.max(svgHeight, 200) }}
        onMouseLeave={() => setHoveredIdx(null)}
      >
        {/* X-axis grid lines */}
        {xLabels.map((xl, i) => (
          <g key={`xgrid-${i}`}>
            <line
              x1={xl.x}
              y1={padding.top}
              x2={xl.x}
              y2={padding.top + plotHeight}
              stroke="#f3f4f6"
              strokeWidth="1"
            />
            <text
              x={xl.x}
              y={svgHeight - 6}
              textAnchor="middle"
              fontSize="10"
              fill="#9ca3af"
            >
              {xl.label}
            </text>
          </g>
        ))}

        {/* X-axis title */}
        <text
          x={padding.left + plotWidth / 2}
          y={svgHeight}
          textAnchor="middle"
          fontSize="10"
          fill="#6b7280"
        >
          Criticality (% of simulations on critical path)
        </text>

        {/* Bars */}
        {bars.map((bar, i) => (
          <g
            key={bar.entry.taskId}
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
          >
            {/* Task name label */}
            <text
              x={padding.left - 8}
              y={bar.y + bar.height / 2 + 4}
              textAnchor="end"
              fontSize="11"
              fill={hoveredIdx === i ? '#111827' : '#4b5563'}
              fontWeight={hoveredIdx === i ? '600' : '400'}
            >
              {bar.entry.taskName.length > 24
                ? bar.entry.taskName.slice(0, 22) + '...'
                : bar.entry.taskName}
            </text>

            {/* Bar background (track) */}
            <rect
              x={bar.x}
              y={bar.y}
              width={plotWidth}
              height={bar.height}
              fill={hoveredIdx === i ? '#f9fafb' : '#fafafa'}
              rx="4"
            />

            {/* Filled bar */}
            <rect
              x={bar.x}
              y={bar.y}
              width={bar.width}
              height={bar.height}
              fill={bar.color}
              opacity={hoveredIdx === i ? 1 : 0.85}
              rx="4"
              className="transition-opacity duration-150"
            />

            {/* Percentage label */}
            <text
              x={bar.x + bar.width + 6}
              y={bar.y + bar.height / 2 + 4}
              textAnchor="start"
              fontSize="11"
              fontWeight="600"
              fill={bar.color}
            >
              {bar.entry.criticalityPercent.toFixed(1)}%
            </text>
          </g>
        ))}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-5 justify-center mt-2">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-red-500" />
          <span className="text-xs text-gray-500 dark:text-gray-400">&gt;80% (Critical)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-orange-500" />
          <span className="text-xs text-gray-500 dark:text-gray-400">&gt;50%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-yellow-500" />
          <span className="text-xs text-gray-500 dark:text-gray-400">&gt;30%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-green-500" />
          <span className="text-xs text-gray-500 dark:text-gray-400">&le;30%</span>
        </div>
      </div>
    </div>
  );
}
