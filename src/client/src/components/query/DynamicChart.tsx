import { BarChart } from './BarChart';
import { LineChart } from './LineChart';
import { PieChart } from './PieChart';

interface ChartDatum {
  label: string;
  value: number;
  color?: string;
  group?: string;
}

interface ChartSpec {
  type: 'bar' | 'line' | 'pie' | 'horizontal_bar';
  title: string;
  data: ChartDatum[];
  xAxisLabel?: string;
  yAxisLabel?: string;
}

interface DynamicChartProps {
  chart: ChartSpec;
}

export function DynamicChart({ chart }: DynamicChartProps) {
  const { type, title, data, xAxisLabel, yAxisLabel } = chart;

  if (!data || data.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">{title}</h3>
        <p className="text-sm text-gray-500 dark:text-gray-500 text-center py-6">No data to display.</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-4">{title}</h3>

      {type === 'bar' && (
        <BarChart data={data} xAxisLabel={xAxisLabel} yAxisLabel={yAxisLabel} />
      )}

      {type === 'horizontal_bar' && (
        <BarChart data={data} xAxisLabel={xAxisLabel} yAxisLabel={yAxisLabel} horizontal />
      )}

      {type === 'line' && (
        <LineChart data={data} xAxisLabel={xAxisLabel} yAxisLabel={yAxisLabel} />
      )}

      {type === 'pie' && (
        <PieChart data={data} />
      )}
    </div>
  );
}
