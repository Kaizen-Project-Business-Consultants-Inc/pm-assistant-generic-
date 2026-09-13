import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus, Trash2, Calendar } from 'lucide-react';
import { apiService } from '../../services/api';
import { toLocalDate } from '../../utils/dateUtils';

interface AvailabilityEntry {
  id: string;
  resourceId: string;
  dateFrom: string;
  dateTo: string;
  type: 'vacation' | 'holiday' | 'unavailable' | 'reduced';
  hoursAvailable: number | null;
  note: string | null;
}

const typeColors: Record<string, { bg: string; text: string; label: string }> = {
  vacation: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400', label: 'Vacation' },
  holiday: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-400', label: 'Holiday' },
  unavailable: { bg: 'bg-gray-200 dark:bg-gray-700', text: 'text-gray-700 dark:text-gray-300', label: 'Unavailable' },
  reduced: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-400', label: 'Reduced Hours' },
};

interface AvailabilityCalendarProps {
  resourceId: string;
  resourceName: string;
}

export function AvailabilityCalendar({ resourceId, resourceName }: AvailabilityCalendarProps) {
  const queryClient = useQueryClient();
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    dateFrom: '',
    dateTo: '',
    type: 'vacation' as AvailabilityEntry['type'],
    hoursAvailable: '',
    note: '',
  });

  const monthStart = `${currentMonth.year}-${String(currentMonth.month + 1).padStart(2, '0')}-01`;
  const nextMonth = currentMonth.month === 11
    ? { year: currentMonth.year + 1, month: 0 }
    : { year: currentMonth.year, month: currentMonth.month + 1 };
  const monthEnd = `${nextMonth.year}-${String(nextMonth.month + 1).padStart(2, '0')}-01`;

  const { data } = useQuery({
    queryKey: ['resourceAvailability', resourceId, monthStart],
    queryFn: () => apiService.getResourceAvailability(resourceId, monthStart, monthEnd),
  });

  const entries: AvailabilityEntry[] = data?.availability || [];

  const createMutation = useMutation({
    mutationFn: (body: any) => apiService.createResourceAvailability(resourceId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resourceAvailability', resourceId] });
      setShowForm(false);
      setFormData({ dateFrom: '', dateTo: '', type: 'vacation', hoursAvailable: '', note: '' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiService.deleteResourceAvailability(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resourceAvailability', resourceId] });
    },
  });

  // Build calendar grid
  const calendarDays = useMemo(() => {
    const first = new Date(currentMonth.year, currentMonth.month, 1);
    const last = new Date(currentMonth.year, currentMonth.month + 1, 0);
    const startDay = first.getDay(); // 0=Sun
    const totalDays = last.getDate();

    const days: { date: Date; inMonth: boolean }[] = [];

    // Pad start
    for (let i = startDay - 1; i >= 0; i--) {
      const d = new Date(first);
      d.setDate(d.getDate() - i - 1);
      days.push({ date: d, inMonth: false });
    }

    // Month days
    for (let i = 1; i <= totalDays; i++) {
      days.push({ date: new Date(currentMonth.year, currentMonth.month, i), inMonth: true });
    }

    // Pad end to fill 6 weeks max
    while (days.length % 7 !== 0) {
      const d = new Date(last);
      d.setDate(d.getDate() + (days.length - startDay - totalDays + 1));
      days.push({ date: d, inMonth: false });
    }

    return days;
  }, [currentMonth]);

  const getEntryForDate = (date: Date): AvailabilityEntry | undefined => {
    const dateStr = toLocalDate(date);
    return entries.find(e => dateStr >= e.dateFrom && dateStr <= e.dateTo);
  };

  const monthLabel = new Date(currentMonth.year, currentMonth.month).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const prevMonth = () => {
    setCurrentMonth(prev =>
      prev.month === 0 ? { year: prev.year - 1, month: 11 } : { year: prev.year, month: prev.month - 1 }
    );
  };

  const nextMonthFn = () => {
    setCurrentMonth(prev =>
      prev.month === 11 ? { year: prev.year + 1, month: 0 } : { year: prev.year, month: prev.month + 1 }
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.dateFrom || !formData.dateTo) return;
    createMutation.mutate({
      dateFrom: formData.dateFrom,
      dateTo: formData.dateTo,
      type: formData.type,
      hoursAvailable: formData.type === 'reduced' && formData.hoursAvailable ? Number(formData.hoursAvailable) : undefined,
      note: formData.note || undefined,
    });
  };

  const today = toLocalDate();

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Availability — {resourceName}</h3>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded" aria-label="Previous month">
            <ChevronLeft className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          </button>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 w-36 text-center">{monthLabel}</span>
          <button onClick={nextMonthFn} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded" aria-label="Next month">
            <ChevronRight className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="ml-2 flex items-center gap-1 px-2 py-1 text-xs font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-md"
          >
            <Plus className="w-3 h-3" />
            Add Block
          </button>
        </div>
      </div>

      {/* Add form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-700 flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">From</label>
            <input type="date" value={formData.dateFrom} onChange={e => setFormData(p => ({ ...p, dateFrom: e.target.value }))} className="text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded px-2 py-1" required />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">To</label>
            <input type="date" value={formData.dateTo} onChange={e => setFormData(p => ({ ...p, dateTo: e.target.value }))} className="text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded px-2 py-1" required />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">Type</label>
            <select value={formData.type} onChange={e => setFormData(p => ({ ...p, type: e.target.value as any }))} className="text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded px-2 py-1">
              <option value="vacation">Vacation</option>
              <option value="holiday">Holiday</option>
              <option value="unavailable">Unavailable</option>
              <option value="reduced">Reduced Hours</option>
            </select>
          </div>
          {formData.type === 'reduced' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">Hours/day</label>
              <input type="number" min="0" max="24" step="0.5" value={formData.hoursAvailable} onChange={e => setFormData(p => ({ ...p, hoursAvailable: e.target.value }))} className="text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded px-2 py-1 w-16" />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">Note</label>
            <input type="text" value={formData.note} onChange={e => setFormData(p => ({ ...p, note: e.target.value }))} className="text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded px-2 py-1 w-32" placeholder="Optional" />
          </div>
          <button type="submit" disabled={createMutation.isPending} className="text-xs px-3 py-1 bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50">
            Save
          </button>
        </form>
      )}

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-px bg-gray-200 dark:bg-gray-700 rounded-lg overflow-hidden">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} className="bg-gray-50 dark:bg-gray-700 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 py-1">{d}</div>
        ))}
        {calendarDays.map(({ date, inMonth }, i) => {
          const dateStr = toLocalDate(date);
          const entry = getEntryForDate(date);
          const isToday = dateStr === today;
          const colors = entry ? typeColors[entry.type] : null;

          return (
            <div
              key={i}
              className={`bg-white dark:bg-gray-800 p-1 min-h-[36px] ${!inMonth ? 'opacity-30' : ''}`}
              title={entry ? `${typeColors[entry.type].label}${entry.note ? `: ${entry.note}` : ''}` : undefined}
            >
              <div className={`text-xs text-center rounded-full w-5 h-5 flex items-center justify-center mx-auto ${
                isToday ? 'bg-primary-600 text-white font-bold' : 'text-gray-600 dark:text-gray-300'
              }`}>
                {date.getDate()}
              </div>
              {entry && colors && (
                <div className={`mt-0.5 rounded text-center text-[8px] font-medium px-0.5 py-0.5 ${colors.bg} ${colors.text}`}>
                  {colors.label.slice(0, 3)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Entries list */}
      {entries.length > 0 && (
        <div className="mt-3 space-y-1">
          <h4 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase">Scheduled Blocks</h4>
          {entries.map(e => {
            const colors = typeColors[e.type];
            return (
              <div key={e.id} className="flex items-center gap-2 text-xs">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${colors.bg} ${colors.text}`}>
                  {colors.label}
                </span>
                <span className="text-gray-600 dark:text-gray-400">
                  {new Date(e.dateFrom).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  {' — '}
                  {new Date(e.dateTo).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
                {e.note && <span className="text-gray-400 dark:text-gray-500 truncate">{e.note}</span>}
                <button
                  onClick={() => deleteMutation.mutate(e.id)}
                  className="ml-auto p-0.5 text-gray-400 hover:text-red-500"
                  title="Delete"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      <div className="mt-3 flex items-center gap-3 flex-wrap">
        {Object.entries(typeColors).map(([key, c]) => (
          <div key={key} className="flex items-center gap-1">
            <div className={`w-3 h-2 rounded ${c.bg}`} />
            <span className="text-xs text-gray-500 dark:text-gray-400">{c.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
