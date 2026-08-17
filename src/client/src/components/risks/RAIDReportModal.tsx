import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, X, Download, Mail, Calendar, Trash2, Lock, RefreshCw } from 'lucide-react';
import DOMPurify from 'dompurify';
import { apiService } from '../../services/api';

interface Props {
  projectId: string;
  projectName: string;
  members: Array<{ userId: string; userName: string; email: string }>;
  onClose: () => void;
}

interface Filters {
  types: string[];
  severities: string[];
  owners: string[];
  categories: string[];
}

const TYPE_OPTIONS = [
  { value: 'risk', label: 'Risks' },
  { value: 'issue', label: 'Issues' },
  { value: 'action', label: 'Actions' },
  { value: 'decision', label: 'Decisions' },
];

const SEVERITY_OPTIONS = ['critical', 'high', 'medium', 'low'];

export function RAIDReportModal({ projectId, projectName, members, onClose }: Props) {
  const [report, setReport] = useState<any>(null);
  const [isSample, setIsSample] = useState(false);
  const [tab, setTab] = useState<'report' | 'email' | 'schedule'>('report');
  const [emailRecipients, setEmailRecipients] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [scheduleFrequency, setScheduleFrequency] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [scheduleDayOfWeek, setScheduleDayOfWeek] = useState(1);
  const [scheduleDayOfMonth, setScheduleDayOfMonth] = useState(1);
  const [scheduleTime, setScheduleTime] = useState('08:00');
  const [scheduleRecipients, setScheduleRecipients] = useState('');
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<Filters>({
    types: [],
    severities: [],
    owners: [],
    categories: [],
  });

  const mutation = useMutation({
    mutationFn: () => apiService.generateRAIDReport(projectId, {
      types: filters.types.length ? filters.types : undefined,
      severities: filters.severities.length ? filters.severities : undefined,
      owners: filters.owners.length ? filters.owners : undefined,
      categories: filters.categories.length ? filters.categories : undefined,
    }),
    onSuccess: (data) => {
      setReport(data);
      if (data?.sample) setIsSample(true);
    },
  });

  const emailMutation = useMutation({
    mutationFn: (recipients: string[]) => apiService.generateRAIDReport(projectId, {
      types: filters.types.length ? filters.types : undefined,
      severities: filters.severities.length ? filters.severities : undefined,
      owners: filters.owners.length ? filters.owners : undefined,
      categories: filters.categories.length ? filters.categories : undefined,
    }, { recipients, sendEmail: true }),
    onSuccess: () => setEmailSent(true),
  });

  const scheduleMutation = useMutation({
    mutationFn: (data: { projectId: string; frequency: 'daily' | 'weekly' | 'monthly'; dayOfWeek?: number; dayOfMonth?: number; timeOfDay: string; recipients: string[] }) =>
      apiService.scheduleRAIDReport(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['raid-report-schedules', projectId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiService.deleteRAIDReportSchedule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['raid-report-schedules', projectId] });
    },
  });

  const { data: schedulesData } = useQuery({
    queryKey: ['raid-report-schedules', projectId],
    queryFn: () => apiService.getRAIDReportSchedules(projectId),
  });

  useEffect(() => {
    mutation.mutate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const html = report?.report?.html || '';

  const handleDownload = () => {
    const blob = new Blob([html || 'No report generated'], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `raid-report-${projectName.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleEmailSend = () => {
    const recipients = emailRecipients.split(',').map(e => e.trim()).filter(Boolean);
    if (recipients.length === 0) return;
    emailMutation.mutate(recipients);
  };

  const handleScheduleCreate = () => {
    const recipients = scheduleRecipients.split(',').map(e => e.trim()).filter(Boolean);
    if (recipients.length === 0) return;
    scheduleMutation.mutate({
      projectId,
      frequency: scheduleFrequency,
      dayOfWeek: scheduleFrequency === 'weekly' ? scheduleDayOfWeek : undefined,
      dayOfMonth: scheduleFrequency === 'monthly' ? scheduleDayOfMonth : undefined,
      timeOfDay: scheduleTime,
      recipients,
    });
  };

  const toggleFilter = (key: keyof Filters, value: string) => {
    setFilters(prev => ({
      ...prev,
      [key]: prev[key].includes(value)
        ? prev[key].filter(v => v !== value)
        : [...prev[key], value],
    }));
  };

  const schedules = schedulesData?.schedules || [];
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const inputClass = 'w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white';
  const checkboxLabelClass = 'inline-flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300 cursor-pointer';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary-500" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">RAID Report — {projectName}</h2>
          </div>
          <div className="flex items-center gap-2">
            {html && !isSample && (
              <button onClick={handleDownload} className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                <Download className="w-3 h-3" />
                Download
              </button>
            )}
            <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
              <X className="w-4 h-4 text-gray-400 dark:text-gray-500" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 px-5">
          {[
            { key: 'report' as const, label: 'Report', icon: FileText, locked: false },
            { key: 'email' as const, label: 'Email Report', icon: Mail, locked: isSample },
            { key: 'schedule' as const, label: 'Schedule Recurring', icon: Calendar, locked: isSample },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => !t.locked && setTab(t.key)}
              disabled={t.locked}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                t.locked
                  ? 'border-transparent text-gray-300 dark:text-gray-600 cursor-not-allowed'
                  : tab === t.key
                    ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              <t.icon className="w-3 h-3" />
              {t.label}
              {t.locked && <Lock className="w-3 h-3 ml-0.5" />}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'report' && (
            <>
              {/* Filter section */}
              <div className="mb-4 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Filters</span>
                  <button
                    onClick={() => mutation.mutate()}
                    disabled={mutation.isPending}
                    className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${mutation.isPending ? 'animate-spin' : ''}`} />
                    {mutation.isPending ? 'Generating...' : 'Generate Report'}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Type filters */}
                  <div>
                    <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase">Types</span>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {TYPE_OPTIONS.map(opt => (
                        <label key={opt.value} className={checkboxLabelClass}>
                          <input
                            type="checkbox"
                            checked={filters.types.includes(opt.value)}
                            onChange={() => toggleFilter('types', opt.value)}
                            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Severity filters */}
                  <div>
                    <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase">Severities</span>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {SEVERITY_OPTIONS.map(sev => (
                        <label key={sev} className={checkboxLabelClass}>
                          <input
                            type="checkbox"
                            checked={filters.severities.includes(sev)}
                            onChange={() => toggleFilter('severities', sev)}
                            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                          <span className="capitalize">{sev}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Owner filter */}
                  <div>
                    <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase">Owner</span>
                    <select
                      value={filters.owners[0] || ''}
                      onChange={e => setFilters(prev => ({ ...prev, owners: e.target.value ? [e.target.value] : [] }))}
                      className="mt-1 w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    >
                      <option value="">All Owners</option>
                      {members.map(m => (
                        <option key={m.userId} value={m.userId}>{m.userName || m.email}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {isSample && (
                <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
                  <div className="flex items-start gap-2">
                    <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Sample Report</p>
                      <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                        This is a sample RAID report with demo data. Upgrade to a paid plan to generate reports from your actual project data, email them to stakeholders, and schedule recurring delivery.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {mutation.isPending ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mb-3" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">Generating RAID report...</p>
                </div>
              ) : mutation.isError ? (
                <div className="text-center py-8">
                  <p className="text-sm text-red-500">Failed to generate report</p>
                  <button onClick={() => mutation.mutate()} className="mt-2 text-xs text-primary-600 dark:text-primary-400 hover:underline">Try again</button>
                </div>
              ) : html ? (
                <div
                  className={`raid-report-container ${isSample ? 'opacity-80' : ''}`}
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
                />
              ) : null}
            </>
          )}

          {tab === 'email' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Recipients (comma-separated emails)</label>
                <input
                  type="text"
                  value={emailRecipients}
                  onChange={e => setEmailRecipients(e.target.value)}
                  placeholder="user@example.com, manager@example.com"
                  className={inputClass}
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                This will generate a fresh RAID report with the current filters and email it to the specified recipients.
              </p>
              {emailSent && (
                <div className="text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-3 py-2 rounded-lg">
                  RAID report emailed successfully!
                </div>
              )}
              <button
                onClick={handleEmailSend}
                disabled={emailMutation.isPending || !emailRecipients.trim()}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Mail className="w-4 h-4" />
                {emailMutation.isPending ? 'Sending...' : 'Send Report'}
              </button>
            </div>
          )}

          {tab === 'schedule' && (
            <div className="space-y-4">
              {schedules.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Active Schedules</h4>
                  {schedules.map((s: any) => (
                    <div key={s.id} className="flex items-center justify-between p-3 border border-gray-200 dark:border-gray-600 rounded-lg text-xs">
                      <div>
                        <span className="font-medium text-gray-900 dark:text-white capitalize">{s.frequency}</span>
                        {s.frequency === 'weekly' && s.dayOfWeek != null && (
                          <span className="text-gray-500 dark:text-gray-400 ml-1">on {dayNames[s.dayOfWeek]}</span>
                        )}
                        {s.frequency === 'monthly' && s.dayOfMonth != null && (
                          <span className="text-gray-500 dark:text-gray-400 ml-1">on day {s.dayOfMonth}</span>
                        )}
                        <span className="text-gray-500 dark:text-gray-400 ml-1">at {s.timeOfDay || '08:00'}</span>
                        <div className="text-gray-400 dark:text-gray-500 mt-0.5">
                          To: {(s.recipients || []).join(', ')}
                        </div>
                      </div>
                      <button
                        onClick={() => deleteMutation.mutate(s.id)}
                        className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                        title="Delete schedule"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-3 pt-2">
                <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">New Schedule</h4>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Frequency</label>
                    <select
                      value={scheduleFrequency}
                      onChange={e => setScheduleFrequency(e.target.value as any)}
                      className={inputClass}
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>

                  {scheduleFrequency === 'weekly' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Day of Week</label>
                      <select
                        value={scheduleDayOfWeek}
                        onChange={e => setScheduleDayOfWeek(Number(e.target.value))}
                        className={inputClass}
                      >
                        {dayNames.map((d, i) => <option key={i} value={i}>{d}</option>)}
                      </select>
                    </div>
                  )}

                  {scheduleFrequency === 'monthly' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Day of Month</label>
                      <input
                        type="number"
                        min={1}
                        max={31}
                        value={scheduleDayOfMonth}
                        onChange={e => setScheduleDayOfMonth(Number(e.target.value))}
                        className={inputClass}
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Time</label>
                    <input
                      type="time"
                      value={scheduleTime}
                      onChange={e => setScheduleTime(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Recipients (comma-separated emails)</label>
                  <input
                    type="text"
                    value={scheduleRecipients}
                    onChange={e => setScheduleRecipients(e.target.value)}
                    placeholder="user@example.com, manager@example.com"
                    className={inputClass}
                  />
                </div>

                {scheduleMutation.isSuccess && (
                  <div className="text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-3 py-2 rounded-lg">
                    Schedule created successfully!
                  </div>
                )}

                <button
                  onClick={handleScheduleCreate}
                  disabled={scheduleMutation.isPending || !scheduleRecipients.trim()}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Calendar className="w-4 h-4" />
                  {scheduleMutation.isPending ? 'Creating...' : 'Create Schedule'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
