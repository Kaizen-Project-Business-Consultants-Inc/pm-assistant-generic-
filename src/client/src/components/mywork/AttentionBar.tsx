import { AlertTriangle, ShieldAlert, Ban } from 'lucide-react';
import { Link } from 'react-router-dom';
import { routeTo } from '../../routes';

interface AttentionData {
  overdueCount: number;
  oldestOverdueDays: number;
  blockedCount: number;
  criticalRisks: Array<{ id: string; title: string; projectId: string; projectName: string; severity: string; type: string }>;
}

export default function AttentionBar({ data }: { data: AttentionData }) {
  const hasIssues = data.overdueCount > 0 || data.blockedCount > 0 || data.criticalRisks.length > 0;
  if (!hasIssues) return null;

  const items: string[] = [];
  if (data.overdueCount > 0) {
    items.push(`${data.overdueCount} overdue task${data.overdueCount > 1 ? 's' : ''} (oldest: ${data.oldestOverdueDays}d)`);
  }
  if (data.blockedCount > 0) {
    items.push(`${data.blockedCount} blocked`);
  }
  if (data.criticalRisks.length > 0) {
    items.push(`${data.criticalRisks.length} critical risk${data.criticalRisks.length > 1 ? 's' : ''}`);
  }

  const hasCritical = data.criticalRisks.some(r => r.severity === 'critical') || data.oldestOverdueDays > 7;
  const bgColor = hasCritical
    ? 'bg-red-50 border-red-200 dark:bg-red-950/40 dark:border-red-800'
    : 'bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-800';
  const textColor = hasCritical
    ? 'text-red-800 dark:text-red-300'
    : 'text-amber-800 dark:text-amber-300';
  const iconColor = hasCritical
    ? 'text-red-500 dark:text-red-400'
    : 'text-amber-500 dark:text-amber-400';

  return (
    <div className={`rounded-lg border p-4 mb-6 ${bgColor}`}>
      <div className="flex items-start gap-3">
        <AlertTriangle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${iconColor}`} />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${textColor}`}>
            {items.join(' · ')}
          </p>
          {data.criticalRisks.length > 0 && (
            <div className="mt-2 space-y-1">
              {data.criticalRisks.slice(0, 3).map(risk => (
                <Link
                  key={risk.id}
                  to={routeTo.project(risk.projectId, 'risks')}
                  className={`flex items-center gap-2 text-xs ${textColor} hover:underline`}
                >
                  {risk.severity === 'critical' ? (
                    <ShieldAlert className="w-3.5 h-3.5" />
                  ) : (
                    <Ban className="w-3.5 h-3.5" />
                  )}
                  <span className="truncate">{risk.title}</span>
                  <span className="text-xs opacity-70">({risk.projectName})</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
