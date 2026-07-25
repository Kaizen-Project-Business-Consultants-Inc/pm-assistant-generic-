import { useMemo, useState } from 'react';

interface SCurveDataPoint {
  date: string;
  pv: number;
  ev: number;
  ac: number;
}

interface SCurveChartProps {
  data: SCurveDataPoint[];
  height?: number;
}

function formatDollar(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function formatShortDate(s: string): string {
  try {
    return new Date(s).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  } catch {
    return s;
  }
}

export function SCurveChart({ data, height = 300 }: SCurveChartProps) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; point: SCurveDataPoint } | null>(null);

  const { points, svgWidth, padding, plotWidth, plotHeight, xLabels, yLabels } = useMemo(() => {
    if (data.length === 0) return { points: [], svgWidth: 600, padding: { top: 20, right: 30, bottom: 40, left: 65 }, plotWidth: 505, plotHeight: 240, xLabels: [], yLabels: [] };

    const svgW = 700;
    const pad = { top: 20, right: 30, bottom: 40, left: 65 };
    const pW = svgW - pad.left - pad.right;
    const pH = height - pad.top - pad.bottom;

    const allValues = data.flatMap((d) => [d.pv, d.ev, d.ac]);
    const yM = Math.max(...allValues, 1) * 1.1;

    const pts = data.map((d, i) => ({
      x: pad.left + (i / Math.max(data.length - 1, 1)) * pW,
      yPV: pad.top + pH - (d.pv / yM) * pH,
      yEV: pad.top + pH - (d.ev / yM) * pH,
      yAC: pad.top + pH - (d.ac / yM) * pH,
      data: d,
    }));

    // X axis labels (every 4th)
    const xL: { x: number; label: string }[] = [];
    const step = Math.max(1, Math.floor(data.length / 8));
    for (let i = 0; i < data.length; i += step) {
      xL.push({ x: pts[i].x, label: formatShortDate(data[i].date) });
    }

    // Y axis labels (5 ticks)
    const yL: { y: number; label: string }[] = [];
    for (let i = 0; i <= 4; i++) {
      const val = (yM / 4) * i;
      yL.push({ y: pad.top + pH - (val / yM) * pH, label: formatDollar(val) });
    }

    return { points: pts, svgWidth: svgW, padding: pad, plotWidth: pW, plotHeight: pH, xLabels: xL, yLabels: yL };
  }, [data, height]);

  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-gray-400 dark:text-gray-500">
        No S-Curve data available.
      </div>
    );
  }

  function polyline(yKey: 'yPV' | 'yEV' | 'yAC'): string {
    return points.map((p) => `${p.x},${p[yKey]}`).join(' ');
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${svgWidth} ${height}`}
        className="w-full"
        style={{ maxHeight: height }}
        onMouseLeave={() => setTooltip(null)}
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

        {/* X axis labels */}
        {xLabels.map((xl, i) => (
          <text key={i} x={xl.x} y={height - 8} textAnchor="middle" fontSize="10" fill="#9ca3af">
            {xl.label}
          </text>
        ))}

        {/* PV line (dashed gray) */}
        <polyline
          points={polyline('yPV')}
          fill="none"
          stroke="#9ca3af"
          strokeWidth="2"
          strokeDasharray="6,3"
        />

        {/* EV line (solid blue) */}
        <polyline
          points={polyline('yEV')}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="2.5"
        />

        {/* AC line (solid red) */}
        <polyline
          points={polyline('yAC')}
          fill="none"
          stroke="#ef4444"
          strokeWidth="2"
        />

        {/* Invisible hover areas */}
        {points.map((p, i) => (
          <rect
            key={i}
            x={p.x - (plotWidth / points.length) / 2}
            y={padding.top}
            width={plotWidth / points.length}
            height={plotHeight}
            fill="transparent"
            onMouseEnter={(e) => {
              const svgRect = (e.target as SVGElement).closest('svg')?.getBoundingClientRect();
              if (!svgRect) return;
              setTooltip({ x: p.x, y: Math.min(p.yPV, p.yEV, p.yAC), point: p.data });
            }}
          />
        ))}

        {/* Hover indicator line */}
        {tooltip && (
          <line
            x1={tooltip.x}
            y1={padding.top}
            x2={tooltip.x}
            y2={padding.top + plotHeight}
            stroke="#6366f1"
            strokeWidth="1"
            strokeDasharray="3,3"
            opacity="0.5"
          />
        )}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute z-20 bg-gray-900 dark:bg-gray-700 text-white rounded-lg px-3 py-2 text-xs shadow-lg pointer-events-none"
          style={{
            left: `${(tooltip.x / svgWidth) * 100}%`,
            top: '10px',
            transform: 'translateX(-50%)',
          }}
        >
          <div className="font-semibold mb-1">{tooltip.point.date}</div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-0.5 bg-gray-400 inline-block" style={{ borderTop: '2px dashed #9ca3af' }} />
            <span>PV: {formatDollar(tooltip.point.pv)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-0.5 bg-blue-500 inline-block" />
            <span>EV: {formatDollar(tooltip.point.ev)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-0.5 bg-red-500 inline-block" />
            <span>AC: {formatDollar(tooltip.point.ac)}</span>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-5 justify-center mt-2">
        <div className="flex items-center gap-1.5">
          <svg width="20" height="4">
            <line x1="0" y1="2" x2="20" y2="2" stroke="#9ca3af" strokeWidth="2" strokeDasharray="4,2" />
          </svg>
          <span className="text-xs text-gray-500 dark:text-gray-400">Planned Value (PV)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-0.5 bg-blue-500 rounded" />
          <span className="text-xs text-gray-500 dark:text-gray-400">Earned Value (EV)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-0.5 bg-red-500 rounded" />
          <span className="text-xs text-gray-500 dark:text-gray-400">Actual Cost (AC)</span>
        </div>
      </div>
    </div>
  );
}
