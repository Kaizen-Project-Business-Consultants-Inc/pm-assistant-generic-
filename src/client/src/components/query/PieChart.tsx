import { useMemo, useState } from 'react';

const DEFAULT_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

interface PieChartDatum {
  label: string;
  value: number;
  color?: string;
}

interface PieChartProps {
  data: PieChartDatum[];
}

function formatValue(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 10_000) return `${(v / 1_000).toFixed(0)}K`;
  if (Number.isInteger(v)) return v.toString();
  return v.toFixed(1);
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startAngle: number,
  endAngle: number,
): string {
  const sweep = endAngle - startAngle;
  const largeArc = sweep > 180 ? 1 : 0;

  const outerStart = polarToCartesian(cx, cy, outerR, startAngle);
  const outerEnd = polarToCartesian(cx, cy, outerR, endAngle);
  const innerStart = polarToCartesian(cx, cy, innerR, startAngle);
  const innerEnd = polarToCartesian(cx, cy, innerR, endAngle);

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ');
}

export function PieChart({ data }: PieChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const svgSize = 400;
  const cx = svgSize / 2;
  const cy = svgSize / 2;
  const outerR = 140;
  const innerR = 80;

  const segments = useMemo(() => {
    const total = data.reduce((s, d) => s + Math.max(d.value, 0), 0);
    if (total === 0) return [];

    let cumAngle = 0;
    return data
      .filter((d) => d.value > 0)
      .map((d, i) => {
        const sweep = (d.value / total) * 360;
        const startAngle = cumAngle;
        const endAngle = cumAngle + sweep;
        const midAngle = startAngle + sweep / 2;
        cumAngle = endAngle;

        const color = d.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
        const pct = ((d.value / total) * 100).toFixed(1);

        // Label connector points
        const labelR = outerR + 20;
        const anchorR = outerR + 6;
        const mid = polarToCartesian(cx, cy, anchorR, midAngle);
        const labelPt = polarToCartesian(cx, cy, labelR, midAngle);

        return {
          path: describeArc(cx, cy, outerR, innerR, startAngle, Math.min(endAngle, startAngle + 359.99)),
          color,
          label: d.label,
          value: d.value,
          pct,
          mid,
          labelPt,
          midAngle,
        };
      });
  }, [data]);

  if (segments.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-gray-400 dark:text-gray-500">
        No chart data available.
      </div>
    );
  }

  const total = data.reduce((s, d) => s + Math.max(d.value, 0), 0);

  return (
    <div className="w-full flex flex-col items-center">
      <div className="relative" style={{ maxWidth: svgSize }}>
        <svg
          viewBox={`0 0 ${svgSize} ${svgSize}`}
          className="w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Segments */}
          {segments.map((seg, i) => (
            <path
              key={i}
              d={seg.path}
              fill={seg.color}
              stroke="white"
              strokeWidth="2"
              className="transition-opacity cursor-pointer"
              opacity={hoveredIdx === null || hoveredIdx === i ? 1 : 0.5}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            />
          ))}

          {/* Center label */}
          <text x={cx} y={cy - 6} textAnchor="middle" fontSize="13" fill="#9ca3af" fontWeight="500">
            Total
          </text>
          <text x={cx} y={cy + 14} textAnchor="middle" fontSize="18" fill="#111827" fontWeight="700">
            {formatValue(total)}
          </text>

          {/* Connector lines and labels (only when not too many segments) */}
          {segments.length <= 8 &&
            segments.map((seg, i) => (
              <g key={`label-${i}`} opacity={hoveredIdx === null || hoveredIdx === i ? 1 : 0.4}>
                <line
                  x1={seg.mid.x}
                  y1={seg.mid.y}
                  x2={seg.labelPt.x}
                  y2={seg.labelPt.y}
                  stroke={seg.color}
                  strokeWidth="1"
                />
                <text
                  x={seg.labelPt.x + (seg.midAngle > 180 ? -4 : 4)}
                  y={seg.labelPt.y + 4}
                  textAnchor={seg.midAngle > 180 ? 'end' : 'start'}
                  fontSize="10"
                  fill="#374151"
                >
                  {seg.label.length > 14 ? seg.label.slice(0, 13) + '...' : seg.label}
                </text>
              </g>
            ))}
        </svg>

        {/* Hover tooltip */}
        {hoveredIdx !== null && segments[hoveredIdx] && (
          <div
            className="absolute z-20 bg-gray-900 dark:bg-gray-700 text-white rounded-lg px-3 py-2 text-xs shadow-lg pointer-events-none"
            style={{
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
            }}
          >
            <div className="font-semibold">{segments[hoveredIdx].label}</div>
            <div>
              {formatValue(segments[hoveredIdx].value)} ({segments[hoveredIdx].pct}%)
            </div>
          </div>
        )}
      </div>

      {/* Legend (for > 8 segments or always as a fallback) */}
      {segments.length > 8 && (
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-3">
          {segments.map((seg, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
              <span className="w-2.5 h-2.5 rounded-sm inline-block flex-shrink-0" style={{ backgroundColor: seg.color }} />
              <span>{seg.label}</span>
              <span className="text-gray-400 dark:text-gray-500">({seg.pct}%)</span>
            </div>
          ))}
        </div>
      )}

      {/* Always show a compact legend below */}
      {segments.length <= 8 && (
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2">
          {segments.map((seg, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer"
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              <span className="w-2.5 h-2.5 rounded-sm inline-block flex-shrink-0" style={{ backgroundColor: seg.color }} />
              <span>{seg.label}</span>
              <span className="text-gray-400">{seg.pct}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
