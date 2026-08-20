import React, { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Calendar,
  Clock,
  MapPin,
  Users,
  FileText,
  Edit2,
  Link,
  Upload,
  Mail,
  Loader2,
  X,
} from 'lucide-react';
import { apiService } from '../../services/api';
import { MeetingActionItemList } from './MeetingActionItemList';

interface MeetingDetailPanelProps {
  meetingId: string;
  meeting: any;
  analyses: any[];
  onBack: () => void;
  onEdit: () => void;
  onViewAnalysis?: (analysis: any) => void;
  projectId: string;
  scheduleId?: string;
}

const TYPE_LABELS: Record<string, string> = {
  standup: 'Standup',
  sprint_review: 'Sprint Review',
  sprint_retro: 'Retro',
  planning: 'Planning',
  steering: 'Steering',
  kickoff: 'Kickoff',
  ad_hoc: 'Ad Hoc',
};

const STATUS_STYLES: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  in_progress: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  cancelled: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
};

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

export const MeetingDetailPanel: React.FC<MeetingDetailPanelProps> = ({
  meetingId,
  meeting,
  analyses,
  onBack,
  onEdit,
  onViewAnalysis,
  projectId,
  scheduleId,
}) => {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState(meeting.notes || '');
  const [notesEditing, setNotesEditing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [sendMinutesAnalysisId, setSendMinutesAnalysisId] = useState<string | null>(null);
  const [minutesEmails, setMinutesEmails] = useState('');

  const saveNotesMutation = useMutation({
    mutationFn: () => apiService.updateMeeting(meetingId, { notes }),
    onSuccess: () => {
      setNotesEditing(false);
      queryClient.invalidateQueries({ queryKey: ['meeting', meetingId] });
    },
  });

  const importActionsMutation = useMutation({
    mutationFn: (analysisId: string) => apiService.importMeetingActions(meetingId, analysisId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meeting', meetingId] });
      queryClient.invalidateQueries({ queryKey: ['meetingActionItems'] });
    },
  });

  const uploadTranscriptMutation = useMutation({
    mutationFn: (file: File) => apiService.uploadTranscriptFile(file, projectId, scheduleId || '', meetingId),
    onSuccess: () => {
      setUploadError(null);
      queryClient.invalidateQueries({ queryKey: ['meeting', meetingId] });
      queryClient.invalidateQueries({ queryKey: ['meetingHistory', projectId] });
    },
    onError: (err: any) => {
      setUploadError(err?.response?.data?.error || 'Failed to process transcript');
    },
  });

  const sendMinutesMutation = useMutation({
    mutationFn: ({ analysisId, emails }: { analysisId: string; emails: string[] }) =>
      apiService.sendMeetingMinutes(meetingId, analysisId, emails),
    onSuccess: () => {
      setSendMinutesAnalysisId(null);
      setMinutesEmails('');
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadTranscriptMutation.mutate(file);
    }
    e.target.value = '';
  };

  const handleSendMinutes = () => {
    if (!sendMinutesAnalysisId) return;
    const emails = minutesEmails
      .split(/[,;\n]/)
      .map(e => e.trim())
      .filter(e => e.length > 0);
    if (emails.length === 0) return;
    sendMinutesMutation.mutate({ analysisId: sendMinutesAnalysisId, emails });
  };

  const agendaItems = meeting.agendaItems || [];
  const attendees = meeting.attendees || [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <button onClick={onBack} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded mt-0.5">
            <ArrowLeft className="w-5 h-5 text-gray-400" />
          </button>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{meeting.title}</h2>
            <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
              <span className={`px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[meeting.status] || ''}`}>
                {meeting.status.replace('_', ' ')}
              </span>
              <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700">
                {TYPE_LABELS[meeting.meetingType] || meeting.meetingType}
              </span>
              <span className="inline-flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {formatDate(meeting.scheduledDate)}
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {meeting.durationMinutes} min
              </span>
              {meeting.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {meeting.location}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.vtt,.srt"
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadTranscriptMutation.isPending || !scheduleId}
            title={!scheduleId ? 'Select a schedule first' : 'Upload transcript (.txt, .vtt, .srt)'}
            className="btn btn-secondary text-xs px-3 py-1.5 flex items-center gap-1"
          >
            {uploadTranscriptMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
            {uploadTranscriptMutation.isPending ? 'Analyzing...' : 'Upload Transcript'}
          </button>
          <button onClick={onEdit} className="btn btn-secondary text-xs px-3 py-1.5 flex items-center gap-1">
            <Edit2 className="w-3.5 h-3.5" /> Edit
          </button>
        </div>
      </div>

      {/* Upload feedback */}
      {uploadTranscriptMutation.isSuccess && (
        <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-3 text-xs text-green-700 dark:text-green-300">
          Transcript analyzed successfully. Check Linked Analyses below.
        </div>
      )}
      {uploadError && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-xs text-red-700 dark:text-red-300 flex items-center justify-between">
          <span>{uploadError}</span>
          <button onClick={() => setUploadError(null)} className="ml-2"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Attendees */}
      {attendees.length > 0 && (
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" /> Attendees ({attendees.length})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {attendees.map((name: string, idx: number) => (
              <span key={idx} className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Agenda */}
      {agendaItems.length > 0 && (
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">Agenda</h3>
          <ol className="space-y-2">
            {agendaItems.map((item: any, idx: number) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="text-xs font-medium text-gray-400 mt-0.5 w-5 text-right">{idx + 1}.</span>
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-gray-900 dark:text-white">{item.title}</span>
                  {(item.presenter || item.durationMinutes) && (
                    <span className="text-xs text-gray-400 ml-2">
                      {item.presenter && `— ${item.presenter}`}
                      {item.durationMinutes && ` (${item.durationMinutes} min)`}
                    </span>
                  )}
                  {item.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{item.description}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Notes */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" /> Notes
          </h3>
          {!notesEditing ? (
            <button onClick={() => setNotesEditing(true)} className="text-xs text-primary-600 hover:text-primary-700">
              Edit
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => saveNotesMutation.mutate()}
                disabled={saveNotesMutation.isPending}
                className="text-xs text-green-600 hover:text-green-700"
              >
                {saveNotesMutation.isPending ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => { setNotes(meeting.notes || ''); setNotesEditing(false); }}
                className="text-xs text-gray-400 hover:text-gray-500"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
        {notesEditing ? (
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="input w-full resize-y text-sm"
            rows={5}
            placeholder="Add meeting notes..."
          />
        ) : (
          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
            {notes || <span className="italic text-gray-400">No notes yet.</span>}
          </p>
        )}
      </div>

      {/* Linked Analyses */}
      {analyses.length > 0 && (
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2 flex items-center gap-1.5">
            <Link className="w-3.5 h-3.5" /> Linked Analyses ({analyses.length})
          </h3>
          <div className="space-y-2">
            {analyses.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-900 dark:text-white line-clamp-1">{a.summary || 'Analysis'}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{a.created_at ? new Date(a.created_at).toLocaleDateString() : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => importActionsMutation.mutate(a.id)}
                    disabled={importActionsMutation.isPending}
                    className="text-xs text-primary-600 hover:text-primary-700 whitespace-nowrap"
                  >
                    {importActionsMutation.isPending ? 'Importing...' : 'Import Actions'}
                  </button>
                  <button
                    onClick={() => { setSendMinutesAnalysisId(a.id); setMinutesEmails(''); }}
                    className="text-xs text-primary-600 hover:text-primary-700 whitespace-nowrap flex items-center gap-1"
                  >
                    <Mail className="w-3 h-3" /> Send Minutes
                  </button>
                  {onViewAnalysis && (
                    <button
                      onClick={() => onViewAnalysis(a)}
                      className="text-xs text-primary-600 hover:text-primary-700"
                    >
                      View
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action Items */}
      <div className="card p-4">
        <MeetingActionItemList
          projectId={projectId}
          meetingId={meetingId}
          showCreateButton
        />
      </div>

      {/* Send Minutes Modal */}
      {sendMinutesAnalysisId && (
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
