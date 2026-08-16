import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { apiService } from '../../services/api';

interface RoleWeek {
  weekStart: string;
  capacity: number;
  allocated: number;
  surplus: number;
  status: 'surplus' | 'tight' | 'over';
}

interface RoleData {
  role: string;
  resourceCount: number;
  totalCapacity: number;
  weeks: RoleWeek[];
}

function formatWeek(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

const STATUS_COLORS = {
  surplus: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  tight: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
  over: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
};

export function RoleCapacityView() {
  const { data, isLoading } = useQuery({
    queryKey: ['capacityByRole'],
    queryFn: () => apiService.getCapacityByRole(),
  });

  const roles: RoleData[] = data?.roles || [];

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (roles.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 text-center text-gray-400">
        <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p>No active resources with assignments found.</p>
      </div>
    );
  }

  const weekHeaders = roles[0]?.weeks.map(w => w.weekStart) || [];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Capacity Planning by Role</h3>
        <span className="text-xs text-gray-400 dark:text-gray-500">12-week capacity vs demand by role</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
              <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-400 sticky left-0 bg-gray-50 dark:bg-gray-900 min-w-[160px]">
                Role
              </th>
              <th className="px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-center w-12">#</th>
              <th className="px-2 py-2 font-semibold text-gray-600 dark:text-gray-400 text-center w-16">Cap/Wk</th>
              {weekHeaders.map((w, i) => (
                <th key={i} className="px-1 py-2 font-medium text-gray-400 dark:text-gray-500 text-center min-w-[56px]">
                  {formatWeek(w)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roles.map(role => (
              <tr key={role.role} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50/50 dark:hover:bg-gray-700/50">
                <td className="px-3 py-2 sticky left-0 bg-white dark:bg-gray-800 font-medium text-gray-900 dark:text-white">
                  {role.role}
                </td>
                <td className="px-2 py-2 text-center text-gray-500">{role.resourceCount}</td>
                <td className="px-2 py-2 text-center text-gray-500">{role.totalCapacity}h</td>
                {role.weeks.map((w, i) => (
                  <td key={i} className="px-1 py-1 text-center">
                    <div
                      className={`rounded px-1 py-1 font-medium ${STATUS_COLORS[w.status]}`}
                      title={`${role.role} — ${formatWeek(w.weekStart)}\nCapacity: ${w.capacity}h\nAllocated: ${w.allocated}h\nSurplus: ${w.surplus}h`}
                    >
                      <div className="text-[9px] leading-tight">{w.allocated}/{w.capacity}h</div>
                      <div className="text-[8px] opacity-70">{w.surplus >= 0 ? `+${w.surplus}` : w.surplus}h</div>
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
        <span className="font-medium">Status:</span>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700" />
          <span>Surplus (&gt;20%)</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700" />
          <span>Tight (0-20%)</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700" />
          <span>Over-committed</span>
        </div>
      </div>
    </div>
  );
}
