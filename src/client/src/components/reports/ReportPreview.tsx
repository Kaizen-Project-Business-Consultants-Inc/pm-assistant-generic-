import React, { useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  ArrowLeft,
  Download,
  Printer,
  FileBarChart,
  BarChart3,
  LineChart,
  PieChart,
  Table2,
  Activity,
} from 'lucide-react';
import { apiService } from '../../services/api';

interface ReportPreviewProps {
  templateId: string;
  onClose: () => void;
}

interface KpiItem {
  label: string;
  value: string | number;
  color?: string;
}

interface TableData {
  headers: string[];
  rows: (string | number)[][];
}

interface ChartDataPoint {
  label: string;
  value: number;
  color?: string;
}

interface ReportSectionData {
  title: string;
  type: 'kpi_card' | 'table' | 'bar_chart' | 'line_chart' | 'pie_chart';
  data: {
    kpis?: KpiItem[];
    table?: TableData;
    chartData?: ChartDataPoint[];
  };
}

interface GeneratedReport {
  name: string;
  generatedAt: string;
  sections: ReportSectionData[];
}

const KPI_COLORS = [
  { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700' },
  { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700' },
  { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700' },
  { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700' },
  { bg: 'bg-pink-50', border: 'border-pink-200', text: 'text-pink-700' },
  { bg: 'bg-primary-50 dark:bg-primary-900/30', border: 'border-primary-200', text: 'text-primary-700 dark:text-primary-300' },
];

const CHART_COLORS = [
  '#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#64748b',
];

function KpiCards({ kpis }: { kpis: KpiItem[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {kpis.map((kpi, i) => {
        const colorSet = KPI_COLORS[i % KPI_COLORS.length];
        return (
          <div
            key={i}
            className={`${colorSet.bg} ${colorSet.border} border rounded-xl p-4 text-center`}
          >
            <p className="text-xs uppercase text-gray-500 dark:text-gray-400 tracking-wider font-medium mb-1">
              {kpi.label}
            </p>
            <p className={`text-2xl font-bold ${colorSet.text}`}>
              {kpi.value}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function DataTable({ table }: { table: TableData }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {table.headers.map((header, i) => (
              <th
                key={i}
                className="text-left px-4 py-2 bg-gray-50 dark:bg-gray-900 text-xs uppercase font-semibold text-gray-500 dark:text-gray-400 tracking-wider border-b-2 border-gray-200 dark:border-gray-700"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 1 ? 'bg-gray-50 dark:bg-gray-900/50' : ''}>
              {row.map((cell, ci) => (
                <td key={ci} className="px-4 py-2 text-gray-700 dark:text-gray-200 border-b border-gray-100">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BarChartSvg({ data }: { data: ChartDataPoint[] }) {
  if (!data.length) return null;
  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const chartHeight = 200;
  const barWidth = Math.min(50, Math.max(20, 400 / data.length));
  const chartWidth = data.length * (barWidth + 12) + 40;
  const yPadding = 20;

  return (
    <svg viewBox={`0 0 ${chartWidth} ${chartHeight + 40}`} className="w-full max-w-2xl" preserveAspectRatio="xMidYMid meet">
      {/* Y axis line */}
      <line x1="30" y1={yPadding} x2="30" y2={chartHeight + yPadding} stroke="#e5e7eb" strokeWidth="1" />
      {/* Bars */}
      {data.map((d, i) => {
        const barHeight = (d.value / maxValue) * chartHeight;
        const x = 40 + i * (barWidth + 12);
        const y = yPadding + chartHeight - barHeight;
        const color = d.color || CHART_COLORS[i % CHART_COLORS.length];
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              fill={color}
              rx="3"
              ry="3"
            />
            <text
              x={x + barWidth / 2}
              y={y - 4}
              textAnchor="middle"
              className="fill-gray-600"
              fontSize="9"
              fontWeight="600"
            >
              {d.value}
            </text>
            <text
              x={x + barWidth / 2}
              y={chartHeight + yPadding + 14}
              textAnchor="middle"
              className="fill-gray-500"
              fontSize="9"
            >
              {d.label.length > 8 ? d.label.slice(0, 8) + '..' : d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function LineChartSvg({ data }: { data: ChartDataPoint[] }) {
  if (!data.length) return null;
  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const chartWidth = 500;
  const chartHeight = 200;
  const padding = { top: 20, right: 20, bottom: 30, left: 40 };
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;

  const points = data.map((d, i) => ({
    x: padding.left + (i / Math.max(data.length - 1, 1)) * plotWidth,
    y: padding.top + plotHeight - (d.value / maxValue) * plotHeight,
    ...d,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = linePath + ` L ${points[points.length - 1].x} ${padding.top + plotHeight} L ${points[0].x} ${padding.top + plotHeight} Z`;

  return (
    <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full max-w-2xl" preserveAspectRatio="xMidYMid meet">
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
        const y = padding.top + plotHeight * (1 - frac);
        return (
          <g key={frac}>
            <line x1={padding.left} y1={y} x2={chartWidth - padding.right} y2={y} stroke="#f3f4f6" strokeWidth="1" />
            <text x={padding.left - 5} y={y + 3} textAnchor="end" className="fill-gray-400" fontSize="8">
              {Math.round(maxValue * frac)}
            </text>
          </g>
        );
      })}
      {/* Area */}
      <path d={areaPath} fill="url(#lineGradient)" opacity="0.2" />
      <defs>
        <linearGradient id="lineGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Line */}
      <path d={linePath} fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Dots & labels */}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="3.5" fill="#6366f1" stroke="white" strokeWidth="2" />
          <text
            x={p.x}
            y={padding.top + plotHeight + 16}
            textAnchor="middle"
            className="fill-gray-500"
            fontSize="8"
          >
            {p.label.length > 8 ? p.label.slice(0, 8) + '..' : p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function PieChartSvg({ data }: { data: ChartDataPoint[] }) {
  if (!data.length) return null;
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) return null;

  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 70;
  let cumulativePercent = 0;

  const getCoordinatesForPercent = (percent: number) => {
    const x = cx + radius * Math.cos(2 * Math.PI * percent - Math.PI / 2);
    const y = cy + radius * Math.sin(2 * Math.PI * percent - Math.PI / 2);
    return { x, y };
  };

  const slices = data.map((d, i) => {
    const percent = d.value / total;
    const startPercent = cumulativePercent;
    cumulativePercent += percent;
    const startCoord = getCoordinatesForPercent(startPercent);
    const endCoord = getCoordinatesForPercent(cumulativePercent);
    const largeArcFlag = percent > 0.5 ? 1 : 0;
    const pathD = [
      `M ${cx} ${cy}`,
      `L ${startCoord.x} ${startCoord.y}`,
      `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endCoord.x} ${endCoord.y}`,
      'Z',
    ].join(' ');

    return {
      pathD,
      color: d.color || CHART_COLORS[i % CHART_COLORS.length],
      label: d.label,
      value: d.value,
      percent,
    };
  });

  return (
    <div className="flex flex-col md:flex-row items-center gap-6">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-48 h-48 flex-shrink-0">
        {slices.map((slice, i) => (
          <path
            key={i}
            d={slice.pathD}
            fill={slice.color}
            stroke="white"
            strokeWidth="2"
          />
        ))}
      </svg>
      <div className="flex flex-col gap-1.5">
        {slices.map((slice, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: slice.color }} />
            <span className="text-gray-700 dark:text-gray-200">{slice.label}</span>
            <span className="text-gray-400 dark:text-gray-500 ml-auto pl-3">
              {slice.value} ({Math.round(slice.percent * 100)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionRenderer({ section }: { section: ReportSectionData }) {
  const iconMap: Record<string, React.ReactNode> = {
    kpi_card: <Activity className="w-4 h-4 text-emerald-600" />,
    table: <Table2 className="w-4 h-4 text-blue-600" />,
    bar_chart: <BarChart3 className="w-4 h-4 text-orange-600" />,
    line_chart: <LineChart className="w-4 h-4 text-purple-600" />,
    pie_chart: <PieChart className="w-4 h-4 text-pink-600" />,
  };

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 print:break-inside-avoid print:shadow-none">
      <div className="flex items-center gap-2 mb-4">
        {iconMap[section.type]}
        <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{section.title}</h3>
      </div>

      {section.type === 'kpi_card' && section.data.kpis && (
        <KpiCards kpis={section.data.kpis} />
      )}

      {section.type === 'table' && section.data.table && (
        <DataTable table={section.data.table} />
      )}

      {section.type === 'bar_chart' && section.data.chartData && (
        <BarChartSvg data={section.data.chartData} />
      )}

      {section.type === 'line_chart' && section.data.chartData && (
        <LineChartSvg data={section.data.chartData} />
      )}

      {section.type === 'pie_chart' && section.data.chartData && (
        <PieChartSvg data={section.data.chartData} />
      )}

      {/* Fallback if data is missing */}
      {!section.data.kpis && !section.data.table && !section.data.chartData && (
        <p className="text-sm text-gray-400 dark:text-gray-500 italic">No data available for this section.</p>
      )}
    </div>
  );
}

function exportCSV(report: GeneratedReport) {
  const lines: string[] = [];
  lines.push(`Report: ${report.name}`);
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');

  for (const section of report.sections) {
    lines.push(`--- ${section.title} ---`);

    if (section.type === 'kpi_card' && section.data.kpis) {
      lines.push('Metric,Value');
      for (const kpi of section.data.kpis) {
        lines.push(`"${kpi.label}","${kpi.value}"`);
      }
    }

    if (section.type === 'table' && section.data.table) {
      lines.push(section.data.table.headers.map((h) => `"${h}"`).join(','));
      for (const row of section.data.table.rows) {
        lines.push(row.map((c) => `"${c}"`).join(','));
      }
    }

    if (section.data.chartData) {
      lines.push('Label,Value');
      for (const d of section.data.chartData) {
        lines.push(`"${d.label}",${d.value}`);
      }
    }

    lines.push('');
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${report.name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ReportPreview({ templateId, onClose }: ReportPreviewProps) {
  const generateMutation = useMutation({
    mutationFn: () => apiService.generateReportFromTemplate(templateId),
  });

  // Auto-generate on mount
  useEffect(() => {
    generateMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  const report: GeneratedReport | null = (generateMutation.data as any)?.report || generateMutation.data || null;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 print:hidden">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-lg bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center">
            <FileBarChart className="w-5 h-5 text-primary-600 dark:text-primary-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">
              {report ? report.name : 'Generating Report...'}
            </h1>
            {report && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Generated {new Date(report.generatedAt).toLocaleString()}
              </p>
            )}
          </div>
        </div>

        {report && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportCSV(report)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              Export PDF
            </button>
          </div>
        )}
      </div>

      {/* Print header (visible only in print) */}
      {report && (
        <div className="hidden print:block mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{report.name}</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">Generated {new Date(report.generatedAt).toLocaleString()}</p>
        </div>
      )}

      {/* Loading */}
      {generateMutation.isPending && (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin mb-4" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Generating report...</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">This may take a moment while data is aggregated.</p>
        </div>
      )}

      {/* Error */}
      {generateMutation.isError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
          <p className="text-sm text-red-700 mb-2">Failed to generate the report.</p>
          <button
            onClick={() => generateMutation.mutate()}
            className="text-xs font-medium text-red-600 underline hover:text-red-800"
          >
            Try again
          </button>
        </div>
      )}

      {/* Report Sections */}
      {report && report.sections && (
        <div className="space-y-6">
          {report.sections.map((section, i) => (
            <SectionRenderer key={i} section={section} />
          ))}

          {report.sections.length === 0 && (
            <div className="text-center py-12">
              <FileBarChart className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">This report has no sections configured.</p>
            </div>
          )}
        </div>
      )}

      {/* Print footer */}
      <div className="hidden print:block mt-8 pt-4 border-t border-gray-200 dark:border-gray-700 text-center">
        <p className="text-xs text-gray-400 dark:text-gray-500">Kovarti PM Assistant - Custom Report</p>
      </div>

      {/* Print-friendly styles */}
      <style>{`
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print\\:hidden { display: none !important; }
          .print\\:block { display: block !important; }
          .print\\:break-inside-avoid { break-inside: avoid; }
          .print\\:shadow-none { box-shadow: none !important; }
        }
      `}</style>
    </div>
  );
}
