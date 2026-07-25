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
} from 'lucide-react';
import { apiService } from '../services/api';
import { MeetingResultPanel } from '../components/meeting/MeetingResultPanel';

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// Speech Recognition types
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
      // Auto-restart if user hasn't toggled off (browser stops after silence)
      if (wantListening.current) {
        try { rec.start(); } catch { setIsListening(false); wantListening.current = false; }
      } else {
        setIsListening(false);
      }
    };

    rec.onerror = (e: Event & { error?: string }) => {
      // 'no-speech' is normal — browser fires it after silence, onend will restart
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

export const MeetingMinutesPage: React.FC = () => {
  const queryClient = useQueryClient();

  // Form state
  const [transcript, setTranscript] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>('');

  // Continuous voice transcription — appends each phrase to the textarea
  const handleVoiceResult = useCallback((text: string) => {
    setTranscript(prev => prev ? prev + ' ' + text : text);
  }, []);
  const { isSupported: micSupported, isListening, toggle: toggleMic } = useContinuousVoice(handleVoiceResult);

  // Analysis result
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [isSample, setIsSample] = useState(false);

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
      setAnalysisResult(data?.data || data?.analysis || data);
      queryClient.invalidateQueries({ queryKey: ['meetingHistory', selectedProjectId] });
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

  const handleProjectChange = (pid: string) => {
    setSelectedProjectId(pid);
    setSelectedScheduleId('');
  };

  const handleAnalyze = () => {
    if (!transcript.trim()) return;
    analyzeMutation.mutate();
  };

  const handleApply = (indices: number[]) => {
    applyMutation.mutate(indices);
  };

  const handleHistoryClick = (entry: HistoryEntry) => {
    // Load the analysis from history into the result panel
    setAnalysisResult(entry);
  };

  return (
    <div className="flex gap-6">
      {/* Main content */}
      <div className="flex-1 space-y-6 min-w-0">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Mic className="w-6 h-6 text-primary-500" />
            Meeting Minutes
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Paste a meeting transcript and let AI extract action items, decisions, risks, and task updates.
          </p>
        </div>

        {/* Input card */}
        <div className="card space-y-4">
          {/* Transcript textarea */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="transcript"
                className="block text-xs font-medium text-gray-600 dark:text-gray-300"
              >
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
              placeholder={isListening ? 'Listening… speak now' : 'Paste your meeting notes or transcript here, or click Record to use your microphone...'}
              className="input w-full resize-y"
              style={{ minHeight: '200px' }}
              rows={8}
            />
          </div>

          {/* Selectors row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Project selector */}
            <div>
              <label
                htmlFor="meeting-project"
                className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1"
              >
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
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
              </div>
            </div>

            {/* Schedule selector */}
            <div>
              <label
                htmlFor="meeting-schedule"
                className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1"
              >
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
                    {!selectedProjectId
                      ? 'Select a project first'
                      : schedulesLoading
                        ? 'Loading…'
                        : 'Select a schedule...'}
                  </option>
                  {schedules.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
              </div>
            </div>

            {/* Analyze button */}
            <div className="flex items-end">
              <button
                onClick={handleAnalyze}
                disabled={!transcript.trim() || analyzeMutation.isPending}
                className="btn btn-primary flex items-center gap-2 w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {analyzeMutation.isPending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Analyzing…
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

          {/* Error */}
          {analyzeMutation.isError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              Failed to analyze transcript. Please try again.
            </div>
          )}
        </div>

        {/* Results */}
        {analysisResult && (
          <div>
            {isSample && (
              <div className="mb-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
                <div className="flex items-start gap-2">
                  <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Sample Meeting Analysis</p>
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                      This is a sample analysis with demo data. Upgrade to a paid plan to analyze your actual meeting transcripts and extract action items, decisions, and risks.
                    </p>
                  </div>
                </div>
              </div>
            )}
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary-500" />
              Analysis Results
            </h2>
            <MeetingResultPanel
              analysis={analysisResult}
              onApply={isSample ? () => {} : handleApply}
              isApplying={applyMutation.isPending}
            />

            {/* Apply success/error feedback */}
            {applyMutation.isSuccess && (
              <div className="mt-3 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
                Changes applied successfully.
              </div>
            )}
            {applyMutation.isError && (
              <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                Failed to apply changes. Please try again.
              </div>
            )}
          </div>
        )}
      </div>

      {/* History sidebar */}
      <div className="w-72 flex-shrink-0 hidden lg:block">
        <div className="card sticky top-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-400 dark:text-gray-500" />
            Analysis History
          </h2>

          {!selectedProjectId ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 italic">Select a project to see history.</p>
          ) : history.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 italic">No previous analyses.</p>
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {history.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => handleHistoryClick(entry)}
                  className="w-full text-left rounded-lg border border-gray-200 dark:border-gray-700 p-3 hover:bg-gray-50 dark:hover:bg-gray-700 hover:shadow-sm dark:shadow-gray-900/30 transition-all"
                >
                  <p className="text-xs font-medium text-gray-900 dark:text-white line-clamp-2">
                    {entry.summary || 'Meeting analysis'}
                  </p>
                  {entry.createdAt && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDate(entry.createdAt)}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
