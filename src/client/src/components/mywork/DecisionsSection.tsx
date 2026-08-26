import { useState } from 'react';
import { ChevronDown, ChevronRight, Clock, CheckCircle2, XCircle, FileText, Bot, Users, CalendarClock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { routeTo } from '../../routes';

interface DecisionsData {
  timesheetApprovals: Array<{ id: string; userName: string; projectName: string; weekStart: string; totalHours: number; submittedAt: string }>;
  resourceRequests: Array<{ id: string; projectName: string; resourceRole: string; priority: string; requestedByName: string; createdAt: string }>;
  changeRequests: Array<{ id: string; title: string; projectName: string; priority: string; category: string; createdAt: string }>;
  proposals: Array<{ id: string; title: string; projectName: string; agentName: string; createdAt: string }>;
}

export default function DecisionsSection({ data }: { data: DecisionsData }) {
  const totalCount = data.timesheetApprovals.length + data.resourceRequests.length +
    data.changeRequests.length + data.proposals.length;
  const [collapsed, setCollapsed] = useState(false);
  const queryClient = useQueryClient();

  const approveTimesheet = useMutation({
    mutationFn: (id: string) => apiService.approveTimesheet(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-work'] }),
  });
  const rejectTimesheet = useMutation({
    mutationFn: (id: string) => apiService.rejectTimesheet(id, 'Rejected from My Work'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-work'] }),
  });
  const approveResource = useMutation({
    mutationFn: (id: string) => apiService.approveResourceRequest(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-work'] }),
  });
  const rejectResource = useMutation({
    mutationFn: (id: string) => apiService.rejectResourceRequest(id, 'Rejected from My Work'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-work'] }),
  });

  if (totalCount === 0) return null;

  const Chevron = collapsed ? ChevronRight : ChevronDown;

  return (
    <div className="mb-6">
      <button
        className="flex items-center gap-2 w-full px-1 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
      >
        <Chevron className="w-4 h-4 text-gray-400" />
        <Clock className="w-4 h-4 text-purple-600 dark:text-purple-400" />
        <span className="text-sm font-semibold text-purple-600 dark:text-purple-400">Needs Your Decision</span>
        <span className="ml-1 text-xs bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded-full px-2 py-0.5">
          {totalCount}
        </span>
      </button>

      {!collapsed && (
        <div className="ml-2 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
          {/* Timesheet approvals */}
          {data.timesheetApprovals.map(ts => (
            <div key={ts.id} className="flex flex-wrap sm:flex-nowrap items-center gap-2 px-4 py-2.5">
              <CalendarClock className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <span className="flex-1 min-w-0 text-sm text-gray-900 dark:text-gray-100 truncate">
                <span className="font-medium">{ts.userName}</span>
                <span className="text-gray-500 dark:text-gray-400"> · {ts.projectName} · Week of {ts.weekStart} · {ts.totalHours}h</span>
              </span>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => approveTimesheet.mutate(ts.id)}
                  disabled={approveTimesheet.isPending}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-300 dark:hover:bg-green-900/60 disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3 h-3" /> Approve
                </button>
                <button
                  onClick={() => rejectTimesheet.mutate(ts.id)}
                  disabled={rejectTimesheet.isPending}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/60 disabled:opacity-50"
                >
                  <XCircle className="w-3 h-3" /> Reject
                </button>
              </div>
            </div>
          ))}

          {/* Resource requests */}
          {data.resourceRequests.map(rr => (
            <div key={rr.id} className="flex flex-wrap sm:flex-nowrap items-center gap-2 px-4 py-2.5">
              <Users className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <span className="flex-1 min-w-0 text-sm text-gray-900 dark:text-gray-100 truncate">
                <span className="font-medium">{rr.resourceRole}</span>
                <span className="text-gray-500 dark:text-gray-400"> · {rr.projectName} · by {rr.requestedByName}</span>
              </span>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => approveResource.mutate(rr.id)}
                  disabled={approveResource.isPending}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-300 dark:hover:bg-green-900/60 disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3 h-3" /> Approve
                </button>
                <button
                  onClick={() => rejectResource.mutate(rr.id)}
                  disabled={rejectResource.isPending}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/60 disabled:opacity-50"
                >
                  <XCircle className="w-3 h-3" /> Reject
                </button>
              </div>
            </div>
          ))}

          {/* Change requests — navigate to review */}
          {data.changeRequests.map(cr => (
            <div key={cr.id} className="flex flex-wrap sm:flex-nowrap items-center gap-2 px-4 py-2.5">
              <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <Link
                to={routeTo.project(cr.projectName, 'changes')}
                className="flex-1 min-w-0 text-sm text-gray-900 dark:text-gray-100 truncate hover:text-primary-600 dark:hover:text-primary-400"
              >
                <span className="font-medium">{cr.title}</span>
                <span className="text-gray-500 dark:text-gray-400"> · {cr.projectName}</span>
              </Link>
              <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300 flex-shrink-0">
                {cr.priority}
              </span>
            </div>
          ))}

          {/* Agent proposals */}
          {data.proposals.map(p => (
            <div key={p.id} className="flex flex-wrap sm:flex-nowrap items-center gap-2 px-4 py-2.5">
              <Bot className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <span className="flex-1 min-w-0 text-sm text-gray-900 dark:text-gray-100 truncate">
                <span className="font-medium">{p.title}</span>
                <span className="text-gray-500 dark:text-gray-400"> · {p.projectName} · {p.agentName}</span>
              </span>
              <span className="text-xs text-gray-400 flex-shrink-0">Review in project</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
