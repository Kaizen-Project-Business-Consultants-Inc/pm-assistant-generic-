import { CheckCircle2, XCircle, Clock, Loader2, SkipForward, Circle } from 'lucide-react';

interface NodeExecution {
  id: string;
  nodeId: string;
  status: string;
  inputData: Record<string, any> | null;
  outputData: Record<string, any> | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface WorkflowNode {
  id: string;
  nodeType: string;
  name: string;
  config: Record<string, any>;
}

interface ExecutionDetailProps {
  execution: {
    id: string;
    workflowId: string;
    status: string;
    entityType: string;
    entityId: string;
    startedAt: string;
    completedAt: string | null;
    errorMessage: string | null;
    nodeExecutions: NodeExecution[];
  };
  nodes?: WorkflowNode[];
  onResume?: (nodeId: string) => void;
}

const statusIcon: Record<string, JSX.Element> = {
  completed: <CheckCircle2 className="w-4 h-4 text-green-500" />,
  failed: <XCircle className="w-4 h-4 text-red-500" />,
  running: <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />,
  waiting: <Clock className="w-4 h-4 text-amber-500" />,
  skipped: <SkipForward className="w-4 h-4 text-gray-500" />,
  pending: <Circle className="w-4 h-4 text-gray-300" />,
};

const statusColor: Record<string, string> = {
  completed: 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
  failed: 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
  running: 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
  waiting: 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
  cancelled: 'text-gray-700 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600',
};

export function ExecutionDetail({ execution, nodes, onResume }: ExecutionDetailProps) {
  const nodeMap = new Map<string, WorkflowNode>();
  if (nodes) nodes.forEach(n => nodeMap.set(n.id, n));

  return (
    <div className="space-y-3">
      {/* Execution header */}
      <div className={`flex items-center justify-between p-3 rounded-lg border ${statusColor[execution.status] || 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800'}`}>
        <div className="flex items-center gap-2">
          {statusIcon[execution.status] || statusIcon.pending}
          <span className="text-sm font-medium capitalize">{execution.status}</span>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          Started: {new Date(execution.startedAt).toLocaleString()}
          {execution.completedAt && <> | Completed: {new Date(execution.completedAt).toLocaleString()}</>}
        </div>
      </div>

      {execution.errorMessage && (
        <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded-lg border border-red-200 dark:border-red-800">
          {execution.errorMessage}
        </div>
      )}

      {/* Node execution timeline */}
      <div className="relative">
        {execution.nodeExecutions.map((ne, idx) => {
          const node = nodeMap.get(ne.nodeId);
          const isLast = idx === execution.nodeExecutions.length - 1;

          return (
            <div key={ne.id} className="flex gap-3">
              {/* Timeline line */}
              <div className="flex flex-col items-center">
                <div className="flex-shrink-0 mt-1">
                  {statusIcon[ne.status] || statusIcon.pending}
                </div>
                {!isLast && <div className="w-px h-full bg-gray-200 dark:bg-gray-700 min-h-[24px]" />}
              </div>

              {/* Node content */}
              <div className="pb-3 flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-800 dark:text-gray-200">
                    {node?.name || ne.nodeId}
                  </span>
                  {node && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 capitalize">
                      {node.nodeType}
                    </span>
                  )}
                  <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${
                    ne.status === 'completed' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
                    ne.status === 'failed' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' :
                    ne.status === 'waiting' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' :
                    ne.status === 'running' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' :
                    'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                  }`}>
                    {ne.status}
                  </span>
                </div>

                {ne.startedAt && (
                  <div className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
                    {new Date(ne.startedAt).toLocaleString()}
                  </div>
                )}

                {ne.outputData && Object.keys(ne.outputData).length > 0 && (
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 bg-gray-50 dark:bg-gray-700/50 p-1.5 rounded">
                    {JSON.stringify(ne.outputData)}
                  </div>
                )}

                {ne.errorMessage && (
                  <div className="text-xs text-red-600 dark:text-red-400 mt-1">{ne.errorMessage}</div>
                )}

                {ne.status === 'waiting' && onResume && (
                  <button
                    onClick={() => onResume(ne.nodeId)}
                    className="mt-1 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50 rounded transition-colors"
                  >
                    Resume
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
