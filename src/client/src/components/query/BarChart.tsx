import { useMemo } from 'react';

const DEFAULT_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

interface BarChartDatum {
  label: string;
  value: number;
  color?: string;
}

interface BarChartProps {
  data: BarChartDatum[];
  xAxisLabel?: string;
  yAxisLabel?: string;
  horizontal?: boolean;
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

export function BarChart({ data, xAxisLabel, yAxisLabel, horizontal = false }: BarChartProps) {
  const svgWidth = 700;
  const svgHeight = horizontal ? Math.max(300, data.length * 36 + 80) : 360;

  const layout = useMemo(() => {
    if (data.length === 0) return null;

    const maxRaw = Math.max(...data.map((d) => d.value), 0);
    const yMax = niceMax(maxRaw * 1.15);

    if (horizontal) {
      const pad = { top: 20, right: 50, bottom: 40, left: 120 };
      const plotW = svgWidth - pad.left - pad.right;
      const plotH = svgHeight - pad.top - pad.bottom;
      const barH = Math.min(28, (plotH / data.length) * 0.7);
      const gap = (plotH - barH * data.length) / (data.length + 1);

      const tickCount = 5;
      const yTicks = Array.from({ length: tickCount + 1 }, (_, i) => ({
        value: (yMax / tickCount) * i,
        x: pad.left + ((yMax / tickCount) * i / yMax) * plotW,
      }));

      const bars = data.map((d, i) => {
        const cy = pad.top + gap * (i + 1) + barH * i + barH / 2;
        const w = (d.value / yMax) * plotW;
        return {
          x: pad.left,
          y: cy - barH / 2,
          width: Math.max(w, 1),
          height: barH,
          color: d.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
          label: d.label,
          value: d.value,
          labelX: pad.left - 6,
          labelY: cy,
          valueLabelX: pad.left + w + 6,
          valueLabelY: cy,
        };
      });

      return { bars, yTicks, pad, plotW, plotH, yMax };
    }

    // Vertical
    const pad = { top: 20, right: 20, bottom: 70, left: 60 };
    const plotW = svgWidth - pad.left - pad.right;
    const plotH = svgHeight - pad.top - pad.bottom;
    const barW = Math.min(50, (plotW / data.length) * 0.65);
    const gap = (plotW - barW * data.length) / (data.length + 1);

    const tickCount = 5;
    const yTicks = Array.from({ length: tickCount + 1 }, (_, i) => ({
      value: (yMax / tickCount) * i,
      y: pad.top + plotH - ((yMax / tickCount) * i / yMax) * plotH,
    }));

    const bars = data.map((d, i) => {
      const cx = pad.left + gap * (i + 1) + barW * i + barW / 2;
      const h = (d.value / yMax) * plotH;
      return {
        x: cx - barW / 2,
        y: pad.top + plotH - h,
        width: barW,
        height: Math.max(h, 1),
        color: d.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
        label: d.label,
        value: d.value,
        labelX: cx,
        labelY: pad.top + plotH + 14,
        valueLabelX: cx,
        valueLabelY: pad.top + plotH - h - 6,
      };
    });

    return { bars, yTicks, pad, plotW, plotH, yMax };
  }, [data, horizontal, svgHeight]);

  if (!layout || data.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-500">
        No chart data available.
      </div>
    );
  }

  const { bars, yTicks, pad, plotW, plotH } = layout;
  const needsRotation = !horizontal && data.length > 5;

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {/* Grid lines */}
        {horizontal
          ? yTicks.map((t, i) => {
              const tx = (t as { value: number; x: number }).x;
              return (
                <g key={i}>
                  <line
                    x1={tx}
                    y1={pad.top}
                    x2={tx}
                    y2={pad.top + plotH}
                    stroke="#e5e7eb"
                    strokeWidth="1"
                  />
                  <text x={tx} y={pad.top + plotH + 16} textAnchor="middle" fontSize="10" fill="#9ca3af">
                    {formatValue(t.value)}
                  </text>
                </g>
              );
            })
          : yTicks.map((t, i) => {
              const ty = (t as { value: number; y: number }).y;
              return (
                <g key={i}>
                  <line
                    x1={pad.left}
                    y1={ty}
                    x2={pad.left + plotW}
                    y2={ty}
                    stroke="#e5e7eb"
                    strokeWidth="1"
                  />
                  <text x={pad.left - 8} y={ty + 3} textAnchor="end" fontSize="10" fill="#9ca3af">
                    {formatValue(t.value)}
                  </text>
                </g>
              );
            })}

        {/* Axes */}
        <line
          x1={pad.left}
          y1={pad.top}
          x2={pad.left}
          y2={pad.top + plotH}
          stroke="#d1d5db"
          strokeWidth="1"
        />
        <line
          x1={pad.left}
          y1={pad.top + plotH}
          x2={pad.left + plotW}
          y2={pad.top + plotH}
          stroke="#d1d5db"
          strokeWidth="1"
        />

        {/* Bars */}
        {bars.map((b, i) => (
          <g key={i}>
            <rect
              x={b.x}
              y={b.y}
              width={b.width}
              height={b.height}
              rx={3}
              fill={b.color}
              className="transition-opacity hover:opacity-80"
            />
            {/* Value label */}
            {horizontal ? (
              <text
                x={b.valueLabelX}
                y={b.valueLabelY}
                dominantBaseline="central"
                textAnchor="start"
                fontSize="11"
                fontWeight="600"
                fill="#374151"
              >
                {formatValue(b.value)}
              </text>
            ) : (
              <text
                x={b.valueLabelX}
                y={b.valueLabelY}
                textAnchor="middle"
                fontSize="11"
                fontWeight="600"
                fill="#374151"
              >
                {formatValue(b.value)}
              </text>
            )}
            {/* Category label */}
            {horizontal ? (
              <text
                x={b.labelX}
                y={b.labelY}
                dominantBaseline="central"
                textAnchor="end"
                fontSize="11"
                fill="#6b7280"
              >
                {b.label.length > 15 ? b.label.slice(0, 14) + '...' : b.label}
              </text>
            ) : (
              <text
                x={b.labelX}
                y={b.labelY}
                textAnchor={needsRotation ? 'end' : 'middle'}
                fontSize="11"
                fill="#6b7280"
                transform={
                  needsRotation ? `rotate(-35, ${b.labelX}, ${b.labelY})` : undefined
                }
              >
                {b.label.length > 12 ? b.label.slice(0, 11) + '...' : b.label}
              </text>
            )}
          </g>
        ))}

        {/* Axis labels */}
        {xAxisLabel && (
          <text
            x={pad.left + plotW / 2}
            y={svgHeight - 4}
            textAnchor="middle"
            fontSize="12"
            fill="#6b7280"
            fontWeight="500"
          >
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
    </div>
  );
}
