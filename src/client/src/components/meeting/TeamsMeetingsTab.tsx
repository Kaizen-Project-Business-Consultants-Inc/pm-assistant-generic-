import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, ChevronDown, Copy, Link2, Loader2, Send, Unplug } from 'lucide-react';
import { apiService } from '../../services/api';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';
import { useOAuthResult } from '../../hooks/useOAuthResult';

/**
 * Meeting Intelligence → From Teams (2026-09-30). The PM connects their own Microsoft account,
 * picks one of their Teams meetings, checks who's who, and gets the usual analysis — with each
 * item showing who said it. Kovarti reads the transcript Teams made; it never joins a meeting.
 *
 * States: loading → not set up on this site | not connected | meeting list → who's who → analyzing
 * → (parent shows the results). Errors stay on the step they happened in.
 */

interface TeamsMeeting {
  eventId: string;
  subject: string;
  start: string;
  transcript: 'ready' | 'none' | 'not_allowed';
  analysisId: string | null;
}

interface Speaker { name: string; userId: string | null; matchedBy: 'saved' | 'name' | 'email' | null; lines: number }

interface Props {
  projectId: string;
  schedules: { id: string; name: string }[];
  scheduleId: string;
  onScheduleChange: (id: string) => void;
  /** The analysis is ready — the page shows it the same way as Paste / Upload */
  onAnalyzed: (analysis: any, title: string) => void;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const pill = 'inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap';

export const TeamsMeetingsTab: React.FC<Props> = ({ projectId, schedules, scheduleId, onScheduleChange, onAnalyzed }) => {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<TeamsMeeting | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [approvalUrl, setApprovalUrl] = useState<string | null>(null);

  const status = useQuery({ queryKey: ['teamsMeetingsStatus'], queryFn: () => apiService.getTeamsMeetingsStatus() });
  const connected = !!status.data?.connected;

  const meetings = useQuery({
    queryKey: ['teamsMeetings', projectId],
    queryFn: () => apiService.listTeamsMeetings(projectId),
    enabled: connected && !!projectId,
    staleTime: 60_000,
    retry: false,
  });

  const speakers = useQuery({
    queryKey: ['teamsMeetingSpeakers', projectId, picked?.eventId],
    queryFn: () => apiService.getTeamsMeetingSpeakers(projectId, picked!.eventId),
    enabled: !!picked,
    retry: false,
  });

  // Start from Kovarti's best guess each time a meeting is opened
  useEffect(() => {
    const list: Speaker[] = speakers.data?.speakers ?? [];
    setMapping(Object.fromEntries(list.map(s => [s.name, s.userId])));
  }, [speakers.data]);

  // The Microsoft sign-in happens in a pop-up; hear when it finishes
  useOAuthResult((r) => {
    if (r.provider !== 'msteams_meetings') return;
    if (r.success) queryClient.invalidateQueries({ queryKey: ['teamsMeetingsStatus'] });
    else if (r.error) setError(r.error);
  });

  const connect = async () => {
    setError(null);
    try {
      const { url } = await apiService.getTeamsMeetingsInstallUrl();
      const popup = window.open(url, '_blank', 'width=600,height=700');
      if (!popup || popup.closed) setError('Your browser blocked the Microsoft window. Allow pop-ups for this site and try again.');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not start the Teams connection. Try again.'));
    }
  };

  const copyApprovalLink = async () => {
    setError(null);
    try {
      const url = approvalUrl ?? (await apiService.getTeamsAdminApprovalUrl()).url;
      setApprovalUrl(url);
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      // Clipboard refused: the link is shown below to copy by hand
      if (!approvalUrl) setError(getApiErrorMessage(err, 'Could not make the approval link. Try again.'));
    }
  };

  const disconnect = useMutation({
    mutationFn: () => apiService.disconnectTeamsMeetings(),
    onSuccess: () => {
      setPicked(null);
      queryClient.invalidateQueries({ queryKey: ['teamsMeetingsStatus'] });
      queryClient.removeQueries({ queryKey: ['teamsMeetings'] });
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Could not disconnect. Try again.')),
  });

  const analyze = useMutation({
    mutationFn: () => apiService.analyzeTeamsMeeting({ projectId, scheduleId, eventId: picked!.eventId, mapping }),
    onSuccess: (data: any) => {
      onAnalyzed(data?.data ?? data, picked!.subject);
      queryClient.invalidateQueries({ queryKey: ['teamsMeetings', projectId] });
      setPicked(null);
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Could not analyze this meeting. Try again.')),
  });

  const errorBox = error && (
    <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-300">
      {error}
    </div>
  );

  if (status.isLoading) {
    return <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /> Checking your Teams connection…</div>;
  }

  if (!status.data?.configured) {
    return (
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Teams is not set up on this site yet. Contact support and we will switch it on. Meanwhile you can download the transcript from Teams and use <strong>Upload</strong>.
      </p>
    );
  }

  // ---- Not connected: connect your Microsoft account; IT admin approves once ----
  if (!connected) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">Connect your Microsoft account</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Kovarti reads the transcripts of meetings you choose. It never joins or records a meeting.</p>
          </div>
          <button type="button" onClick={connect} className="btn btn-primary flex items-center gap-2">
            <Link2 className="w-4 h-4" /> Connect Teams
          </button>
        </div>
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-900 dark:text-amber-200 space-y-2">
          <p><strong>Your IT admin needs to approve Kovarti once.</strong> If Microsoft says you need approval, send your admin this link. After they approve, click Connect Teams again.</p>
          <button type="button" onClick={copyApprovalLink} className="btn btn-secondary text-xs px-3 py-1.5 inline-flex items-center gap-1.5">
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Link copied' : 'Copy link for your IT admin'}
          </button>
          {approvalUrl && !copied && (
            <input readOnly value={approvalUrl} onFocus={(e) => e.currentTarget.select()} aria-label="Approval link for your IT admin" className="input w-full text-xs" />
          )}
        </div>
        {errorBox}
      </div>
    );
  }

  const scheduleSelect = (
    <div className="max-w-xs">
      <label htmlFor="teams-schedule" className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Schedule</label>
      <div className="relative">
        <select id="teams-schedule" value={scheduleId} onChange={(e) => onScheduleChange(e.target.value)} className="input w-full appearance-none pr-8">
          <option value="">Select a schedule...</option>
          {schedules.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" />
      </div>
    </div>
  );

  // ---- Step 3: who's who ----
  if (picked) {
    const list: Speaker[] = speakers.data?.speakers ?? [];
    const members: { userId: string; name: string }[] = speakers.data?.members ?? [];
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => { setPicked(null); setError(null); }} className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to meetings
        </button>
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">Who's who · {picked.subject}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Kovarti matched speakers to project members where it could. Check the rest — your choice is remembered for the next meeting.</p>
        </div>
        {speakers.isLoading && <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /> Reading the transcript…</div>}
        {speakers.isError && (
          <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-300">
            {getApiErrorMessage(speakers.error, 'Could not read this transcript.')}
          </div>
        )}
        {list.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <th className="py-2 pr-4 font-medium">Speaker in Teams</th>
                  <th className="py-2 font-medium">Project member</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {list.map((sp, i) => (
                  <tr key={sp.name}>
                    <td className="py-2 pr-4 text-gray-900 dark:text-white">
                      {sp.name}
                      {sp.matchedBy && <span className={`${pill} ml-2 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400`}>matched</span>}
                    </td>
                    <td className="py-2">
                      <select
                        id={`speaker-${i}`}
                        aria-label={`Project member for ${sp.name}`}
                        value={mapping[sp.name] ?? ''}
                        onChange={(e) => setMapping(m => ({ ...m, [sp.name]: e.target.value || null }))}
                        className="input py-1 text-sm"
                      >
                        <option value="">Not a project member</option>
                        {members.map(m => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.length > 0 && (
          <div className="flex flex-wrap items-end gap-4">
            {scheduleSelect}
            <button
              type="button"
              onClick={() => { setError(null); analyze.mutate(); }}
              disabled={!scheduleId || analyze.isPending}
              className="btn btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {analyze.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {analyze.isPending ? 'Analyzing…' : 'Analyze meeting'}
            </button>
          </div>
        )}
        {errorBox}
      </div>
    );
  }

  // ---- Step 2: pick a meeting ----
  const rows: TeamsMeeting[] = meetings.data?.meetings ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500 dark:text-gray-400">Your Teams meetings from the last 30 days</p>
        <button type="button" onClick={() => disconnect.mutate()} disabled={disconnect.isPending} className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400">
          <Unplug className="w-3.5 h-3.5" /> Disconnect Teams
        </button>
      </div>
      {meetings.isLoading && <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /> Loading your meetings…</div>}
      {meetings.isError && (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-300">
          {getApiErrorMessage(meetings.error, 'Could not load your Teams meetings.')}
          {' '}<button type="button" onClick={connect} className="underline font-medium">Connect again</button>
        </div>
      )}
      {meetings.isSuccess && rows.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">No Teams meetings in your calendar in the last 30 days.</p>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <th className="py-2 pr-4 font-medium">Meeting</th>
                <th className="py-2 pr-4 font-medium">When</th>
                <th className="py-2 pr-4 font-medium">Transcript</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {rows.map(m => (
                <tr key={m.eventId}>
                  <td className="py-2 pr-4 text-gray-900 dark:text-white">{m.subject}</td>
                  <td className="py-2 pr-4 text-gray-500 dark:text-gray-400 whitespace-nowrap tabular-nums">{when(m.start)}</td>
                  <td className="py-2 pr-4">
                    {m.transcript === 'ready' && (m.analysisId
                      ? <span className={`${pill} bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300`}>Already analyzed</span>
                      : <span className={`${pill} bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400`}>Ready</span>)}
                    {m.transcript === 'none' && <span className={`${pill} bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300`}>No transcript</span>}
                    {m.transcript === 'not_allowed' && <span className={`${pill} bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300`}>Not allowed — ask the organizer</span>}
                  </td>
                  <td className="py-2 text-right">
                    {m.transcript === 'ready' && (
                      <button type="button" onClick={() => { setError(null); setPicked(m); }} className="btn btn-primary text-xs px-3 py-1.5">
                        {m.analysisId ? 'Analyze again' : 'Analyze'}
                      </button>
                    )}
                    {m.transcript === 'none' && <span className="text-xs text-gray-500 dark:text-gray-400">Transcription was off</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {errorBox}
    </div>
  );
};
