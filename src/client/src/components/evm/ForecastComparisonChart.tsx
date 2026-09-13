import { useMemo, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ForecastMethod {
  method: string;
  eacValue: number;
  varianceFromBAC: number;
}

interface ForecastComparisonChartProps {
  data: ForecastMethod[];
  bac: number;
  height?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatDollar(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ForecastComparisonChart({ data, bac, height = 320 }: ForecastComparisonChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const { bars, svgWidth, padding, plotWidth, plotHeight, yLabels, bacY } = useMemo(() => {
    const svgW = 700;
    const pad = { top: 24, right: 30, bottom: 60, left: 70 };
    const pW = svgW - pad.left - pad.right;
    const pH = height - pad.top - pad.bottom;

    if (data.length === 0) {
      return {
        bars: [],
        svgWidth: svgW,
        padding: pad,
        plotWidth: pW,
        plotHeight: pH,
        yLabels: [],
        bacY: 0,
      };
    }

    // Determine Y range
    const allValues = [...data.map((d) => d.eacValue), bac];
    const yMax = Math.max(...allValues) * 1.15;
    const yMin = 0;

    // Bar layout
    const barGap = pW * 0.15;
    const groupWidth = (pW - barGap) / data.length;
    const barWidth = Math.min(groupWidth * 0.65, 80);

    const barData = data.map((d, i) => {
      const centerX = pad.left + barGap / 2 + groupWidth * i + groupWidth / 2;
      const barH = ((d.eacValue - yMin) / (yMax - yMin)) * pH;
      const barX = centerX - barWidth / 2;
      const barY = pad.top + pH - barH;
      const isOverBudget = d.eacValue > bac;
      return {
        ...d,
        x: barX,
        y: barY,
        w: barWidth,
        h: barH,
        centerX,
        color: isOverBudget ? '#f97316' : '#22c55e', // orange if over, green if under
        colorHover: isOverBudget ? '#ea580c' : '#16a34a',
      };
    });

    // BAC reference line Y
    const bY = pad.top + pH - ((bac - yMin) / (yMax - yMin)) * pH;

    // Y axis labels (5 ticks)
    const yL: { y: number; label: string }[] = [];
    for (let i = 0; i <= 4; i++) {
      const val = (yMax / 4) * i;
      yL.push({
        y: pad.top + pH - ((val - yMin) / (yMax - yMin)) * pH,
        label: formatDollar(val),
      });
    }

    return {
      bars: barData,
      svgWidth: svgW,
      padding: pad,
      plotWidth: pW,
      plotHeight: pH,
      yLabels: yL,
      bacY: bY,
    };
  }, [data, bac, height]);

  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-500">
        No forecast comparison data available.
      </div>
    );
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${svgWidth} ${height}`}
        className="w-full"
        style={{ maxHeight: height }}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        {/* Grid lines */}
        {yLabels.map((yl, i) => (
          <line
            key={i}
            x1={padding.left}
            y1={yl.y}
            x2={padding.left + plotWidth}
            y2={yl.y}
            stroke="#e5e7eb"
            strokeWidth="1"
          />
        ))}

        {/* Y axis labels */}
        {yLabels.map((yl, i) => (
          <text key={i} x={padding.left - 8} y={yl.y + 4} textAnchor="end" fontSize="10" fill="#9ca3af">
            {yl.label}
          </text>
        ))}

        {/* Bars */}
        {bars.map((bar, i) => (
          <g key={i} onMouseEnter={() => setHoveredIndex(i)} onMouseLeave={() => setHoveredIndex(null)}>
            {/* Bar rectangle */}
            <rect
              x={bar.x}
              y={bar.y}
              width={bar.w}
              height={bar.h}
              rx={4}
              fill={hoveredIndex === i ? bar.colorHover : bar.color}
              opacity={hoveredIndex !== null && hoveredIndex !== i ? 0.5 : 1}
              className="transition-opacity duration-150"
            />

            {/* Dollar label on top of bar */}
            <text
              x={bar.centerX}
              y={bar.y - 6}
              textAnchor="middle"
              fontSize="10"
              fontWeight="600"
              fill={bar.eacValue > bac ? '#ea580c' : '#16a34a'}
            >
              {formatDollar(bar.eacValue)}
            </text>

            {/* Method label on X axis */}
            <text
              x={bar.centerX}
              y={padding.top + plotHeight + 16}
              textAnchor="middle"
              fontSize="10"
              fill="#6b7280"
            >
              {bar.method.length > 14 ? bar.method.slice(0, 13) + '...' : bar.method}
            </text>

            {/* Variance label below method name */}
            <text
              x={bar.centerX}
              y={padding.top + plotHeight + 30}
              textAnchor="middle"
              fontSize="9"
              fill={bar.varianceFromBAC > 0 ? '#ef4444' : '#22c55e'}
            >
              {bar.varianceFromBAC > 0 ? '+' : ''}
              {formatDollar(bar.varianceFromBAC)}
            </text>
          </g>
        ))}

        {/* BAC reference line */}
        <line
          x1={padding.left}
          y1={bacY}
          x2={padding.left + plotWidth}
          y2={bacY}
          stroke="#6366f1"
          strokeWidth="1.5"
          strokeDasharray="8,4"
        />
        <text
          x={padding.left + plotWidth + 4}
          y={bacY + 4}
          fontSize="10"
          fontWeight="600"
          fill="#6366f1"
        >
          BAC
        </text>
        <text
          x={padding.left + plotWidth + 4}
          y={bacY + 16}
          fontSize="9"
          fill="#6366f1"
        >
          {formatDollar(bac)}
        </text>

        {/* Hover tooltip card */}
        {hoveredIndex !== null && (
          <g>
            {/* Tooltip background */}
            <rect
              x={bars[hoveredIndex].centerX - 60}
              y={bars[hoveredIndex].y - 52}
              width={120}
              height={40}
              rx={6}
              fill="#1f2937"
              opacity="0.95"
            />
            {/* Method name */}
            <text
              x={bars[hoveredIndex].centerX}
              y={bars[hoveredIndex].y - 36}
              textAnchor="middle"
              fontSize="9"
              fontWeight="600"
              fill="#ffffff"
            >
              {bars[hoveredIndex].method}
            </text>
            {/* EAC value */}
            <text
              x={bars[hoveredIndex].centerX}
              y={bars[hoveredIndex].y - 22}
              textAnchor="middle"
              fontSize="10"
              fill="#d1d5db"
            >
              EAC: {formatDollar(bars[hoveredIndex].eacValue)} | Var: {formatDollar(bars[hoveredIndex].varianceFromBAC)}
            </text>
          </g>
        )}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-5 justify-center mt-2">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-green-500" />
          <span className="text-xs text-gray-500 dark:text-gray-400">Under Budget</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-orange-500" />
          <span className="text-xs text-gray-500 dark:text-gray-400">Over Budget</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="20" height="4">
            <line x1="0" y1="2" x2="20" y2="2" stroke="#6366f1" strokeWidth="1.5" strokeDasharray="4,2" />
          </svg>
          <span className="text-xs text-gray-500 dark:text-gray-400">BAC Reference</span>
        </div>
      </div>
    </div>
  );
}
