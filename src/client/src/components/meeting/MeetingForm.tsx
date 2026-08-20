import React, { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';

interface AgendaItem {
  title: string;
  description?: string;
  presenter?: string;
  durationMinutes?: number;
}

interface MeetingFormData {
  projectId: string;
  title: string;
  meetingType: string;
  scheduledDate: string;
  durationMinutes: number;
  location: string;
  attendees: string[];
  agendaItems: AgendaItem[];
  notes: string;
}

interface MeetingFormProps {
  projectId: string;
  projectMembers?: { id: string; name: string }[];
  initialData?: Partial<MeetingFormData>;
  onSubmit: (data: MeetingFormData) => void;
  onClose: () => void;
  isSubmitting?: boolean;
}

const MEETING_TYPES = [
  { value: 'ad_hoc', label: 'Ad Hoc' },
  { value: 'standup', label: 'Standup' },
  { value: 'sprint_review', label: 'Sprint Review' },
  { value: 'sprint_retro', label: 'Sprint Retrospective' },
  { value: 'planning', label: 'Planning' },
  { value: 'steering', label: 'Steering Committee' },
  { value: 'kickoff', label: 'Kickoff' },
];

export const MeetingForm: React.FC<MeetingFormProps> = ({
  projectId,
  projectMembers = [],
  initialData,
  onSubmit,
  onClose,
  isSubmitting,
}) => {
  const [title, setTitle] = useState(initialData?.title || '');
  const [meetingType, setMeetingType] = useState(initialData?.meetingType || 'ad_hoc');
  const [scheduledDate, setScheduledDate] = useState(initialData?.scheduledDate || '');
  const [durationMinutes, setDurationMinutes] = useState(initialData?.durationMinutes || 60);
  const [location, setLocation] = useState(initialData?.location || '');
  const [attendeeInput, setAttendeeInput] = useState('');
  const [attendees, setAttendees] = useState<string[]>(initialData?.attendees || []);
  const [agendaItems, setAgendaItems] = useState<AgendaItem[]>(initialData?.agendaItems || []);
  const [notes, setNotes] = useState(initialData?.notes || '');

  const addAttendee = () => {
    const trimmed = attendeeInput.trim();
    if (trimmed && !attendees.includes(trimmed)) {
      setAttendees(prev => [...prev, trimmed]);
      setAttendeeInput('');
    }
  };

  const removeAttendee = (idx: number) => {
    setAttendees(prev => prev.filter((_, i) => i !== idx));
  };

  const addAgendaItem = () => {
    setAgendaItems(prev => [...prev, { title: '' }]);
  };

  const updateAgendaItem = (idx: number, field: keyof AgendaItem, value: any) => {
    setAgendaItems(prev => prev.map((item, i) =>
      i === idx ? { ...item, [field]: value } : item
    ));
  };

  const removeAgendaItem = (idx: number) => {
    setAgendaItems(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !scheduledDate) return;
    onSubmit({
      projectId,
      title: title.trim(),
      meetingType,
      scheduledDate,
      durationMinutes,
      location: location.trim(),
      attendees,
      agendaItems: agendaItems.filter(a => a.title.trim()),
      notes: notes.trim(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {initialData?.title ? 'Edit Meeting' : 'New Meeting'}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Title *</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="input w-full"
              placeholder="Meeting title"
              required
            />
          </div>

          {/* Type + Date row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Type</label>
              <select value={meetingType} onChange={e => setMeetingType(e.target.value)} className="input w-full">
                {MEETING_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Date & Time *</label>
              <input
                type="datetime-local"
                value={scheduledDate}
                onChange={e => setScheduledDate(e.target.value)}
                className="input w-full"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Duration (min)</label>
              <input
                type="number"
                value={durationMinutes}
                onChange={e => setDurationMinutes(Number(e.target.value))}
                className="input w-full"
                min={5}
                max={1440}
              />
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Location</label>
            <input
              type="text"
              value={location}
              onChange={e => setLocation(e.target.value)}
              className="input w-full"
              placeholder="Conference room, Zoom link, etc."
            />
          </div>

          {/* Attendees */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Attendees</label>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={attendeeInput}
                onChange={e => setAttendeeInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addAttendee(); } }}
                className="input flex-1"
                placeholder="Add attendee name and press Enter"
                list="member-suggestions"
              />
              <datalist id="member-suggestions">
                {projectMembers.map(m => (
                  <option key={m.id} value={m.name} />
                ))}
              </datalist>
              <button type="button" onClick={addAttendee} className="btn btn-secondary px-3">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {attendees.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {attendees.map((name, idx) => (
                  <span key={idx} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
                    {name}
                    <button type="button" onClick={() => removeAttendee(idx)} className="hover:text-red-500">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Agenda Items */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">Agenda Items</label>
              <button type="button" onClick={addAgendaItem} className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add Item
              </button>
            </div>
            {agendaItems.map((item, idx) => (
              <div key={idx} className="flex gap-2 mb-2 items-start">
                <div className="flex-1 space-y-1">
                  <input
                    type="text"
                    value={item.title}
                    onChange={e => updateAgendaItem(idx, 'title', e.target.value)}
                    className="input w-full text-sm"
                    placeholder={`Agenda item ${idx + 1}`}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={item.presenter || ''}
                      onChange={e => updateAgendaItem(idx, 'presenter', e.target.value)}
                      className="input w-full text-xs"
                      placeholder="Presenter"
                    />
                    <input
                      type="number"
                      value={item.durationMinutes || ''}
                      onChange={e => updateAgendaItem(idx, 'durationMinutes', Number(e.target.value) || undefined)}
                      className="input w-full text-xs"
                      placeholder="Duration (min)"
                      min={1}
                      max={480}
                    />
                  </div>
                </div>
                <button type="button" onClick={() => removeAgendaItem(idx)} className="p-1 hover:text-red-500 mt-1">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="input w-full resize-y"
              rows={3}
              placeholder="Freeform meeting notes..."
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
            <button type="submit" disabled={isSubmitting || !title.trim() || !scheduledDate} className="btn btn-primary disabled:opacity-50">
              {isSubmitting ? 'Saving...' : initialData?.title ? 'Update Meeting' : 'Create Meeting'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
