import { useMemo, useState } from 'react';

interface SensitivityEntry {
  taskId: string;
  taskName: string;
  correlationCoefficient: number;
  rank: number;
}

interface TornadoDiagramProps {
  data: SensitivityEntry[];
}

export function TornadoDiagram({ data }: TornadoDiagramProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const svgHeight = useMemo(() => {
    const barH = 32;
    const padding = 48;
    return Math.max(180, data.length * barH + padding);
  }, [data.length]);

  const {
    svgWidth,
    padding,
    plotWidth,
    plotHeight,
    centerX,
    bars,
    xLabels,
  } = useMemo(() => {
    const svgW = 700;
    const pad = { top: 28, right: 30, bottom: 28, left: 180 };
    const pW = svgW - pad.left - pad.right;
    const pH = svgHeight - pad.top - pad.bottom;
    const cX = pad.left + pW / 2;

    // Sort by absolute correlation descending
    const sortedData = [...data].sort(
      (a, b) => Math.abs(b.correlationCoefficient) - Math.abs(a.correlationCoefficient)
    );

    const maxAbs = Math.max(
      ...sortedData.map((d) => Math.abs(d.correlationCoefficient)),
      0.01
    );
    // Round up to nice value
    const absMax = Math.ceil(maxAbs * 10) / 10;

    const barH = 22;
    const barGap = 10;
    const totalBarHeight = sortedData.length * (barH + barGap) - barGap;
    const startY = pad.top + (pH - totalBarHeight) / 2;

    const barsData = sortedData.map((entry, i) => {
      const y = startY + i * (barH + barGap);
      const ratio = entry.correlationCoefficient / absMax;
      const barWidth = Math.abs(ratio) * (pW / 2);
      const x = ratio >= 0 ? cX : cX - barWidth;
      const color = ratio >= 0 ? '#3b82f6' : '#ef4444';

      return { entry, y, x, width: barWidth, height: barH, color, ratio };
    });

    // X-axis labels
    const xTicks = [-absMax, -absMax / 2, 0, absMax / 2, absMax];
    const xL = xTicks.map((val) => ({
      x: cX + (val / absMax) * (pW / 2),
      label: val.toFixed(1),
    }));

    return {
      svgWidth: svgW,
      padding: pad,
      plotWidth: pW,
      plotHeight: pH,
      centerX: cX,
      bars: barsData,
      xLabels: xL,
      sorted: sortedData,
    };
  }, [data, svgHeight]);

  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-500">
        No sensitivity data available.
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
        {/* Center axis */}
        <line
          x1={centerX}
          y1={padding.top - 4}
          x2={centerX}
          y2={padding.top + plotHeight + 4}
          stroke="#d1d5db"
          strokeWidth="1"
        />

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
          Correlation Coefficient
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

            {/* Bar */}
            <rect
              x={bar.x}
              y={bar.y}
              width={bar.width}
              height={bar.height}
              fill={bar.color}
              opacity={hoveredIdx === i ? 1 : 0.8}
              rx="3"
              className="transition-opacity duration-150"
            />

            {/* Value label on bar */}
            <text
              x={
                bar.ratio >= 0
                  ? bar.x + bar.width + 5
                  : bar.x - 5
              }
              y={bar.y + bar.height / 2 + 4}
              textAnchor={bar.ratio >= 0 ? 'start' : 'end'}
              fontSize="10"
              fontWeight="600"
              fill={bar.color}
            >
              {bar.entry.correlationCoefficient.toFixed(2)}
            </text>
          </g>
        ))}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-5 justify-center mt-2">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-blue-500" />
          <span className="text-xs text-gray-500 dark:text-gray-400">Positive correlation (delays project)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-red-500" />
          <span className="text-xs text-gray-500 dark:text-gray-400">Negative correlation</span>
        </div>
      </div>
    </div>
  );
}
