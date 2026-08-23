import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Mic,
  MicOff,
  ChevronDown,
  Clock,
  FileText,
  Send,
  Lock,
  Upload,
  Shield,
  Mail,
  Loader2,
  X,
  Search,
  ChevronRight,
  Brain,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import { apiService } from '../services/api';
import { MeetingResultPanel } from '../components/meeting/MeetingResultPanel';
import { MeetingToRaidModal } from '../components/meeting/MeetingToRaidModal';
import { mapAnalysisToRaidCandidates, RaidCandidate } from '../utils/meetingToRaidMapper';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Project {
  id: string;
  name: string;
}

interface Schedule {
  id: string;
  name: string;
}

interface HistoryEntry {
  id: string;
  summary: string;
  createdAt: string;
  projectId?: string;
  meetingId?: string;
  actionItems?: any[];
  decisions?: any[];
  risks?: any[];
  taskUpdates?: any[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

function countRaidItems(entry: any): { R: number; I: number; A: number; D: number } {
  return {
    R: (entry.risks || []).length,
    I: 0, // issues extracted from risks with severity
    A: (entry.actionItems || []).length,
    D: (entry.decisions || []).length,
  };
}

// ---------------------------------------------------------------------------
// Speech Recognition types
// ---------------------------------------------------------------------------

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

function useContinuousVoice(onTranscript: (text: string) => void) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const recRef = useRef<SpeechRecognitionInstance | null>(null);
  const wantListening = useRef(false);
  const callbackRef = useRef(onTranscript);
  callbackRef.current = onTranscript;

  useEffect(() => {
    const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    setIsSupported(!!Ctor);
    if (!Ctor) return;

    const rec: SpeechRecognitionInstance = new (Ctor as SpeechRecognitionConstructor)();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = 'en-US';

    rec.onresult = (event: SpeechRecognitionEvent) => {
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const text = result[0].transcript.trim();
          if (text) callbackRef.current(text);
        }
      }
    };

    rec.onend = () => {
      if (wantListening.current) {
        try { rec.start(); } catch { setIsListening(false); wantListening.current = false; }
      } else {
        setIsListening(false);
      }
    };

    rec.onerror = (e: Event & { error?: string }) => {
      if ((e as any).error === 'no-speech') return;
      setIsListening(false);
      wantListening.current = false;
    };

    recRef.current = rec;
    return () => { try { rec.abort(); } catch {} recRef.current = null; wantListening.current = false; };
  }, []);

  const toggle = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    if (wantListening.current) {
      wantListening.current = false;
      try { rec.stop(); } catch {}
      setIsListening(false);
    } else {
      wantListening.current = true;
      try { rec.start(); setIsListening(true); } catch { wantListening.current = false; }
    }
  }, []);

  return { isSupported, isListening, toggle };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type InputMode = 'paste' | 'upload';

