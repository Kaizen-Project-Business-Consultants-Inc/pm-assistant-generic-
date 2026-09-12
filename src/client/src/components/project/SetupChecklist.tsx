import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle, X, Rocket, Users, Calendar, DollarSign, ShieldAlert } from 'lucide-react';
import { apiService } from '../../services/api';

interface SetupChecklistProps {
  project: any;
  onNavigate: (tab: string) => void;
}

export function SetupChecklist({ project, onNavigate }: SetupChecklistProps) {
  const [dismissed, setDismissed] = useState(false);

  const { data: membersData } = useQuery({
    queryKey: ['project-members', project.id],
    queryFn: () => apiService.getProjectMembers(project.id),
    enabled: !!project.id,
    staleTime: 120_000,
  });

  const { data: schedulesData } = useQuery({
    queryKey: ['schedules', project.id],
    queryFn: () => apiService.getSchedules(project.id),
    enabled: !!project.id,
    staleTime: 120_000,
  });

  const { data: raidData } = useQuery({
    queryKey: ['project-risks-stats', project.id],
    queryFn: () => apiService.getRiskStats(project.id),
    enabled: !!project.id,
    staleTime: 120_000,
  });

  const members: any[] = membersData?.members || [];
  const schedules: any[] = schedulesData?.schedules || [];
  const raidStats = raidData?.data || raidData;
  const hasBudget = project.budgetAllocated > 0 || project.budget_allocated > 0;
  const hasTeam = members.length > 1; // more than just the creator
  const hasSchedule = schedules.length > 0;
  const hasRisks = (raidStats?.total || 0) > 0;

  const items = [
    { key: 'team', label: 'Add team members', done: hasTeam, tab: 'team', icon: Users },
    { key: 'schedule', label: 'Create a schedule', done: hasSchedule, tab: 'schedule', icon: Calendar },
    { key: 'budget', label: 'Set project budget', done: hasBudget, tab: 'overview', icon: DollarSign },
    { key: 'risks', label: 'Identify initial risks', done: hasRisks, tab: 'raid', icon: ShieldAlert },
  ];

  const completedCount = items.filter(i => i.done).length;
  const allDone = completedCount === items.length;

  // Don't show if dismissed or all items complete
  if (dismissed || allDone) return null;

  // Only show for projects with < 50% progress
  const progress = project.progress || 0;
  if (progress > 50) return null;

  return (
    <div className="rounded-xl border border-primary-200 dark:border-primary-700 bg-primary-50/50 dark:bg-primary-900/10 p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Rocket className="w-5 h-5 text-primary-600" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Get Started</h3>
          <span className="text-xs text-gray-500 dark:text-gray-400">{completedCount}/{items.length} complete</span>
        </div>
        <button onClick={() => setDismissed(true)} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {items.map(item => (
          <button
            key={item.key}
            onClick={() => !item.done && onNavigate(item.tab)}
            className={`flex items-center gap-3 rounded-lg p-3 text-left transition-colors ${
              item.done
                ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-primary-300 dark:hover:border-primary-600 cursor-pointer'
            }`}
          >
            {item.done ? (
              <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
            ) : (
              <Circle className="w-5 h-5 text-gray-300 dark:text-gray-600 flex-shrink-0" />
            )}
            <div>
              <p className={`text-sm font-medium ${item.done ? 'text-green-700 dark:text-green-400 line-through' : 'text-gray-900 dark:text-white'}`}>
                {item.label}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
