import { useState, useEffect, useCallback, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, X, Download, Mail, Calendar, Trash2, Lock, Pencil, Save, RotateCcw, FileDown } from 'lucide-react';
import DOMPurify from 'dompurify';
import { apiService } from '../../services/api';

interface RAGArea {
  name: string;
  status: 'green' | 'amber' | 'red';
  previousStatus?: 'green' | 'amber' | 'red' | null;
  trend?: 'improving' | 'stable' | 'declining';
  comments: string;
}

interface MilestoneRow {
  ref: string;
  name: string;
  schedWeek: string;
  dueDate: string;
  status: string;
  comments: string;
}

interface AttentionItem {
  ref: string;
  matter: string;
  raised: string;
  owner: string;
  dateNeeded: string;
  impactIfDelayed: string;
}

interface ChangeControlRow {
  ref: string;
  description: string;
  status: string;
  scheduleImpact: string;
  costImpact: string;
}

interface ReportData {
  reportNumber: string;
  reportingPeriod: string;
  preparedBy: string;
  executiveSummary: string;
  areas: RAGArea[];
  milestones: MilestoneRow[];
  achievements: string[];
  plannedActivities: string[];
  managementAttention: AttentionItem[];
  changeControl: ChangeControlRow[];
  projectName: string;
  reportDate: string;
  aiPowered: boolean;
}

const RAG_OPTIONS: Array<'green' | 'amber' | 'red'> = ['green', 'amber', 'red'];
const RAG_COLORS: Record<string, string> = {
  green: '#A8D5A2',
  amber: '#FFD966',
  red: '#FF9B9B',
};

