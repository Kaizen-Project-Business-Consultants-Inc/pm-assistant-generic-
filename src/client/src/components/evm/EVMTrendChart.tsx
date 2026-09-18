import { useMemo, useState } from 'react';
import { formatCalendarDate } from '../../utils/dateUtils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface HistoricalPoint {
  date: string;
  cpi: number;
  spi: number;
}

interface PredictionPoint {
  week: number;
  value: number;
}

interface EVMTrendChartProps {
  historicalData: HistoricalPoint[];
  predictions?: PredictionPoint[];
  height?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatShortDate(s: string): string {
  try {
    return formatCalendarDate(s, { month: 'short', day: 'numeric' }, 'en-US');
  } catch {
    return s;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function EVMTrendChart({ historicalData, predictions, height = 300 }: EVMTrendChartProps) {
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    date: string;
    cpi: number;
    spi: number;
  } | null>(null);

  const {
    points,
    predPoints,
    svgWidth,
    padding,
    plotWidth,
    plotHeight,
    xLabels,
    yLabels,
    thresholdY,
  } = useMemo(() => {
    const svgW = 700;
    const pad = { top: 20, right: 30, bottom: 40, left: 50 };
    const pW = svgW - pad.left - pad.right;
    const pH = height - pad.top - pad.bottom;

    if (historicalData.length === 0) {
      return {
        points: [],
        predPoints: [],
        svgWidth: svgW,
        padding: pad,
        plotWidth: pW,
        plotHeight: pH,
        xLabels: [],
        yLabels: [],
        thresholdY: 0,
        yMin: 0,
        yMax: 2,
      };
    }

    // Determine Y range -- default 0..2
    const allVals = historicalData.flatMap((d) => [d.cpi, d.spi]);
    if (predictions) {
      allVals.push(...predictions.map((p) => p.value));
    }
    const rawMin = Math.min(...allVals, 1);
    const rawMax = Math.max(...allVals, 1);
    const yMn = Math.max(0, Math.floor((rawMin - 0.2) * 10) / 10);
    const yMx = Math.ceil((rawMax + 0.2) * 10) / 10;

    const totalCount = historicalData.length + (predictions ? predictions.length : 0);

    // Map historical data
    const pts = historicalData.map((d, i) => {
      const xFrac = i / Math.max(totalCount - 1, 1);
      return {
        x: pad.left + xFrac * pW,
        yCPI: pad.top + pH - ((d.cpi - yMn) / (yMx - yMn)) * pH,
        ySPI: pad.top + pH - ((d.spi - yMn) / (yMx - yMn)) * pH,
        data: d,
      };
    });

    // Map prediction data (appended after historical)
    const pPts: { x: number; y: number; week: number; value: number }[] = [];
    if (predictions && predictions.length > 0) {
      predictions.forEach((p, i) => {
        const idx = historicalData.length + i;
        const xFrac = idx / Math.max(totalCount - 1, 1);
        pPts.push({
          x: pad.left + xFrac * pW,
          y: pad.top + pH - ((p.value - yMn) / (yMx - yMn)) * pH,
          week: p.week,
          value: p.value,
        });
      });
    }

    // Threshold at 1.0
    const thY = pad.top + pH - ((1.0 - yMn) / (yMx - yMn)) * pH;

    // X labels (pick ~6)
    const xL: { x: number; label: string }[] = [];
    const step = Math.max(1, Math.floor(historicalData.length / 6));
    for (let i = 0; i < historicalData.length; i += step) {
      xL.push({ x: pts[i].x, label: formatShortDate(historicalData[i].date) });
    }
    // Always include last if not already there
    if (historicalData.length > 1) {
      const lastX = pts[pts.length - 1].x;
      if (!xL.some((l) => Math.abs(l.x - lastX) < 10)) {
        xL.push({ x: lastX, label: formatShortDate(historicalData[historicalData.length - 1].date) });
      }
    }

    // Y labels (5 ticks)
    const yL: { y: number; label: string }[] = [];
    for (let i = 0; i <= 4; i++) {
      const val = yMn + ((yMx - yMn) / 4) * i;
      yL.push({
        y: pad.top + pH - ((val - yMn) / (yMx - yMn)) * pH,
        label: val.toFixed(2),
      });
    }

    return {
      points: pts,
      predPoints: pPts,
      svgWidth: svgW,
      padding: pad,
      plotWidth: pW,
      plotHeight: pH,
      xLabels: xL,
      yLabels: yL,
      thresholdY: thY,
      yMin: yMn,
      yMax: yMx,
    };
  }, [historicalData, predictions, height]);

  if (historicalData.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-500">
        No CPI/SPI trend data available.
      </div>
    );
  }

  // Build polyline strings
  const cpiLine = points.map((p) => `${p.x},${p.yCPI}`).join(' ');
  const spiLine = points.map((p) => `${p.x},${p.ySPI}`).join(' ');

  // Dashed prediction line (connects from last historical CPI point)
  let predLine = '';
  if (predPoints.length > 0) {
    const lastPt = points[points.length - 1];
    predLine = [`${lastPt.x},${lastPt.yCPI}`, ...predPoints.map((p) => `${p.x},${p.y}`)].join(' ');
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
            className="stroke-gray-200 dark:stroke-gray-600"
            strokeWidth="1"
          />
        ))}

        {/* Y axis labels */}
        {yLabels.map((yl, i) => (
          <text key={i} x={padding.left - 8} y={yl.y + 4} textAnchor="end" fontSize="10" className="fill-gray-400 dark:fill-gray-500">
            {yl.label}
          </text>
        ))}

        {/* X axis labels */}
        {xLabels.map((xl, i) => (
          <text key={i} x={xl.x} y={height - 8} textAnchor="middle" fontSize="10" className="fill-gray-400 dark:fill-gray-500">
            {xl.label}
          </text>
        ))}

        {/* Threshold line at 1.0 */}
        <line
          x1={padding.left}
          y1={thresholdY}
          x2={padding.left + plotWidth}
          y2={thresholdY}
          stroke="#9ca3af"
          strokeWidth="1"
          strokeDasharray="6,4"
        />
        <text
          x={padding.left + plotWidth + 4}
          y={thresholdY + 4}
          fontSize="9"
          className="fill-gray-400 dark:fill-gray-500"
        >
          1.0
        </text>

        {/* CPI line (blue, solid) */}
        <polyline points={cpiLine} fill="none" stroke="#3b82f6" strokeWidth="2.5" />

        {/* SPI line (green, solid) */}
        <polyline points={spiLine} fill="none" stroke="#22c55e" strokeWidth="2.5" />

        {/* AI prediction dashed extension */}
        {predLine && (
          <polyline
            points={predLine}
            fill="none"
            stroke="#8b5cf6"
            strokeWidth="2"
            strokeDasharray="6,4"
          />
        )}

        {/* Data point dots - CPI */}
        {points.map((p, i) => (
          <circle key={`cpi-${i}`} cx={p.x} cy={p.yCPI} r="3" fill="#3b82f6" />
        ))}

        {/* Data point dots - SPI */}
        {points.map((p, i) => (
          <circle key={`spi-${i}`} cx={p.x} cy={p.ySPI} r="3" fill="#22c55e" />
        ))}

        {/* Prediction dots */}
        {predPoints.map((p, i) => (
          <circle key={`pred-${i}`} cx={p.x} cy={p.y} r="3" fill="#8b5cf6" fillOpacity="0.7" />
        ))}

        {/* Invisible hover areas */}
        {points.map((p, i) => (
          <rect
            key={i}
            x={p.x - plotWidth / points.length / 2}
            y={padding.top}
            width={plotWidth / points.length}
            height={plotHeight}
            fill="transparent"
            onMouseEnter={() => {
              setTooltip({
                x: p.x,
                y: Math.min(p.yCPI, p.ySPI),
                date: p.data.date,
                cpi: p.data.cpi,
                spi: p.data.spi,
              });
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
          <div className="font-semibold mb-1">{formatShortDate(tooltip.date)}</div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-0.5 bg-blue-500 inline-block" />
            <span>CPI: {tooltip.cpi.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-0.5 bg-green-500 inline-block" />
            <span>SPI: {tooltip.spi.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-5 justify-center mt-2">
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-0.5 bg-blue-500 rounded" />
          <span className="text-xs text-gray-500 dark:text-gray-400">CPI</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-0.5 bg-green-500 rounded" />
          <span className="text-xs text-gray-500 dark:text-gray-400">SPI</span>
        </div>
        {predPoints.length > 0 && (
          <div className="flex items-center gap-1.5">
            <svg width="20" height="4">
              <line x1="0" y1="2" x2="20" y2="2" stroke="#8b5cf6" strokeWidth="2" strokeDasharray="4,2" />
            </svg>
            <span className="text-xs text-gray-500 dark:text-gray-400">AI Prediction</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <svg width="20" height="4">
            <line x1="0" y1="2" x2="20" y2="2" stroke="#9ca3af" strokeWidth="1" strokeDasharray="4,2" />
          </svg>
          <span className="text-xs text-gray-500 dark:text-gray-400">Threshold (1.0)</span>
        </div>
      </div>
    </div>
  );
}
