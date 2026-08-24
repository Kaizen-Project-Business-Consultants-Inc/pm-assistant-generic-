import React, { useState } from 'react';
import { X, Loader2, Upload } from 'lucide-react';

interface ActionItemInput {
  description: string;
  assigneeName: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

interface SyncExternalMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    projectId: string;
    title: string;
    scheduledDate: string;
    durationMinutes?: number;
    location?: string;
    attendees?: string[];
    summary: string;
    actionItems?: Array<{ description: string; assigneeName?: string; priority?: string }>;
    source?: string;
  }) => void;
  projectId: string;
  isSubmitting: boolean;
  error?: string | null;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseActionItems(text: string): ActionItemInput[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      // Try "Assignee: Description" format
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0 && colonIdx < 40) {
        const maybeName = line.slice(0, colonIdx).trim();
        const desc = line.slice(colonIdx + 1).trim();
        // Only treat as name if it looks like a name (no spaces > 3 words, not too long)
        if (maybeName.split(/\s+/).length <= 3 && desc.length > 0) {
          return { description: desc, assigneeName: maybeName, priority: 'medium' as const };
        }
      }
      return { description: line, assigneeName: '', priority: 'medium' as const };
    });
}

export const SyncExternalMeetingModal: React.FC<SyncExternalMeetingModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  projectId,
  isSubmitting,
  error,
}) => {
  const [title, setTitle] = useState('');
  const [scheduledDate, setScheduledDate] = useState(todayISO());
  const [durationMinutes, setDurationMinutes] = useState('60');
  const [location, setLocation] = useState('');
  const [attendees, setAttendees] = useState('');
  const [summary, setSummary] = useState('');
  const [actionItemsText, setActionItemsText] = useState('');
  const [source, setSource] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !summary.trim()) return;

    const parsedItems = parseActionItems(actionItemsText);
    const attendeeList = attendees
      .split(/[,;\n]/)
      .map(a => a.trim())
      .filter(a => a.length > 0);

    onSubmit({
      projectId,
      title: title.trim(),
      scheduledDate: new Date(scheduledDate).toISOString(),
      durationMinutes: parseInt(durationMinutes) || 60,
      location: location.trim() || undefined,
      attendees: attendeeList.length > 0 ? attendeeList : undefined,
      summary: summary.trim(),
      actionItems: parsedItems.length > 0
        ? parsedItems.map(ai => ({
            description: ai.description,
            assigneeName: ai.assigneeName || undefined,
            priority: ai.priority,
          }))
        : undefined,
      source: source.trim() || undefined,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-external-title"
        className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 id="sync-external-title" className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Upload className="w-4 h-4 text-primary-500" />
            Import External Meeting
          </h3>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Title */}
          <div>
            <label htmlFor="sync-title" className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
              Meeting Title <span className="text-red-500">*</span>
            </label>
            <input
              id="sync-title"
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g., Sprint Planning - Week 34"
              className="input w-full"
              required
            />
          </div>

          {/* Date + Duration row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="sync-date" className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                Date <span className="text-red-500">*</span>
              </label>
              <input
                id="sync-date"
                type="date"
                value={scheduledDate}
                onChange={e => setScheduledDate(e.target.value)}
                className="input w-full"
                required
              />
            </div>
            <div>
              <label htmlFor="sync-duration" className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                Duration (min)
              </label>
              <input
                id="sync-duration"
                type="number"
                value={durationMinutes}
                onChange={e => setDurationMinutes(e.target.value)}
                min={1}
                max={1440}
                className="input w-full"
              />
            </div>
          </div>

          {/* Location + Source row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="sync-location" className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                Location / Platform
              </label>
              <input
                id="sync-location"
                type="text"
                value={location}
                onChange={e => setLocation(e.target.value)}
                placeholder="e.g., Zoom, Teams, Room 5"
                className="input w-full"
              />
            </div>
            <div>
              <label htmlFor="sync-source" className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                Source
              </label>
              <input
                id="sync-source"
                type="text"
                value={source}
                onChange={e => setSource(e.target.value)}
                placeholder="e.g., Read.ai, Otter.ai"
                className="input w-full"
              />
            </div>
          </div>

          {/* Attendees */}
          <div>
            <label htmlFor="sync-attendees" className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
              Attendees <span className="text-gray-400 font-normal">(comma-separated)</span>
            </label>
            <input
              id="sync-attendees"
              type="text"
              value={attendees}
              onChange={e => setAttendees(e.target.value)}
              placeholder="e.g., John, Jane, Bob"
              className="input w-full"
            />
          </div>

          {/* Summary */}
          <div>
            <label htmlFor="sync-summary" className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
              Meeting Summary <span className="text-red-500">*</span>
            </label>
            <textarea
              id="sync-summary"
              value={summary}
              onChange={e => setSummary(e.target.value)}
              placeholder="Paste the meeting summary from Read.ai, Otter.ai, or type your own..."
              className="input w-full resize-y"
              rows={5}
              required
            />
          </div>

          {/* Action Items */}
          <div>
            <label htmlFor="sync-actions" className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
              Action Items <span className="text-gray-400 font-normal">(one per line, optional &quot;Name: Description&quot; format)</span>
            </label>
            <textarea
              id="sync-actions"
              value={actionItemsText}
              onChange={e => setActionItemsText(e.target.value)}
              placeholder={"John: Finalize the budget proposal\nJane: Review the design mockups\nUpdate project timeline"}
              className="input w-full resize-y text-sm"
              rows={4}
            />
            {actionItemsText.trim() && (
              <p className="text-[10px] text-gray-400 mt-1">
                {parseActionItems(actionItemsText).length} action item(s) detected
              </p>
            )}
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            <button type="button" onClick={onClose} className="btn btn-secondary text-xs px-4 py-2">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !title.trim() || !summary.trim()}
              className="btn btn-primary text-xs px-4 py-2 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5" />
                  Import Meeting
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
