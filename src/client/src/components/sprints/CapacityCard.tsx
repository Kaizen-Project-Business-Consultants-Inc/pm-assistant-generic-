import { useQuery } from '@tanstack/react-query';
import { Users, TrendingUp, AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import { apiService } from '../../services/api';

interface CapacityCardProps {
  sprintId: string;
}

const confidenceConfig = {
  low: { icon: HelpCircle, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/20', label: 'Low confidence (< 2 sprints)' },
  medium: { icon: AlertTriangle, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20', label: 'Medium confidence (2-4 sprints)' },
  high: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-900/20', label: 'High confidence (5+ sprints)' },
};

export function CapacityCard({ sprintId }: CapacityCardProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['capacity-recommendation', sprintId],
    queryFn: () => apiService.getCapacityRecommendation(sprintId),
  });

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 animate-pulse">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-3" />
        <div className="h-16 bg-gray-100 dark:bg-gray-700 rounded" />
      </div>
    );
  }

  const cap = data?.capacity;
  if (!cap) return null;

  const { recommendedVelocity, avgVelocity, teamSize, velocityPerMember, sprintCount, confidence } = cap;
  const cfg = confidenceConfig[confidence as keyof typeof confidenceConfig] || confidenceConfig.low;
  const ConfIcon = cfg.icon;

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-4 h-4 text-primary-500" />
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Capacity Recommendation</h4>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="text-center p-2 rounded-lg bg-primary-50 dark:bg-primary-900/20">
          <p className="text-2xl font-bold text-primary-700 dark:text-primary-300">{recommendedVelocity}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Recommended pts</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50">
          <p className="text-2xl font-bold text-gray-700 dark:text-gray-300">{avgVelocity || '--'}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Avg velocity</p>
        </div>
      </div>

      <div className="space-y-1.5 text-xs text-gray-600 dark:text-gray-400">
        <div className="flex items-center gap-2">
          <Users className="w-3.5 h-3.5 text-gray-500" />
          <span>{teamSize} team member{teamSize !== 1 ? 's' : ''}</span>
          {velocityPerMember > 0 && (
            <span className="text-gray-500">({velocityPerMember} pts/person)</span>
          )}
        </div>
        <div className={`flex items-center gap-2 px-2 py-1 rounded ${cfg.bg}`}>
          <ConfIcon className={`w-3.5 h-3.5 ${cfg.color}`} />
          <span>{cfg.label}</span>
          <span className="text-gray-500">({sprintCount} sprint{sprintCount !== 1 ? 's' : ''} of data)</span>
        </div>
      </div>
    </div>
  );
}
