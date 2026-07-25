import { useMemo, useState } from 'react';

interface HistogramBin {
  min: number;
  max: number;
  count: number;
  cumulativePercent: number;
}

interface MonteCarloHistogramProps {
  histogram: HistogramBin[];
  p50: number;
  p80: number;
  p90: number;
}

export function MonteCarloHistogram({ histogram, p50, p80, p90 }: MonteCarloHistogramProps) {
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    bin: HistogramBin;
  } | null>(null);

  const svgHeight = 320;

  const {
    svgWidth,
    padding,
    plotWidth,
    plotHeight,
    bars,
    xLabels,
    yLabels,
    yRightLabels,
    sCurvePoints,
    pLines,
  } = useMemo(() => {
    const svgW = 740;
    const pad = { top: 24, right: 55, bottom: 48, left: 55 };
    const pW = svgW - pad.left - pad.right;
    const pH = svgHeight - pad.top - pad.bottom;

    if (histogram.length === 0) {
      return {
        svgWidth: svgW,
        padding: pad,
        plotWidth: pW,
        plotHeight: pH,
        bars: [],
        xLabels: [],
        yLabels: [],
        yRightLabels: [],
        sCurvePoints: '',
        pLines: [],
        maxCount: 0,
      };
    }

    const maxC = Math.max(...histogram.map((b) => b.count), 1);
    const yMax = maxC * 1.15;
    const barGap = 2;
    const barWidth = (pW - barGap * histogram.length) / histogram.length;

    const barsData = histogram.map((bin, i) => {
      const x = pad.left + i * (barWidth + barGap);
      const barH = (bin.count / yMax) * pH;
      const y = pad.top + pH - barH;
      return { x, y, width: barWidth, height: barH, bin };
    });

    // X-axis labels - show every Nth label to avoid clutter
    const labelStep = Math.max(1, Math.ceil(histogram.length / 10));
    const xL: { x: number; label: string }[] = [];
    for (let i = 0; i < histogram.length; i += labelStep) {
      xL.push({
        x: barsData[i].x + barWidth / 2,
        label: `${Math.round(histogram[i].min)}`,
      });
    }
    // Always include the last bin's max
    const lastBar = barsData[barsData.length - 1];
    xL.push({
      x: lastBar.x + barWidth,
      label: `${Math.round(histogram[histogram.length - 1].max)}`,
    });

    // Y-axis labels (left - count)
    const yTickCount = 5;
    const yL: { y: number; label: string }[] = [];
    for (let i = 0; i <= yTickCount; i++) {
      const val = (yMax / yTickCount) * i;
      yL.push({
        y: pad.top + pH - (val / yMax) * pH,
        label: `${Math.round(val)}`,
      });
    }

    // Y-axis labels (right - cumulative %)
    const yRL: { y: number; label: string }[] = [];
    for (let i = 0; i <= 5; i++) {
      const pct = i * 20;
      yRL.push({
        y: pad.top + pH - (pct / 100) * pH,
        label: `${pct}%`,
      });
    }

    // S-curve (cumulative) as polyline
    const sCurve = barsData
      .map((bar, i) => {
        const cx = bar.x + barWidth / 2;
        const cy = pad.top + pH - (histogram[i].cumulativePercent / 100) * pH;
        return `${cx},${cy}`;
      })
      .join(' ');

    // Percentile vertical lines
    const globalMin = histogram[0].min;
    const globalMax = histogram[histogram.length - 1].max;
    const range = globalMax - globalMin;

    function durationToX(duration: number): number {
      if (range === 0) return pad.left;
      const ratio = (duration - globalMin) / range;
      return pad.left + ratio * pW;
    }

    const pL = [
      { value: p50, label: 'P50', color: '#3b82f6', x: durationToX(p50) },
      { value: p80, label: 'P80', color: '#f59e0b', x: durationToX(p80) },
      { value: p90, label: 'P90', color: '#ef4444', x: durationToX(p90) },
    ];

    return {
      svgWidth: svgW,
      padding: pad,
      plotWidth: pW,
      plotHeight: pH,
      bars: barsData,
      xLabels: xL,
      yLabels: yL,
      yRightLabels: yRL,
      sCurvePoints: sCurve,
      pLines: pL,
      maxCount: maxC,
    };
  }, [histogram, p50, p80, p90]);

  if (histogram.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-gray-400 dark:text-gray-500">
        No histogram data available.
      </div>
    );
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="w-full"
        style={{ maxHeight: svgHeight }}
        onMouseLeave={() => setTooltip(null)}
      >
        {/* Grid lines */}
        {yLabels.map((yl, i) => (
          <line
            key={`grid-${i}`}
            x1={padding.left}
            y1={yl.y}
            x2={padding.left + plotWidth}
            y2={yl.y}
            stroke="#e5e7eb"
            strokeWidth="1"
          />
        ))}

        {/* Y-axis labels (left - count) */}
        {yLabels.map((yl, i) => (
          <text
            key={`yl-${i}`}
            x={padding.left - 8}
            y={yl.y + 4}
            textAnchor="end"
            fontSize="10"
            fill="#9ca3af"
          >
            {yl.label}
          </text>
        ))}

        {/* Y-axis label title (left) */}
        <text
          x={14}
          y={padding.top + plotHeight / 2}
          textAnchor="middle"
          fontSize="10"
          fill="#6b7280"
          transform={`rotate(-90, 14, ${padding.top + plotHeight / 2})`}
        >
          Frequency
        </text>

        {/* Y-axis labels (right - cumulative %) */}
        {yRightLabels.map((yr, i) => (
          <text
            key={`yr-${i}`}
            x={padding.left + plotWidth + 8}
            y={yr.y + 4}
            textAnchor="start"
            fontSize="10"
            fill="#9ca3af"
          >
            {yr.label}
          </text>
        ))}

        {/* Y-axis label title (right) */}
        <text
          x={svgWidth - 8}
          y={padding.top + plotHeight / 2}
          textAnchor="middle"
          fontSize="10"
          fill="#6b7280"
          transform={`rotate(90, ${svgWidth - 8}, ${padding.top + plotHeight / 2})`}
        >
          Cumulative %
        </text>

        {/* X-axis labels */}
        {xLabels.map((xl, i) => (
          <text
            key={`xl-${i}`}
            x={xl.x}
            y={svgHeight - 8}
            textAnchor="middle"
            fontSize="10"
            fill="#9ca3af"
          >
            {xl.label}
          </text>
        ))}

        {/* X-axis title */}
        <text
          x={padding.left + plotWidth / 2}
          y={svgHeight - 0}
          textAnchor="middle"
          fontSize="10"
          fill="#6b7280"
        >
          Duration (days)
        </text>

        {/* Histogram bars */}
        {bars.map((bar, i) => (
          <rect
            key={`bar-${i}`}
            x={bar.x}
            y={bar.y}
            width={bar.width}
            height={bar.height}
            fill="#818cf8"
            opacity={tooltip?.bin === bar.bin ? 1 : 0.75}
            rx="1"
            className="transition-opacity duration-150"
            onMouseEnter={() =>
              setTooltip({ x: bar.x + bar.width / 2, y: bar.y, bin: bar.bin })
            }
          />
        ))}

        {/* S-curve overlay */}
        <polyline
          points={sCurvePoints}
          fill="none"
          stroke="#f97316"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* S-curve dots */}
        {bars.map((bar, i) => {
          const cx = bar.x + bar.width / 2;
          const cy =
            padding.top +
            plotHeight -
            (histogram[i].cumulativePercent / 100) * plotHeight;
          return (
            <circle
              key={`dot-${i}`}
              cx={cx}
              cy={cy}
              r="2.5"
              fill="#f97316"
              stroke="#fff"
              strokeWidth="1"
            />
          );
        })}

        {/* Percentile lines */}
        {pLines.map((pl) => (
          <g key={pl.label}>
            <line
              x1={pl.x}
              y1={padding.top}
              x2={pl.x}
              y2={padding.top + plotHeight}
              stroke={pl.color}
              strokeWidth="2"
              strokeDasharray="6,4"
            />
            {/* Label background */}
            <rect
              x={pl.x - 22}
              y={padding.top - 18}
              width={44}
              height={16}
              rx="4"
              fill={pl.color}
            />
            <text
              x={pl.x}
              y={padding.top - 7}
              textAnchor="middle"
              fontSize="9"
              fontWeight="bold"
              fill="#ffffff"
            >
              {pl.label}: {Math.round(pl.value)}d
            </text>
          </g>
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
            opacity="0.6"
          />
        )}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute z-20 bg-gray-900 dark:bg-gray-700 text-white rounded-lg px-3 py-2 text-xs shadow-lg pointer-events-none"
          style={{
            left: `${(tooltip.x / svgWidth) * 100}%`,
            top: '28px',
            transform: 'translateX(-50%)',
          }}
        >
          <div className="font-semibold mb-1">
            {Math.round(tooltip.bin.min)} - {Math.round(tooltip.bin.max)} days
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-sm bg-primary-400 inline-block" />
            <span>Count: {tooltip.bin.count}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-sm bg-orange-400 inline-block" />
            <span>Cumulative: {tooltip.bin.cumulativePercent.toFixed(1)}%</span>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-5 justify-center mt-2">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-primary-400 opacity-75" />
          <span className="text-xs text-gray-500 dark:text-gray-400">Frequency</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-0.5 bg-orange-500 rounded" />
          <span className="text-xs text-gray-500 dark:text-gray-400">Cumulative %</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="14" height="4">
            <line x1="0" y1="2" x2="14" y2="2" stroke="#3b82f6" strokeWidth="2" strokeDasharray="3,2" />
          </svg>
          <span className="text-xs text-gray-500 dark:text-gray-400">P50</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="14" height="4">
            <line x1="0" y1="2" x2="14" y2="2" stroke="#f59e0b" strokeWidth="2" strokeDasharray="3,2" />
          </svg>
          <span className="text-xs text-gray-500 dark:text-gray-400">P80</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="14" height="4">
            <line x1="0" y1="2" x2="14" y2="2" stroke="#ef4444" strokeWidth="2" strokeDasharray="3,2" />
          </svg>
          <span className="text-xs text-gray-500 dark:text-gray-400">P90</span>
        </div>
      </div>
    </div>
  );
}
