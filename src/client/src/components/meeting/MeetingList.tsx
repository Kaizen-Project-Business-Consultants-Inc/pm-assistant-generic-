import React from 'react';
import { Plus, Calendar, Clock, MapPin, Users, MoreVertical } from 'lucide-react';

interface Meeting {
  id: string;
  title: string;
  meetingType: string;
  scheduledDate: string;
  durationMinutes: number;
  location: string | null;
  attendees: string[];
  status: string;
}

interface MeetingListProps {
  meetings: Meeting[];
  isLoading?: boolean;
  onSelect: (meeting: Meeting) => void;
  onNewMeeting: () => void;
  onComplete?: (id: string) => void;
  onCancel?: (id: string) => void;
  onDelete?: (id: string) => void;
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
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

export const MeetingList: React.FC<MeetingListProps> = ({
  meetings,
  isLoading,
  onSelect,
  onNewMeeting,
  onComplete,
  onCancel,
  onDelete,
}) => {
  const [menuOpen, setMenuOpen] = React.useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary-500" />
          Meetings
        </h3>
        <button onClick={onNewMeeting} className="btn btn-primary text-xs px-3 py-1.5 flex items-center gap-1">
          <Plus className="w-3.5 h-3.5" /> New Meeting
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">Loading meetings...</div>
      ) : meetings.length === 0 ? (
        <div className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center italic">
          No meetings yet. Create one to get started.
        </div>
      ) : (
        <div className="space-y-2">
          {meetings.map(meeting => (
            <div
              key={meeting.id}
              onClick={() => onSelect(meeting)}
              className="card p-3 cursor-pointer hover:shadow-md transition-shadow border border-gray-200 dark:border-gray-700"
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(meeting); } }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {meeting.title}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${STATUS_STYLES[meeting.status] || ''}`}>
                      {meeting.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDate(meeting.scheduledDate)}
                    </span>
                    <span>{meeting.durationMinutes} min</span>
                    <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                      {TYPE_LABELS[meeting.meetingType] || meeting.meetingType}
                    </span>
                    {meeting.location && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {meeting.location}
                      </span>
                    )}
                    {meeting.attendees.length > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {meeting.attendees.length}
                      </span>
                    )}
                  </div>
                </div>
                <div className="relative">
                  <button
                    onClick={e => { e.stopPropagation(); setMenuOpen(menuOpen === meeting.id ? null : meeting.id); }}
                    className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                  >
                    <MoreVertical className="w-4 h-4 text-gray-400" />
                  </button>
                  {menuOpen === meeting.id && (
                    <div className="absolute right-0 top-8 z-10 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 w-36">
                      {meeting.status !== 'completed' && meeting.status !== 'cancelled' && onComplete && (
                        <button
                          onClick={e => { e.stopPropagation(); onComplete(meeting.id); setMenuOpen(null); }}
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700"
                        >
                          Mark Complete
                        </button>
                      )}
                      {meeting.status !== 'completed' && meeting.status !== 'cancelled' && onCancel && (
                        <button
                          onClick={e => { e.stopPropagation(); onCancel(meeting.id); setMenuOpen(null); }}
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700"
                        >
                          Cancel Meeting
                        </button>
                      )}
                      {onDelete && (
                        <button
                          onClick={e => { e.stopPropagation(); onDelete(meeting.id); setMenuOpen(null); }}
                          className="w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
