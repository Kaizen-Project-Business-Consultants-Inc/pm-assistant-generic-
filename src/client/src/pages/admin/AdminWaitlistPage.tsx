import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Download, Send, Mail, CheckCircle2, AlertCircle } from 'lucide-react';
import { apiService } from '../../services/api';
import { AdminPageWrapper } from './AdminPageWrapper';

interface WaitlistEntry {
  email: string;
  created_at: string;
  launch_email_sent?: boolean;
  launch_email_sent_at?: string;
}

export function AdminWaitlistPage() {
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number } | null>(null);

  const { data, isLoading, error } = useQuery<{ count: number; entries: WaitlistEntry[] }>({
    queryKey: ['admin-waitlist'],
    queryFn: () => apiService.getWaitlistEntries(),
  });

  const sendMutation = useMutation({
    mutationFn: () => apiService.sendWaitlistLaunchEmail(),
    onSuccess: (result) => {
      setSendResult(result);
    },
  });

  const handleExportCsv = async () => {
    try {
      const blob = await apiService.exportWaitlistCsv();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'waitlist.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // silently fail
    }
  };

  const entries = data?.entries || [];

  return (
    <AdminPageWrapper title="Waitlist" subtitle="Pre-launch email signups">
      {/* Stats + Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">{data?.count ?? '—'}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">total signups</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <button
            onClick={() => {
              if (window.confirm('Send the launch announcement email to all waitlist subscribers who haven\'t received it yet?')) {
                sendMutation.mutate();
              }
            }}
            disabled={sendMutation.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            {sendMutation.isPending ? 'Sending...' : 'Send Launch Email'}
          </button>
        </div>
      </div>

      {/* Send result feedback */}
      {sendResult && (
        <div className={`rounded-lg p-3 mb-4 flex items-center gap-2 ${sendResult.failed > 0 ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800' : 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'}`} role="alert">
          {sendResult.failed > 0 ? (
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />
          )}
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Sent {sendResult.sent} email{sendResult.sent !== 1 ? 's' : ''}.
            {sendResult.failed > 0 && ` ${sendResult.failed} failed.`}
          </p>
        </div>
      )}

      {sendMutation.error && (
        <div className="rounded-lg p-3 mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800" role="alert">
          <p className="text-sm text-red-700 dark:text-red-400">Failed to send launch emails. Check server logs.</p>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg p-4 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm" role="alert">
          Failed to load waitlist entries.
        </div>
      )}

      {/* Table */}
      {!isLoading && !error && entries.length === 0 && (
        <div className="text-center py-12">
          <Mail className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-gray-500 dark:text-gray-400">No signups yet.</p>
        </div>
      )}

      {entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-3">#</th>
                <th className="text-left px-4 py-3">Email</th>
                <th className="text-left px-4 py-3">Joined</th>
                <th className="text-left px-4 py-3">Launch Email</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => (
                <tr key={entry.email} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <td className="px-4 py-3 text-gray-400">{i + 1}</td>
                  <td className="px-4 py-3 text-gray-900 dark:text-white font-medium">{entry.email}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                    {new Date(entry.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    {entry.launch_email_sent ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                        <CheckCircle2 className="w-3 h-3" /> Sent
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">Not sent</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminPageWrapper>
  );
}