export const MeetingMinutesPage: React.FC = () => {
  const queryClient = useQueryClient();

  // Project & schedule selectors
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>('');

  // Input state
  const [inputMode, setInputMode] = useState<InputMode>('paste');
  const [transcript, setTranscript] = useState('');
  const [meetingTitle, setMeetingTitle] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Analysis state
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [isSample, setIsSample] = useState(false);

  // RAID state
  const [raidModalOpen, setRaidModalOpen] = useState(false);
  const [raidCandidates, setRaidCandidates] = useState<RaidCandidate[]>([]);
  const [raidAnalysisId, setRaidAnalysisId] = useState<string | null>(null);

  // Send minutes state
  const [sendMinutesAnalysisId, setSendMinutesAnalysisId] = useState<string | null>(null);
  const [minutesEmails, setMinutesEmails] = useState('');
  const [sendMinutesMeetingId, setSendMinutesMeetingId] = useState<string | null>(null);

  // History state
  const [historySearch, setHistorySearch] = useState('');
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

  const handleVoiceResult = useCallback((text: string) => {
    setTranscript(prev => prev ? prev + ' ' + text : text);
  }, []);
  const { isSupported: micSupported, isListening, toggle: toggleMic } = useContinuousVoice(handleVoiceResult);

  // ---- Queries ----

  const { data: projectsData, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiService.getProjects(),
  });

  const { data: schedulesData, isLoading: schedulesLoading } = useQuery({
    queryKey: ['schedules', selectedProjectId],
    queryFn: () => apiService.getSchedules(selectedProjectId),
    enabled: !!selectedProjectId,
  });

  const { data: historyData } = useQuery({
    queryKey: ['meetingHistory', selectedProjectId],
    queryFn: () => apiService.getMeetingHistory(selectedProjectId),
    enabled: !!selectedProjectId,
  });

  const projects: Project[] = projectsData?.data || projectsData?.projects || [];
  const schedules: Schedule[] = schedulesData?.schedules || [];
  const history: HistoryEntry[] = historyData?.history || historyData?.analyses || [];

  const filteredHistory = historySearch.trim()
    ? history.filter(h => (h.summary || '').toLowerCase().includes(historySearch.toLowerCase()))
    : history;

  // ---- Mutations ----

  const analyzeMutation = useMutation({
    mutationFn: () =>
      apiService.analyzeMeetingTranscript({
        transcript,
        projectId: selectedProjectId,
        scheduleId: selectedScheduleId,
      }),
    onSuccess: (data: any) => {
      setIsSample(data?.sample || false);
      const result = data?.data || data?.analysis || data;
      setAnalysisResult(result);
      queryClient.invalidateQueries({ queryKey: ['meetingHistory', selectedProjectId] });

      // Fire-and-forget: create a meeting record for traceability
      const title = meetingTitle.trim() || `Meeting - ${new Date().toLocaleDateString()}`;
      apiService.createMeeting({
        projectId: selectedProjectId,
        title,
        meetingType: 'ad_hoc',
        status: 'completed',
        scheduledDate: new Date().toISOString(),
        durationMinutes: 60,
      }).catch(() => {});
    },
  });

  const uploadTranscriptMutation = useMutation({
    mutationFn: (file: File) => apiService.uploadTranscriptFile(file, selectedProjectId, selectedScheduleId || ''),
    onSuccess: (data: any) => {
      setUploadError(null);
      const result = data?.data || data?.analysis || data;
      setIsSample(data?.sample || false);
      setAnalysisResult(result);
      queryClient.invalidateQueries({ queryKey: ['meetingHistory', selectedProjectId] });

      // Fire-and-forget: create a meeting record
      const title = meetingTitle.trim() || `Meeting - ${new Date().toLocaleDateString()}`;
      apiService.createMeeting({
        projectId: selectedProjectId,
        title,
        meetingType: 'ad_hoc',
        status: 'completed',
        scheduledDate: new Date().toISOString(),
        durationMinutes: 60,
      }).catch(() => {});
    },
    onError: (err: any) => {
      setUploadError(err?.response?.data?.error || 'Failed to process transcript');
    },
  });

  const applyMutation = useMutation({
    mutationFn: (selectedIndices: number[]) =>
      apiService.applyMeetingChanges(
        analysisResult?.id || analysisResult?.analysisId,
        selectedIndices
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meetingHistory', selectedProjectId] });
    },
  });

  const sendToRaidMutation = useMutation({
    mutationFn: ({ analysisId, items }: { analysisId: string; items: RaidCandidate[] }) =>
      apiService.sendToRaid(analysisId, selectedProjectId, items.map(c => ({
        type: c.type,
        title: c.title,
        description: c.description,
        category: c.category,
        severity: c.severity,
        probability: c.probability,
        impact: c.impact,
        mitigationPlan: c.mitigationPlan,
        dueDate: c.dueDate,
        rationale: c.rationale,
        decidedBy: c.decidedBy,
        actionType: c.actionType,
        impactAssessment: c.impactAssessment,
      }))),
    onSuccess: () => {
      setRaidModalOpen(false);
      setRaidCandidates([]);
      setRaidAnalysisId(null);
      queryClient.invalidateQueries({ queryKey: ['risks', selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ['riskStats', selectedProjectId] });
    },
  });

  const sendMinutesMutation = useMutation({
    mutationFn: ({ meetingId, analysisId, emails }: { meetingId: string; analysisId: string; emails: string[] }) =>
      apiService.sendMeetingMinutes(meetingId, analysisId, emails),
    onSuccess: () => {
      setSendMinutesAnalysisId(null);
      setSendMinutesMeetingId(null);
      setMinutesEmails('');
    },
  });

  // ---- Handlers ----

  const handleProjectChange = (pid: string) => {
    setSelectedProjectId(pid);
    setSelectedScheduleId('');
    setAnalysisResult(null);
  };

  const handleAnalyze = () => {
    if (!transcript.trim()) return;
    analyzeMutation.mutate();
  };

  const handleApply = (indices: number[]) => {
    applyMutation.mutate(indices);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadTranscriptMutation.mutate(file);
    }
    e.target.value = '';
  };

  const handleSendToRaid = async (analysis: any) => {
    const candidates = mapAnalysisToRaidCandidates(analysis);
    if (candidates.length === 0) return;

    try {
      const titles = candidates.map(c => c.title);
      const res = await apiService.checkRaidDuplicates(analysis.id, selectedProjectId, titles);
      const dupes = res.data || {};
      for (const c of candidates) {
        const key = c.title.toLowerCase().trim();
        if (dupes[key]) {
          c.duplicate = dupes[key];
        }
      }
    } catch {
      // proceed without duplicate info
    }

    setRaidAnalysisId(analysis.id);
    setRaidCandidates(candidates);
    setRaidModalOpen(true);
  };

  const handleRaidImport = (items: RaidCandidate[]) => {
    if (!raidAnalysisId) return;
    sendToRaidMutation.mutate({ analysisId: raidAnalysisId, items });
  };

  const handleHistoryClick = (entry: HistoryEntry) => {
    if (expandedHistoryId === entry.id) {
      setExpandedHistoryId(null);
    } else {
      setExpandedHistoryId(entry.id);
      setAnalysisResult(entry);
    }
  };

  const handleSendMinutes = () => {
    if (!sendMinutesAnalysisId || !sendMinutesMeetingId) return;
    const emails = minutesEmails
      .split(/[,;\n]/)
      .map(e => e.trim())
      .filter(e => e.length > 0);
    if (emails.length === 0) return;
    sendMinutesMutation.mutate({ meetingId: sendMinutesMeetingId, analysisId: sendMinutesAnalysisId, emails });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Brain className="w-6 h-6 text-primary-500" />
          Meeting Intelligence
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Analyze meeting transcripts with AI and import findings into your RAID log.
        </p>
      </div>

      {/* Project selector */}
      <div className="max-w-xs">
        <label htmlFor="meeting-project" className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
          Project
        </label>
        <div className="relative">
          <select
            id="meeting-project"
            value={selectedProjectId}
            onChange={(e) => handleProjectChange(e.target.value)}
            className="input w-full appearance-none pr-8"
            disabled={projectsLoading}
          >
            <option value="">Select a project...</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
        </div>
      </div>

      {!selectedProjectId ? (
        <div className="text-center py-16">
          <Brain className="mx-auto mb-3 h-12 w-12 text-gray-300 dark:text-gray-600" />
          <p className="text-sm text-gray-400 dark:text-gray-500">Select a project to get started.</p>
        </div>
      ) : (
        <>
          {/* Transcript Input Card */}
          <div className="card space-y-4">
            {/* Input mode tabs */}
            <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-700 -mx-4 px-4">
              <button
                onClick={() => setInputMode('paste')}
                className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                  inputMode === 'paste'
                    ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
              >
                <FileText className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
                Paste
              </button>
              <button
                onClick={() => setInputMode('upload')}
                className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                  inputMode === 'upload'
                    ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
              >
                <Upload className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
                Upload
              </button>
              <div className="ml-auto flex gap-2">
                <button
                  disabled
                  title="Coming Soon"
                  className="px-3 py-1.5 text-[10px] font-medium text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-700 rounded-full cursor-not-allowed"
                >
                  Read.ai
                </button>
                <button
                  disabled
                  title="Coming Soon"
                  className="px-3 py-1.5 text-[10px] font-medium text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-700 rounded-full cursor-not-allowed"
                >
                  Otter.ai
                </button>
              </div>
            </div>

            {/* Meeting title (optional) */}
            <div>
              <label htmlFor="meeting-title" className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                Meeting Title <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                id="meeting-title"
                type="text"
                value={meetingTitle}
                onChange={(e) => setMeetingTitle(e.target.value)}
                placeholder="e.g., Sprint Planning - Week 34"
                className="input w-full"
              />
            </div>

            {/* Paste mode */}
            {inputMode === 'paste' && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="transcript" className="block text-xs font-medium text-gray-600 dark:text-gray-300">
                    Meeting Transcript
                  </label>
                  {micSupported && (
                    <button
                      type="button"
                      onClick={toggleMic}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                        isListening
                          ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 animate-pulse'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                      }`}
                      title={isListening ? 'Stop recording' : 'Start voice recording'}
                    >
                      {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                      {isListening ? 'Stop Recording' : 'Record'}
                    </button>
                  )}
                </div>
                {isListening && (
                  <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-400">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    Listening — speak into your microphone. Text will appear below.
                  </div>
                )}
                <textarea
                  id="transcript"
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  placeholder={isListening ? 'Listening... speak now' : 'Paste your meeting notes or transcript here, or click Record to use your microphone...'}
                  className="input w-full resize-y"
                  style={{ minHeight: '200px' }}
                  rows={8}
                />
              </div>
            )}

            {/* Upload mode */}
            {inputMode === 'upload' && (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.vtt,.srt"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const file = e.dataTransfer.files?.[0];
                    if (file) uploadTranscriptMutation.mutate(file);
                  }}
                  className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-10 text-center cursor-pointer hover:border-primary-400 dark:hover:border-primary-500 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
                >
                  {uploadTranscriptMutation.isPending ? (
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
                      <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">Analyzing transcript...</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <Upload className="w-8 h-8 text-gray-400 dark:text-gray-500" />
                      <div>
                        <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">
                          Drop a transcript file here, or click to browse
                        </p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                          Supported formats: .txt (Otter.ai), .vtt (Teams/Zoom), .srt
                        </p>
                      </div>
                    </div>
                  )}
                </div>
                {uploadError && (
                  <div className="mt-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-xs text-red-700 dark:text-red-300 flex items-center justify-between">
                    <span>{uploadError}</span>
                    <button onClick={() => setUploadError(null)} className="ml-2"><X className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </div>
            )}

            {/* Schedule selector + Analyze button (paste mode only) */}
            {inputMode === 'paste' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="meeting-schedule" className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                    Schedule
                  </label>
                  <div className="relative">
                    <select
                      id="meeting-schedule"
                      value={selectedScheduleId}
                      onChange={(e) => setSelectedScheduleId(e.target.value)}
                      className="input w-full appearance-none pr-8"
                      disabled={!selectedProjectId || schedulesLoading}
                    >
                      <option value="">
                        {!selectedProjectId ? 'Select a project first' : schedulesLoading ? 'Loading...' : 'Select a schedule...'}
                      </option>
                      {schedules.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
                  </div>
                </div>

                <div className="sm:col-span-2 flex items-end">
                  <button
                    onClick={handleAnalyze}
                    disabled={!transcript.trim() || analyzeMutation.isPending}
                    className="btn btn-primary flex items-center gap-2 w-full sm:w-auto justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {analyzeMutation.isPending ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        Analyze
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Upload mode: schedule selector row */}
            {inputMode === 'upload' && (
              <div className="max-w-xs">
                <label htmlFor="upload-schedule" className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                  Schedule
                </label>
                <div className="relative">
                  <select
                    id="upload-schedule"
                    value={selectedScheduleId}
                    onChange={(e) => setSelectedScheduleId(e.target.value)}
                    className="input w-full appearance-none pr-8"
                    disabled={!selectedProjectId || schedulesLoading}
                  >
                    <option value="">
                      {schedulesLoading ? 'Loading...' : 'Select a schedule...'}
                    </option>
                    {schedules.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
                </div>
              </div>
            )}

            {analyzeMutation.isError && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                Failed to analyze transcript. Please try again.
              </div>
            )}

            {uploadTranscriptMutation.isSuccess && inputMode === 'upload' && (
              <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-3 text-xs text-green-700 dark:text-green-300">
                Transcript analyzed successfully. See results below.
              </div>
            )}
          </div>

          {/* Analysis Results */}
          {analysisResult && (
            <div className="space-y-4">
              {isSample && (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
                  <div className="flex items-start gap-2">
                    <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Sample Meeting Analysis</p>
                      <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                        This is a sample analysis with demo data. Upgrade to a paid plan to analyze your actual meeting transcripts.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary-500" />
                  Analysis Results
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSendToRaid(analysisResult)}
                    disabled={isSample}
                    className="btn btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={isSample ? 'Not available for sample analyses' : 'Import items to RAID log'}
                  >
                    <Shield className="w-3.5 h-3.5 text-indigo-500" />
                    Send to RAID
                  </button>
                  {analysisResult.meetingId && (
                    <button
                      onClick={() => {
                        setSendMinutesAnalysisId(analysisResult.id);
                        setSendMinutesMeetingId(analysisResult.meetingId);
                        setMinutesEmails('');
                      }}
                      className="btn btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
                    >
                      <Mail className="w-3.5 h-3.5" />
                      Send Minutes
                    </button>
                  )}
                </div>
              </div>

              <MeetingResultPanel
                analysis={analysisResult}
                onApply={isSample ? () => {} : handleApply}
                isApplying={applyMutation.isPending}
              />

              {applyMutation.isSuccess && (
                <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
                  Changes applied successfully.
                </div>
              )}
              {applyMutation.isError && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  Failed to apply changes. Please try again.
                </div>
              )}
            </div>
          )}

          {/* Analysis History */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                Analysis History
              </h2>
              {history.length > 0 && (
                <div className="relative w-48">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input
                    type="text"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder="Search analyses..."
                    className="input w-full pl-8 text-xs py-1.5"
                  />
                </div>
              )}
            </div>

            {history.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500 italic py-4 text-center">
                No previous analyses. Paste or upload a transcript to get started.
              </p>
            ) : filteredHistory.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500 italic py-4 text-center">
                No analyses match your search.
              </p>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {filteredHistory.map((entry) => {
                  const counts = countRaidItems(entry);
                  const isExpanded = expandedHistoryId === entry.id;

                  return (
                    <div key={entry.id}>
                      <button
                        onClick={() => handleHistoryClick(entry)}
                        className="w-full text-left flex items-center gap-3 py-3 px-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors rounded-lg"
                      >
                        <ChevronRight className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white line-clamp-1">
                            {entry.summary || 'Meeting analysis'}
                          </p>
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDate(entry.createdAt)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 text-[10px] font-medium">
                          {counts.R > 0 && (
                            <span className="flex items-center gap-0.5 text-red-600 dark:text-red-400" title="Risks">
                              <AlertTriangle className="w-3 h-3" /> {counts.R}
                            </span>
                          )}
                          {counts.A > 0 && (
                            <span className="flex items-center gap-0.5 text-blue-600 dark:text-blue-400" title="Actions">
                              <CheckCircle className="w-3 h-3" /> {counts.A}
                            </span>
                          )}
                          {counts.D > 0 && (
                            <span className="flex items-center gap-0.5 text-purple-600 dark:text-purple-400" title="Decisions">
                              <Shield className="w-3 h-3" /> {counts.D}
                            </span>
                          )}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="pb-3 px-2 pl-9">
                          <div className="flex gap-2 mb-3">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleSendToRaid(entry); }}
                              className="text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 flex items-center gap-1"
                            >
                              <Shield className="w-3 h-3" /> Send to RAID
                            </button>
                            {entry.meetingId && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSendMinutesAnalysisId(entry.id);
                                  setSendMinutesMeetingId(entry.meetingId || null);
                                  setMinutesEmails('');
                                }}
                                className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
                              >
                                <Mail className="w-3 h-3" /> Send Minutes
                              </button>
                            )}
                          </div>
                          <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                            {entry.summary && <p className="line-clamp-3">{entry.summary}</p>}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Send to RAID Modal */}
      <MeetingToRaidModal
        isOpen={raidModalOpen}
        onClose={() => { setRaidModalOpen(false); setRaidCandidates([]); setRaidAnalysisId(null); }}
        onImport={handleRaidImport}
        candidates={raidCandidates}
        importing={sendToRaidMutation.isPending}
      />

      {/* Send to RAID success toast */}
      {sendToRaidMutation.isSuccess && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-3 text-xs text-green-700 dark:text-green-300 shadow-lg">
          {(sendToRaidMutation.data as any)?.data?.imported || 0} items imported to RAID log
        </div>
      )}

      {/* Send to RAID error toast */}
      {sendToRaidMutation.isError && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-xs text-red-700 dark:text-red-300 shadow-lg">
          Failed to import items to RAID log
        </div>
      )}

      {/* Send Minutes Modal */}
      {sendMinutesAnalysisId && sendMinutesMeetingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setSendMinutesAnalysisId(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-5 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Mail className="w-4 h-4" /> Send Meeting Minutes
              </h3>
              <button onClick={() => setSendMinutesAnalysisId(null)}><X className="w-4 h-4 text-gray-400" /></button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              Enter recipient email addresses (comma or newline separated):
            </p>
            <textarea
              value={minutesEmails}
              onChange={e => setMinutesEmails(e.target.value)}
              className="input w-full resize-y text-sm mb-3"
              rows={3}
              placeholder="john@example.com, jane@example.com"
            />
            {sendMinutesMutation.isError && (
              <p className="text-xs text-red-600 mb-2">
                {(sendMinutesMutation.error as any)?.response?.data?.error || 'Failed to send minutes'}
              </p>
            )}
            {sendMinutesMutation.isSuccess && (
              <p className="text-xs text-green-600 mb-2">Minutes sent successfully!</p>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setSendMinutesAnalysisId(null)} className="btn btn-secondary text-xs px-3 py-1.5">
                Cancel
              </button>
              <button
                onClick={handleSendMinutes}
                disabled={sendMinutesMutation.isPending || !minutesEmails.trim()}
                className="btn btn-primary text-xs px-3 py-1.5 flex items-center gap-1"
              >
                {sendMinutesMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                {sendMinutesMutation.isPending ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
