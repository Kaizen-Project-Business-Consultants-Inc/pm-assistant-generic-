import { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ResourceDemand {
  date: string;
  hours: number;
}

interface ResourceEntry {
  resourceName: string;
  demand: ResourceDemand[];
}

interface OverAllocation {
  resourceName: string;
  date: string;
  demand: number;
  capacity: number;
}

interface ResourceHistogramProps {
  data: {
    resources: ResourceEntry[];
    overAllocations: OverAllocation[];
  } | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CAPACITY_HOURS = 8;

function formatDate(dateStr: string): string {
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
  return `${Math.round(h * 10) / 10}`;
}

/** Collect all unique dates across all resources, sorted ascending. */
function collectDates(resources: ResourceEntry[]): string[] {
  const dateSet = new Set<string>();
  for (const r of resources) {
    for (const d of r.demand) {
      dateSet.add(d.date);
    }
  }
  return Array.from(dateSet).sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime()
  );
}

/** Build a quick lookup: resourceName -> date -> hours */
function buildDemandMap(
  resources: ResourceEntry[]
): Map<string, Map<string, number>> {
  const map = new Map<string, Map<string, number>>();
  for (const r of resources) {
    const inner = new Map<string, number>();
    for (const d of r.demand) {
      inner.set(d.date, d.hours);
    }
    map.set(r.resourceName, inner);
  }
  return map;
}

/** Build a set for quick over-allocation lookup: "resourceName|date" */
function buildOverAllocSet(overAllocations: OverAllocation[]): Set<string> {
  const set = new Set<string>();
  for (const o of overAllocations) {
    set.add(`${o.resourceName}|${o.date}`);
  }
  return set;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ResourceHistogram({ data }: ResourceHistogramProps) {
  const [selectedResource, setSelectedResource] = useState<string>('__all__');
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const resourceNames = useMemo(() => {
    if (!data) return [];
    return data.resources.map((r) => r.resourceName);
  }, [data]);

  const chart = useMemo(() => {
    if (!data || data.resources.length === 0) return null;

    const allDates = collectDates(data.resources);
    if (allDates.length === 0) return null;

    const demandMap = buildDemandMap(data.resources);
    const overAllocSet = buildOverAllocSet(data.overAllocations);

    // Compute per-date demand values based on selection
    const isAll = selectedResource === '__all__';
    const dateBars = allDates.map((date) => {
      let totalHours = 0;
      let isOverAllocated = false;

      if (isAll) {
        // Sum all resources for this date
        for (const r of data.resources) {
          const h = demandMap.get(r.resourceName)?.get(date) ?? 0;
          totalHours += h;
          if (overAllocSet.has(`${r.resourceName}|${date}`)) {
            isOverAllocated = true;
          }
        }
        // For "all combined", capacity line = 8 * number of resources
      } else {
        totalHours = demandMap.get(selectedResource)?.get(date) ?? 0;
        isOverAllocated = overAllocSet.has(`${selectedResource}|${date}`);
      }

      return { date, hours: totalHours, isOverAllocated };
    });

    const capacityLine = isAll
      ? CAPACITY_HOURS * data.resources.length
      : CAPACITY_HOURS;

    // SVG dimensions
    const svgW = 800;
    const svgH = 300;
    const pad = { top: 24, right: 24, bottom: 44, left: 52 };
    const plotW = svgW - pad.left - pad.right;
    const plotH = svgH - pad.top - pad.bottom;

    const maxHours =
      Math.max(...dateBars.map((d) => d.hours), capacityLine, 1) * 1.15;

    // Bar geometry
    const barCount = dateBars.length;
    const groupWidth = plotW / barCount;
    const barWidth = Math.min(groupWidth * 0.65, 40);
    const barGap = (groupWidth - barWidth) / 2;

    // Y-axis ticks (5 ticks)
    const yTicks: { y: number; label: string }[] = [];
    for (let i = 0; i <= 4; i++) {
      const val = (maxHours / 4) * i;
      yTicks.push({
        y: pad.top + plotH - (val / maxHours) * plotH,
        label: formatHours(val) + 'h',
      });
    }

    // Compute label skip to avoid x-axis clutter
    const maxLabels = 20;
    const labelSkip = Math.max(1, Math.ceil(barCount / maxLabels));

    // Capacity line y-position
    const capY = pad.top + plotH - (capacityLine / maxHours) * plotH;

    // Bars
    const bars = dateBars.map((d, i) => {
      const x = pad.left + i * groupWidth + barGap;
      const barH = (d.hours / maxHours) * plotH;
      const baseline = pad.top + plotH;
      const barY = baseline - barH;
      const labelX = x + barWidth / 2;

      return {
        x,
        barY,
        barH,
        baseline,
        labelX,
        date: d.date,
        hours: d.hours,
        isOverAllocated: d.isOverAllocated,
        showLabel: i % labelSkip === 0,
      };
    });

    return {
      svgW,
      svgH,
      pad,
      plotW,
      plotH,
      barWidth,
      yTicks,
      capY,
      capacityLine,
      bars,
    };
  }, [data, selectedResource]);

  // -- Render --

  if (!data || data.resources.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 text-center text-sm text-gray-400 dark:text-gray-500">
        No resource histogram data available.
      </div>
    );
  }

  if (!chart) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 text-center text-sm text-gray-400 dark:text-gray-500">
        No demand data to display.
      </div>
    );
  }

  const { svgW, svgH, pad, plotW, plotH, barWidth, yTicks, capY, capacityLine, bars } =
    chart;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary-500" />
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            Resource Demand Histogram
          </h3>
        </div>

        {/* Resource filter dropdown */}
        <select
          value={selectedResource}
          onChange={(e) => {
            setSelectedResource(e.target.value);
            setHoveredIdx(null);
          }}
          className="rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 px-3 py-1.5 text-xs text-gray-700 focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-400"
        >
          <option value="__all__">All Resources (combined)</option>
          {resourceNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {/* Chart */}
      <div className="relative">
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="w-full"
          style={{ maxHeight: 300 }}
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

          {/* Y-axis labels */}
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

          {/* Capacity dashed line */}
          <line
            x1={pad.left}
            y1={capY}
            x2={pad.left + plotW}
            y2={capY}
            stroke="#9ca3af"
            strokeWidth="1.5"
            strokeDasharray="6,4"
          />
          <text
            x={pad.left + plotW + 4}
            y={capY + 4}
            fontSize="9"
            fill="#9ca3af"
          >
            {formatHours(capacityLine)}h
          </text>

          {/* Bars */}
          {bars.map((bar, i) => {
            const isHovered = hoveredIdx === i;
            const fillNormal = bar.isOverAllocated
              ? isHovered
                ? '#dc2626'
                : '#ef4444'
              : isHovered
              ? '#4338ca'
              : '#6366f1';

            return (
              <g key={i}>
                {bar.barH > 0 && (
                  <rect
                    x={bar.x}
                    y={bar.barY}
                    width={barWidth}
                    height={bar.barH}
                    rx={3}
                    fill={fillNormal}
                    opacity={isHovered ? 1 : 0.85}
                  />
                )}

                {/* X-axis labels */}
                {bar.showLabel && (
                  <text
                    x={bar.labelX}
                    y={svgH - 8}
                    textAnchor="middle"
                    fontSize="10"
                    fill="#9ca3af"
                  >
                    {formatDate(bar.date)}
                  </text>
                )}

                {/* Invisible hover area */}
                <rect
                  x={bar.x - 2}
                  y={pad.top}
                  width={barWidth + 4}
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
              {formatDate(bars[hoveredIdx].date)}
            </div>
            <div>Demand: {formatHours(bars[hoveredIdx].hours)}h</div>
            <div>Capacity: {formatHours(capacityLine)}h</div>
            {bars[hoveredIdx].isOverAllocated && (
              <div className="text-red-300 font-medium mt-0.5">
                Over-allocated
              </div>
            )}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-5 justify-center mt-3">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-primary-500" />
          <span className="text-xs text-gray-500 dark:text-gray-400">Normal demand</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-red-500" />
          <span className="text-xs text-gray-500 dark:text-gray-400">Over-allocated</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="16" height="4">
            <line
              x1="0"
              y1="2"
              x2="16"
              y2="2"
              stroke="#9ca3af"
              strokeWidth="1.5"
              strokeDasharray="3,2"
            />
          </svg>
          <span className="text-xs text-gray-500 dark:text-gray-400">Capacity line</span>
        </div>
      </div>
    </div>
  );
}
