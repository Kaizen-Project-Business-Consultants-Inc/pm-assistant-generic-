// WorkloadHeatmap component

interface WeeklyUtilization {
  weekStart: string;
  allocated: number;
  capacity: number;
  utilization: number;
  cost?: number;
}

interface ResourceWorkload {
  resourceId: string;
  resourceName: string;
  role: string;
  costRateHourly?: number | null;
  totalCost?: number;
  weeks: WeeklyUtilization[];
  averageUtilization: number;
  isOverAllocated: boolean;
}

interface Resource {
  id: string;
  name: string;
  role: string;
  email: string;
  capacityHoursPerWeek: number;
  skills: string[];
  isActive: boolean;
}

interface WorkloadHeatmapProps {
  workload: ResourceWorkload[];
  resources: Resource[];
}

function getHeatColor(utilization: number): { bg: string; text: string } {
  if (utilization === 0) return { bg: 'bg-gray-50 dark:bg-gray-800', text: 'text-gray-300 dark:text-gray-600' };
  if (utilization < 50) return { bg: 'bg-green-50 dark:bg-green-900/30', text: 'text-green-600 dark:text-green-400' };
  if (utilization < 80) return { bg: 'bg-green-100 dark:bg-green-900/40', text: 'text-green-700 dark:text-green-300' };
  if (utilization <= 100) return { bg: 'bg-yellow-100 dark:bg-yellow-900/40', text: 'text-yellow-700 dark:text-yellow-300' };
  return { bg: 'bg-red-100 dark:bg-red-900/40', text: 'text-red-700 dark:text-red-300' };
}

function formatWeek(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function WorkloadHeatmap({ workload, resources }: WorkloadHeatmapProps) {
  const weeks = workload.length > 0 ? workload[0].weeks : [];

  return (
    <div className="space-y-6">
      {/* Heatmap */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Workload Heatmap</h3>
          <span className="text-xs text-gray-400 dark:text-gray-500">Weekly utilization by resource</span>
        </div>

        {workload.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-400">
            No resource assignments for this project.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-400 sticky left-0 bg-gray-50 dark:bg-gray-900 min-w-[160px]">
                    Resource
                  </th>
                  <th className="px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-center w-16">Avg</th>
                  <th className="px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-right w-20">Cost</th>
                  {weeks.slice(0, 12).map((w, i) => (
                    <th key={i} className="px-1 py-2 font-medium text-gray-400 dark:text-gray-500 text-center min-w-[48px]">
                      {formatWeek(w.weekStart)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {workload.map((rw) => (
                  <tr key={rw.resourceId} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50/50 dark:hover:bg-gray-700/50">
                    <td className="px-3 py-2 sticky left-0 bg-white dark:bg-gray-800">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 flex items-center justify-center text-[8px] font-bold">
                          {getInitials(rw.resourceName)}
                        </div>
                        <div>
                          <div className="font-medium text-gray-900 dark:text-white">{rw.resourceName}</div>
                          <div className="text-xs text-gray-400 dark:text-gray-500">{rw.role}</div>
                        </div>
                        {rw.isOverAllocated && (
                          <span className="ml-1 text-xs font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-1.5 py-0.5 rounded-full">
                            Over
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span className={`font-bold ${rw.averageUtilization > 100 ? 'text-red-600' : rw.averageUtilization > 80 ? 'text-yellow-600' : 'text-green-600'}`}>
                        {rw.averageUtilization}%
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right text-xs font-medium text-gray-600 dark:text-gray-400">
                      {rw.costRateHourly != null && (rw.totalCost ?? 0) > 0
                        ? `$${(rw.totalCost ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                        : '—'}
                    </td>
                    {rw.weeks.slice(0, 12).map((w, i) => {
                      const { bg, text } = getHeatColor(w.utilization);
                      return (
                        <td key={i} className="px-1 py-1 text-center">
                          <div
                            className={`rounded px-1 py-1 ${bg} ${text} font-medium`}
                            title={`${rw.resourceName} — Week of ${formatWeek(w.weekStart)}: ${w.allocated}h / ${w.capacity}h (${w.utilization}%)${w.cost && w.cost > 0 ? ` — $${w.cost.toLocaleString()}` : ''}`}
                          >
                            {w.utilization > 0 ? `${w.utilization}%` : '-'}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Legend */}
        <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
          <span className="font-medium">Utilization:</span>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800" />
            <span>&lt;50%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-green-100 dark:bg-green-900/40 border border-green-300 dark:border-green-700" />
            <span>50-80%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-yellow-100 dark:bg-yellow-900/40 border border-yellow-300 dark:border-yellow-700" />
            <span>80-100%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-red-100 dark:bg-red-900/40 border border-red-300 dark:border-red-700" />
            <span>&gt;100%</span>
          </div>
        </div>
      </div>

      {/* Resource List */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Resource Pool</h3>
          <span className="text-xs text-gray-400 dark:text-gray-500">{resources.length} resources</span>
        </div>

        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          {resources.map((res) => (
            <div key={res.id} className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50/50 dark:hover:bg-gray-700/50 transition-colors">
              <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 flex items-center justify-center text-xs font-bold flex-shrink-0">
                {getInitials(res.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{res.name}</span>
                  {!res.isActive && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded-full">Inactive</span>
                  )}
                </div>
                <div className="text-xs text-gray-500">{res.role}</div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-xs text-gray-500 dark:text-gray-400">{res.capacityHoursPerWeek}h/week</div>
                <div className="text-xs text-gray-400 dark:text-gray-500">{res.email}</div>
              </div>
              {res.skills.length > 0 && (
                <div className="flex gap-1 flex-wrap max-w-[200px]">
                  {res.skills.slice(0, 3).map((skill, i) => (
                    <span key={i} className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded-full">
                      {skill}
                    </span>
                  ))}
                  {res.skills.length > 3 && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">+{res.skills.length - 3}</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