export function StatusReportModal({ projectId, projectName, onClose }: { projectId: string; projectName: string; onClose: () => void }) {
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

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<ReportData | null>(null);
  const [originalHtml, setOriginalHtml] = useState('');

  const mutation = useMutation({
    mutationFn: () => apiService.generateStatusReport(projectId),
    onSuccess: (data) => {
      setReport(data);
      if (data?.sample) setIsSample(true);
      if (data?.report?.html) setOriginalHtml(data.report.html);
    },
  });

  const renderMutation = useMutation({
    mutationFn: (data: ReportData) => apiService.renderStatusReport(data),
    onSuccess: (result) => {
      setReport((prev: any) => ({
        ...prev,
        report: { ...prev.report, html: result.html },
      }));
      setIsEditing(false);
    },
  });

  const emailMutation = useMutation({
    mutationFn: (recipients: string[]) => apiService.emailStatusReport(html, projectName, recipients),
    onSuccess: () => setEmailSent(true),
  });

  const scheduleMutation = useMutation({
    mutationFn: (data: { projectId: string; frequency: 'daily' | 'weekly' | 'monthly'; dayOfWeek?: number; dayOfMonth?: number; timeOfDay: string; recipients: string[] }) =>
      apiService.scheduleStatusReport(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['status-report-schedules', projectId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiService.deleteStatusReportSchedule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['status-report-schedules', projectId] });
    },
  });

  const { data: schedulesData } = useQuery({
    queryKey: ['status-report-schedules', projectId],
    queryFn: () => apiService.getStatusReportSchedules(projectId),
  });

  useEffect(() => {
    mutation.mutate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- fire once on open

  const html = report?.report?.html || '';

  const reportRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null);

  const handleDownload = () => {
    const blob = new Blob([html || 'No report generated'], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `status-report-${projectName.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const fileBaseName = `status-report-${projectName.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}`;

  const handleExportPdf = async () => {
    if (!reportRef.current) return;
    setExporting('pdf');
    try {
      const html2pdf = (await import('html2pdf.js')).default;
      await html2pdf()
        .set({
          margin: [10, 10, 10, 10],
          filename: `${fileBaseName}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        })
        .from(reportRef.current)
        .save();
    } catch (err) {
      console.error('PDF export failed', err);
    } finally {
      setExporting(null);
    }
  };

  const handleExportDocx = async () => {
    if (!html) return;
    setExporting('docx');
    try {
      const blob = await apiService.exportStatusReportDocx(html, projectName);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileBaseName}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('DOCX export failed', err);
    } finally {
      setExporting(null);
    }
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

  const handleStartEdit = useCallback(() => {
    const data = report?.report?.data as ReportData | undefined;
    if (!data) return;
    setEditData(JSON.parse(JSON.stringify(data)));
    setIsEditing(true);
  }, [report]);

  const handleSaveEdit = () => {
    if (!editData) return;
    renderMutation.mutate(editData);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditData(null);
    // Restore original HTML if user had previously saved edits
    if (originalHtml) {
      setReport((prev: any) => ({
        ...prev,
        report: { ...prev.report, html: originalHtml },
      }));
    }
  };

  const updateArea = (index: number, field: keyof RAGArea, value: string) => {
    if (!editData) return;
    const areas = [...editData.areas];
    areas[index] = { ...areas[index], [field]: value };
    setEditData({ ...editData, areas });
  };

  const updateAchievement = (index: number, value: string) => {
    if (!editData) return;
    const achievements = [...editData.achievements];
    achievements[index] = value;
    setEditData({ ...editData, achievements });
  };

  const removeAchievement = (index: number) => {
    if (!editData) return;
    setEditData({ ...editData, achievements: editData.achievements.filter((_, i) => i !== index) });
  };

  const addAchievement = () => {
    if (!editData) return;
    setEditData({ ...editData, achievements: [...editData.achievements, ''] });
  };

  const updatePlanned = (index: number, value: string) => {
    if (!editData) return;
    const plannedActivities = [...editData.plannedActivities];
    plannedActivities[index] = value;
    setEditData({ ...editData, plannedActivities });
  };

  const removePlanned = (index: number) => {
    if (!editData) return;
    setEditData({ ...editData, plannedActivities: editData.plannedActivities.filter((_, i) => i !== index) });
  };

  const addPlanned = () => {
    if (!editData) return;
    setEditData({ ...editData, plannedActivities: [...editData.plannedActivities, ''] });
  };

  const updateAttention = (index: number, field: keyof AttentionItem, value: string) => {
    if (!editData) return;
    const items = [...editData.managementAttention];
    items[index] = { ...items[index], [field]: value };
    setEditData({ ...editData, managementAttention: items });
  };

  const removeAttention = (index: number) => {
    if (!editData) return;
    setEditData({ ...editData, managementAttention: editData.managementAttention.filter((_, i) => i !== index) });
  };

  const addAttention = () => {
    if (!editData) return;
    setEditData({
      ...editData,
      managementAttention: [...editData.managementAttention, {
        ref: `MA-${String(editData.managementAttention.length + 1).padStart(3, '0')}`,
        matter: '',
        raised: new Date().toISOString().slice(0, 10),
        owner: '',
        dateNeeded: '',
        impactIfDelayed: '',
      }],
    });
  };

  const schedules = schedulesData?.schedules || [];
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const inputClass = 'w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white';
  const labelClass = 'block text-xs font-medium text-gray-600 dark:text-gray-400 mb-0.5';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary-500" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Status Report — {projectName}</h2>
          </div>
          <div className="flex items-center gap-2">
            {html && !isSample && !isEditing && (
              <>
                <button onClick={handleStartEdit} className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                  <Pencil className="w-3 h-3" />
                  Edit
                </button>
                <button onClick={handleExportPdf} disabled={!!exporting} className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50">
                  <FileDown className="w-3 h-3" />
                  {exporting === 'pdf' ? 'Exporting...' : 'PDF'}
                </button>
                <button onClick={handleExportDocx} disabled={!!exporting} className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50">
                  <FileDown className="w-3 h-3" />
                  {exporting === 'docx' ? 'Exporting...' : 'Word'}
                </button>
                <button onClick={handleDownload} className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                  <Download className="w-3 h-3" />
                  HTML
                </button>
              </>
            )}
            {isEditing && (
              <>
                <button onClick={handleSaveEdit} disabled={renderMutation.isPending} className="flex items-center gap-1 px-2 py-1 text-xs text-white bg-primary-600 hover:bg-primary-700 rounded disabled:opacity-50">
                  <Save className="w-3 h-3" />
                  {renderMutation.isPending ? 'Saving...' : 'Save'}
                </button>
                <button onClick={handleCancelEdit} className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                  <RotateCcw className="w-3 h-3" />
                  Cancel
                </button>
              </>
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
              {isSample && (
                <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
                  <div className="flex items-start gap-2">
                    <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Sample Report</p>
                      <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                        This is a sample report with demo data. Upgrade to a paid plan to generate AI-powered status reports using your actual project data, email them to stakeholders, and schedule recurring delivery.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              {mutation.isPending ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mb-3" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">Generating status report...</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">This may take a few seconds</p>
                </div>
              ) : mutation.isError ? (
                <div className="text-center py-8">
                  <p className="text-sm text-red-500">Failed to generate report</p>
                  <button onClick={() => mutation.mutate()} className="mt-2 text-xs text-primary-600 dark:text-primary-400 hover:underline">Try again</button>
                </div>
              ) : isEditing && editData ? (
                <div className="space-y-5">
                  {/* Executive Summary */}
                  <div>
                    <label className={labelClass}>Executive Summary</label>
                    <textarea
                      value={editData.executiveSummary}
                      onChange={e => setEditData({ ...editData, executiveSummary: e.target.value })}
                      rows={4}
                      className={inputClass}
                    />
                  </div>

                  {/* RAG Areas */}
                  <div>
                    <label className={labelClass}>Overall Status (RAG)</label>
                    <div className="space-y-2 mt-1">
                      {editData.areas.map((area, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <span className="text-xs text-gray-700 dark:text-gray-300 w-40 flex-shrink-0 pt-1 font-medium">{area.name}</span>
                          <select
                            value={area.status}
                            onChange={e => updateArea(i, 'status', e.target.value)}
                            className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white w-20"
                            style={{ backgroundColor: RAG_COLORS[area.status] + '60' }}
                          >
                            {RAG_OPTIONS.map(o => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
                          </select>
                          <input
                            type="text"
                            value={area.comments}
                            onChange={e => updateArea(i, 'comments', e.target.value)}
                            placeholder="Commentary"
                            className={inputClass + ' flex-1'}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Achievements */}
                  <div>
                    <div className="flex items-center justify-between">
                      <label className={labelClass}>Achievements This Period</label>
                      <button onClick={addAchievement} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">+ Add</button>
                    </div>
                    <div className="space-y-1 mt-1">
                      {editData.achievements.map((a, i) => (
                        <div key={i} className="flex items-center gap-1">
                          <input type="text" value={a} onChange={e => updateAchievement(i, e.target.value)} className={inputClass + ' flex-1'} />
                          <button onClick={() => removeAchievement(i)} className="p-1 text-gray-400 hover:text-red-500" title="Remove"><X className="w-3 h-3" /></button>
                        </div>
                      ))}
                      {editData.achievements.length === 0 && (
                        <p className="text-xs text-gray-400 italic">No achievements listed</p>
                      )}
                    </div>
                  </div>

                  {/* Planned Activities */}
                  <div>
                    <div className="flex items-center justify-between">
                      <label className={labelClass}>Planned Activities — Next Period</label>
                      <button onClick={addPlanned} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">+ Add</button>
                    </div>
                    <div className="space-y-1 mt-1">
                      {editData.plannedActivities.map((a, i) => (
                        <div key={i} className="flex items-center gap-1">
                          <input type="text" value={a} onChange={e => updatePlanned(i, e.target.value)} className={inputClass + ' flex-1'} />
                          <button onClick={() => removePlanned(i)} className="p-1 text-gray-400 hover:text-red-500" title="Remove"><X className="w-3 h-3" /></button>
                        </div>
                      ))}
                      {editData.plannedActivities.length === 0 && (
                        <p className="text-xs text-gray-400 italic">No planned activities listed</p>
                      )}
                    </div>
                  </div>

                  {/* Management Attention */}
                  <div>
                    <div className="flex items-center justify-between">
                      <label className={labelClass}>For Management Attention</label>
                      <button onClick={addAttention} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">+ Add</button>
                    </div>
                    <div className="space-y-2 mt-1">
                      {editData.managementAttention.map((item, i) => (
                        <div key={i} className="p-2 border border-gray-200 dark:border-gray-600 rounded-lg space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{item.ref}</span>
                            <button onClick={() => removeAttention(i)} className="p-0.5 text-gray-400 hover:text-red-500" title="Remove"><X className="w-3 h-3" /></button>
                          </div>
                          <input type="text" value={item.matter} onChange={e => updateAttention(i, 'matter', e.target.value)} placeholder="Matter requiring attention" className={inputClass} />
                          <div className="grid grid-cols-3 gap-1">
                            <input type="text" value={item.owner} onChange={e => updateAttention(i, 'owner', e.target.value)} placeholder="Owner" className={inputClass} />
                            <input type="text" value={item.dateNeeded} onChange={e => updateAttention(i, 'dateNeeded', e.target.value)} placeholder="Date needed" className={inputClass} />
                            <input type="text" value={item.impactIfDelayed} onChange={e => updateAttention(i, 'impactIfDelayed', e.target.value)} placeholder="Impact if delayed" className={inputClass} />
                          </div>
                        </div>
                      ))}
                      {editData.managementAttention.length === 0 && (
                        <p className="text-xs text-gray-400 italic">No items requiring management attention</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : html ? (
                <div
                  ref={reportRef}
                  className={`status-report-container ${isSample ? 'opacity-80' : ''}`}
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
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                This will email the current report (including any edits) to the specified recipients.
              </p>
              {emailSent && (
                <div className="text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-3 py-2 rounded-lg">
                  Status report emailed successfully!
                </div>
              )}
              <button
                onClick={handleEmailSend}
                disabled={emailMutation.isPending || !emailRecipients.trim() || !html}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Mail className="w-4 h-4" />
                {emailMutation.isPending ? 'Sending...' : 'Send Report'}
              </button>
            </div>
          )}

          {tab === 'schedule' && (
            <div className="space-y-4">
              {/* Existing schedules */}
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

              {/* Create new schedule */}
              <div className="space-y-3 pt-2">
                <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">New Schedule</h4>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Frequency</label>
                    <select
                      value={scheduleFrequency}
                      onChange={e => setScheduleFrequency(e.target.value as any)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
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
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
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
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Time</label>
                    <input
                      type="time"
                      value={scheduleTime}
                      onChange={e => setScheduleTime(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
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
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
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
