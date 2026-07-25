import React, { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Clock, Trash2 } from 'lucide-react';
import { apiService } from '../../services/api';
import { useModal } from '../../hooks/useModal';

interface ReportScheduleModalProps {
  templateId: string;
  templateName: string;
  onClose: () => void;
}

export const ReportScheduleModal: React.FC<ReportScheduleModalProps> = ({
  templateId,
  templateName,
  onClose,
}) => {
  const queryClient = useQueryClient();
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [timeOfDay, setTimeOfDay] = useState('08:00');
  const [recipients, setRecipients] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [existingId, setExistingId] = useState<string | null>(null);

  const { data: existingData } = useQuery({
    queryKey: ['report-schedules-template', templateId],
    queryFn: () => apiService.getReportSchedulesByTemplate(templateId),
  });

  useEffect(() => {
    const schedules = existingData?.schedules || [];
    if (schedules.length > 0) {
      const s = schedules[0];
      setExistingId(s.id);
      setFrequency(s.frequency);
      setDayOfWeek(s.dayOfWeek ?? 1);
      setDayOfMonth(s.dayOfMonth ?? 1);
      setTimeOfDay(s.timeOfDay || '08:00');
      setRecipients((s.recipients || []).join(', '));
      setIsActive(s.isActive);
    }
  }, [existingData]);

  const createMutation = useMutation({
    mutationFn: () =>
      apiService.createReportSchedule({
        templateId,
        frequency,
        dayOfWeek: frequency === 'weekly' ? dayOfWeek : undefined,
        dayOfMonth: frequency === 'monthly' ? dayOfMonth : undefined,
        timeOfDay,
        recipients: recipients.split(',').map((r) => r.trim()).filter(Boolean),
        isActive,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-schedules-template', templateId] });
      onClose();
    },
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      apiService.updateReportSchedule(existingId!, {
        frequency,
        dayOfWeek: frequency === 'weekly' ? dayOfWeek : null,
        dayOfMonth: frequency === 'monthly' ? dayOfMonth : null,
        timeOfDay,
        recipients: recipients.split(',').map((r) => r.trim()).filter(Boolean),
        isActive,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-schedules-template', templateId] });
      onClose();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiService.deleteReportSchedule(existingId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-schedules-template', templateId] });
      onClose();
    },
  });

  const handleSave = () => {
    if (existingId) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const recipientList = recipients.split(',').map((r) => r.trim()).filter(Boolean);
  const { dialogRef, handleKeyDown } = useModal(true, onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Schedule Report" onKeyDown={handleKeyDown} tabIndex={-1} className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {existingId ? 'Edit Schedule' : 'Schedule Report'}
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Schedule <span className="font-medium text-gray-700 dark:text-gray-200">{templateName}</span> for automatic delivery via email.
          </p>

          {/* Frequency */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Frequency</label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as any)}
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>

          {/* Day of Week (weekly) */}
          {frequency === 'weekly' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Day of Week</label>
              <select
                value={dayOfWeek}
                onChange={(e) => setDayOfWeek(Number(e.target.value))}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value={0}>Sunday</option>
                <option value={1}>Monday</option>
                <option value={2}>Tuesday</option>
                <option value={3}>Wednesday</option>
                <option value={4}>Thursday</option>
                <option value={5}>Friday</option>
                <option value={6}>Saturday</option>
              </select>
            </div>
          )}

          {/* Day of Month (monthly) */}
          {frequency === 'monthly' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Day of Month</label>
              <select
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(Number(e.target.value))}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {Array.from({ length: 28 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>{i + 1}</option>
                ))}
              </select>
            </div>
          )}

          {/* Time of Day */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Time of Day</label>
            <input
              type="time"
              value={timeOfDay}
              onChange={(e) => setTimeOfDay(e.target.value)}
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {/* Recipients */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Recipients (comma-separated emails)</label>
            <textarea
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              rows={2}
              placeholder="user@example.com, another@example.com"
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {/* Active Toggle */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Active</span>
            <button
              type="button"
              role="switch"
              aria-checked={isActive}
              onClick={() => setIsActive(!isActive)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                isActive ? 'bg-primary-600' : 'bg-gray-200 dark:bg-gray-600'
              }`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-gray-800 shadow transition duration-200 ${isActive ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-700">
          <div>
            {existingId && (
              <button
                onClick={() => { if (confirm('Delete this schedule?')) deleteMutation.mutate(); }}
                disabled={deleteMutation.isPending}
                className="flex items-center gap-1.5 text-sm text-red-600 hover:text-red-700"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || recipientList.length === 0}
              className="px-4 py-2 rounded-lg text-sm bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : existingId ? 'Update' : 'Create Schedule'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
