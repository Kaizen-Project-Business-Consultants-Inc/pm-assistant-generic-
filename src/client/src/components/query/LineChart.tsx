import { useMemo, useState, useCallback } from 'react';

const DEFAULT_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

interface LineChartDatum {
  label: string;
  value: number;
  color?: string;
}

interface LineChartProps {
  data: LineChartDatum[];
  xAxisLabel?: string;
  yAxisLabel?: string;
}

function formatValue(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 10_000) return `${(v / 1_000).toFixed(0)}K`;
  if (Number.isInteger(v)) return v.toString();
  return v.toFixed(1);
}

function niceMax(maxVal: number): number {
  if (maxVal <= 0) return 10;
  const magnitude = Math.pow(10, Math.floor(Math.log10(maxVal)));
  const residual = maxVal / magnitude;
  if (residual <= 1) return magnitude;
  if (residual <= 2) return 2 * magnitude;
  if (residual <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

export function LineChart({ data, xAxisLabel, yAxisLabel }: LineChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const svgWidth = 700;
  const svgHeight = 360;

  const layout = useMemo(() => {
    if (data.length === 0) return null;

    const pad = { top: 24, right: 30, bottom: 70, left: 60 };
    const plotW = svgWidth - pad.left - pad.right;
    const plotH = svgHeight - pad.top - pad.bottom;

    const maxRaw = Math.max(...data.map((d) => d.value), 0);
    const minRaw = Math.min(...data.map((d) => d.value), 0);
    const yMax = niceMax(maxRaw * 1.15);
    const yMin = minRaw < 0 ? -niceMax(Math.abs(minRaw) * 1.15) : 0;
    const yRange = yMax - yMin;

    const points = data.map((d, i) => ({
      x: pad.left + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW),
      y: pad.top + plotH - ((d.value - yMin) / yRange) * plotH,
      data: d,
      color: d.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
    }));

    const tickCount = 5;
    const yTicks = Array.from({ length: tickCount + 1 }, (_, i) => {
      const val = yMin + (yRange / tickCount) * i;
      return {
        value: val,
        y: pad.top + plotH - ((val - yMin) / yRange) * plotH,
      };
    });

    // X axis labels
    const maxLabels = 10;
    const step = Math.max(1, Math.ceil(data.length / maxLabels));
    const xLabels: { x: number; label: string }[] = [];
    for (let i = 0; i < data.length; i += step) {
      xLabels.push({ x: points[i].x, label: data[i].label });
    }
    // Always include last label
    if (data.length > 1 && (data.length - 1) % step !== 0) {
      xLabels.push({ x: points[data.length - 1].x, label: data[data.length - 1].label });
    }

    const linePath =
      'M ' +
      points.map((p) => `${p.x},${p.y}`).join(' L ');

    // Gradient fill area
    const areaPath =
      linePath +
      ` L ${points[points.length - 1].x},${pad.top + plotH}` +
      ` L ${points[0].x},${pad.top + plotH} Z`;

    return { points, yTicks, xLabels, pad, plotW, plotH, linePath, areaPath, yMax, yMin };
  }, [data]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!layout || layout.points.length === 0) return;
      const svg = e.currentTarget;
      const rect = svg.getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left) / rect.width) * svgWidth;

      let closest = 0;
      let closestDist = Infinity;
      for (let i = 0; i < layout.points.length; i++) {
        const dist = Math.abs(layout.points[i].x - mouseX);
        if (dist < closestDist) {
          closestDist = dist;
          closest = i;
        }
      }
      setHoveredIndex(closest);
    },
    [layout],
  );

  if (!layout || data.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-gray-400 dark:text-gray-500">
        No chart data available.
      </div>
    );
  }

  const { points, yTicks, xLabels, pad, plotW, plotH, linePath, areaPath } = layout;
  const needsRotation = data.length > 6;
  const hovered = hoveredIndex !== null ? points[hoveredIndex] : null;

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="w-full"
        preserveAspectRatio="xMidYMid meet"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        <defs>
          <linearGradient id="lineAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={pad.left}
              y1={t.y}
              x2={pad.left + plotW}
              y2={t.y}
              stroke="#e5e7eb"
              strokeWidth="1"
            />
            <text x={pad.left - 8} y={t.y + 3} textAnchor="end" fontSize="10" fill="#9ca3af">
              {formatValue(t.value)}
            </text>
          </g>
        ))}

        {/* Axes */}
        <line x1={pad.left} y1={pad.top} x2={pad.left} y2={pad.top + plotH} stroke="#d1d5db" strokeWidth="1" />
        <line x1={pad.left} y1={pad.top + plotH} x2={pad.left + plotW} y2={pad.top + plotH} stroke="#d1d5db" strokeWidth="1" />

        {/* X-axis labels */}
        {xLabels.map((xl, i) => (
          <text
            key={i}
            x={xl.x}
            y={pad.top + plotH + 16}
            textAnchor={needsRotation ? 'end' : 'middle'}
            fontSize="11"
            fill="#6b7280"
            transform={needsRotation ? `rotate(-35, ${xl.x}, ${pad.top + plotH + 16})` : undefined}
          >
            {xl.label.length > 12 ? xl.label.slice(0, 11) + '...' : xl.label}
          </text>
        ))}

        {/* Area fill */}
        <path d={areaPath} fill="url(#lineAreaGrad)" />

        {/* Line */}
        <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

        {/* Data points */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={hoveredIndex === i ? 5 : 3.5}
            fill="white"
            stroke={p.color}
            strokeWidth="2"
            className="transition-all"
          />
        ))}

        {/* Hover indicator */}
        {hovered && (
          <>
            <line
              x1={hovered.x}
              y1={pad.top}
              x2={hovered.x}
              y2={pad.top + plotH}
              stroke="#6366f1"
              strokeWidth="1"
              strokeDasharray="4,3"
              opacity="0.4"
            />
          </>
        )}

        {/* Axis labels */}
        {xAxisLabel && (
          <text x={pad.left + plotW / 2} y={svgHeight - 4} textAnchor="middle" fontSize="12" fill="#6b7280" fontWeight="500">
            {xAxisLabel}
          </text>
        )}
        {yAxisLabel && (
          <text
            x={14}
            y={pad.top + plotH / 2}
            textAnchor="middle"
            fontSize="12"
            fill="#6b7280"
            fontWeight="500"
            transform={`rotate(-90, 14, ${pad.top + plotH / 2})`}
          >
            {yAxisLabel}
          </text>
        )}
      </svg>

      {/* Tooltip */}
      {hovered && (
        <div
          className="absolute z-20 bg-gray-900 dark:bg-gray-700 text-white rounded-lg px-3 py-2 text-xs shadow-lg pointer-events-none"
          style={{
            left: `${(hovered.x / svgWidth) * 100}%`,
            top: `${(hovered.y / svgHeight) * 100 - 8}%`,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="font-semibold">{hovered.data.label}</div>
          <div className="text-blue-300">{formatValue(hovered.data.value)}</div>
        </div>
      )}
    </div>
  );
}
