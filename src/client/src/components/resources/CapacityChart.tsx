import { useMemo, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CapacityWeek {
  week: string;
  totalCapacity: number;
  totalAllocated: number;
  surplus: number;
  deficit: number;
}

interface CapacityChartProps {
  data: CapacityWeek[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatWeek(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatHours(h: number): string {
  if (h >= 1000) return `${(h / 1000).toFixed(1)}k`;
  return `${Math.round(h)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CapacityChart({ data }: CapacityChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const chart = useMemo(() => {
    if (data.length === 0) {
      return null;
    }

    // SVG dimensions
    const svgW = 800;
    const svgH = 360;
    const pad = { top: 30, right: 30, bottom: 50, left: 60 };
    const plotW = svgW - pad.left - pad.right;
    const plotH = svgH - pad.top - pad.bottom;

    // Find the maximum value for Y axis — we need to cover both capacity and
    // allocated (which may exceed capacity when there is a deficit).
    const maxVal =
      Math.max(
        ...data.map((d) => Math.max(d.totalCapacity, d.totalAllocated)),
        1
      ) * 1.15;

    // Bar geometry
    const barCount = data.length;
    const groupWidth = plotW / barCount;
    const barWidth = Math.min(groupWidth * 0.6, 48);
    const barGap = (groupWidth - barWidth) / 2;

    // Y-axis ticks (5 ticks)
    const yTicks: { y: number; label: string; value: number }[] = [];
    for (let i = 0; i <= 4; i++) {
      const val = (maxVal / 4) * i;
      yTicks.push({
        y: pad.top + plotH - (val / maxVal) * plotH,
        label: formatHours(val) + 'h',
        value: val,
      });
    }

    // Compute bar segments per week
    const bars = data.map((d, i) => {
      const x = pad.left + i * groupWidth + barGap;
      const usedHeight = Math.min(d.totalAllocated, d.totalCapacity);
      const deficitHeight = d.deficit > 0 ? d.deficit : 0;

      // Heights in SVG coords
      const usedH = (usedHeight / maxVal) * plotH;
      const deficitH = (deficitHeight / maxVal) * plotH;

      // Y positions (bars grow upward from baseline)
      const baseline = pad.top + plotH;
      const usedY = baseline - usedH;
      const deficitY = usedY - deficitH;

      // Capacity line y
      const capY = baseline - (d.totalCapacity / maxVal) * plotH;

      return {
        x,
        usedY,
        usedH,
        deficitY,
        deficitH,
        capY,
        baseline,
        week: d,
        labelX: x + barWidth / 2,
      };
    });

    return {
      svgW,
      svgH,
      pad,
      plotW,
      plotH,
      barWidth,
      groupWidth,
      yTicks,
      bars,
    };
  }, [data]);

  if (!chart || data.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 text-center text-sm text-gray-400 dark:text-gray-500">
        No capacity data available.
      </div>
    );
  }

  const { svgW, svgH, pad, plotW, plotH, barWidth, yTicks, bars } = chart;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
      <div className="flex items-center gap-2 mb-4">
        {/* Chart icon (hand-rolled SVG) */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4 text-primary-500"
        >
          <path d="M15.5 2A1.5 1.5 0 0014 3.5v13a1.5 1.5 0 001.5 1.5h1a1.5 1.5 0 001.5-1.5v-13A1.5 1.5 0 0016.5 2h-1zM9.5 6A1.5 1.5 0 008 7.5v9A1.5 1.5 0 009.5 18h1a1.5 1.5 0 001.5-1.5v-9A1.5 1.5 0 0010.5 6h-1zM3.5 10A1.5 1.5 0 002 11.5v5A1.5 1.5 0 003.5 18h1A1.5 1.5 0 006 16.5v-5A1.5 1.5 0 004.5 10h-1z" />
        </svg>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Capacity vs Allocation</h3>
        <span className="text-xs text-gray-400 dark:text-gray-500">{data.length} weeks</span>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="w-full"
          style={{ maxHeight: 360 }}
          onMouseLeave={() => setHoveredIdx(null)}
        >
          {/* Grid lines */}
          {yTicks.map((yt, i) => (
            <line
              key={i}
              x1={pad.left}
              y1={yt.y}
              x2={pad.left + plotW}
              y2={yt.y}
              stroke="#f3f4f6"
              strokeWidth="1"
            />
          ))}

          {/* Y axis labels */}
          {yTicks.map((yt, i) => (
            <text
              key={i}
              x={pad.left - 8}
              y={yt.y + 4}
              textAnchor="end"
              fontSize="10"
              fill="#9ca3af"
            >
              {yt.label}
            </text>
          ))}

          {/* Baseline axis */}
          <line
            x1={pad.left}
            y1={pad.top + plotH}
            x2={pad.left + plotW}
            y2={pad.top + plotH}
            stroke="#e5e7eb"
            strokeWidth="1"
          />

          {/* Bars */}
          {bars.map((bar, i) => {
            const isHovered = hoveredIdx === i;

            return (
              <g key={i}>
                {/* Green portion: capacity used (allocated up to capacity) */}
                {bar.usedH > 0 && (
                  <rect
                    x={bar.x}
                    y={bar.usedY}
                    width={barWidth}
                    height={bar.usedH}
                    rx={3}
                    fill={isHovered ? '#16a34a' : '#22c55e'}
                    opacity={isHovered ? 1 : 0.85}
                  />
                )}

                {/* Red portion: deficit (allocated above capacity) */}
                {bar.deficitH > 0 && (
                  <rect
                    x={bar.x}
                    y={bar.deficitY}
                    width={barWidth}
                    height={bar.deficitH}
                    rx={3}
                    fill={isHovered ? '#dc2626' : '#ef4444'}
                    opacity={isHovered ? 1 : 0.85}
                  />
                )}

                {/* Capacity reference line per bar */}
                <line
                  x1={bar.x - 4}
                  y1={bar.capY}
                  x2={bar.x + barWidth + 4}
                  y2={bar.capY}
                  stroke="#6366f1"
                  strokeWidth="2"
                  strokeDasharray="4,2"
                  opacity="0.6"
                />

                {/* Surplus / Deficit label above bar */}
                {bar.week.deficit > 0 && (
                  <text
                    x={bar.labelX}
                    y={bar.deficitY - 6}
                    textAnchor="middle"
                    fontSize="9"
                    fontWeight="600"
                    fill="#ef4444"
                  >
                    -{formatHours(bar.week.deficit)}h
                  </text>
                )}
                {bar.week.surplus > 0 && (
                  <text
                    x={bar.labelX}
                    y={bar.usedY - 6}
                    textAnchor="middle"
                    fontSize="9"
                    fontWeight="600"
                    fill="#22c55e"
                  >
                    +{formatHours(bar.week.surplus)}h
                  </text>
                )}

                {/* X axis label */}
                <text
                  x={bar.labelX}
                  y={svgH - 12}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#9ca3af"
                >
                  {formatWeek(bar.week.week)}
                </text>

                {/* Invisible hover area */}
                <rect
                  x={bar.x - 4}
                  y={pad.top}
                  width={barWidth + 8}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setHoveredIdx(i)}
                />
              </g>
            );
          })}
        </svg>

        {/* Tooltip */}
        {hoveredIdx !== null && bars[hoveredIdx] && (
          <div
            className="absolute z-20 bg-gray-900 dark:bg-gray-700 text-white rounded-lg px-3 py-2 text-xs shadow-lg pointer-events-none"
            style={{
              left: `${(bars[hoveredIdx].labelX / svgW) * 100}%`,
              top: '8px',
              transform: 'translateX(-50%)',
            }}
          >
            <div className="font-semibold mb-1">
              Week of {formatWeek(data[hoveredIdx].week)}
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-sm bg-primary-400 inline-block" />
              <span>Capacity: {data[hoveredIdx].totalCapacity}h</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-sm bg-green-400 inline-block" />
              <span>Allocated: {data[hoveredIdx].totalAllocated}h</span>
            </div>
            {data[hoveredIdx].surplus > 0 && (
              <div className="flex items-center gap-2 text-green-300">
                <span className="w-2 h-2 inline-block" />
                <span>Surplus: +{data[hoveredIdx].surplus}h</span>
              </div>
            )}
            {data[hoveredIdx].deficit > 0 && (
              <div className="flex items-center gap-2 text-red-300">
                <span className="w-2 h-2 inline-block" />
                <span>Deficit: -{data[hoveredIdx].deficit}h</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-5 justify-center mt-3">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-green-500" />
          <span className="text-xs text-gray-500 dark:text-gray-400">Allocated (within capacity)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-red-500" />
          <span className="text-xs text-gray-500 dark:text-gray-400">Deficit (over capacity)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="16" height="4">
            <line x1="0" y1="2" x2="16" y2="2" stroke="#6366f1" strokeWidth="2" strokeDasharray="3,2" />
          </svg>
          <span className="text-xs text-gray-500 dark:text-gray-400">Capacity limit</span>
        </div>
      </div>
    </div>
  );
}
