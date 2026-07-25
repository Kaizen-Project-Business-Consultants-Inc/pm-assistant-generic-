import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Plus, FileText, Trash2, Eye } from 'lucide-react';
import { apiService } from '../services/api';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { IntakeFormDesigner } from '../components/intake/IntakeFormDesigner';
import { IntakeSubmissionForm } from '../components/intake/IntakeSubmissionForm';
import { IntakeReviewPanel } from '../components/intake/IntakeReviewPanel';

type Tab = 'forms' | 'submissions';
type View = 'list' | 'designer' | 'submission' | 'review';

const statusBadgeStyles: Record<string, string> = {
  submitted: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
  under_review: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
  approved: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  rejected: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
  converted: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
};

const statusLabels: Record<string, string> = {
  submitted: 'Submitted',
  under_review: 'Under Review',
  approved: 'Approved',
  rejected: 'Rejected',
  converted: 'Converted',
};

export const IntakeFormsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('forms');
  const [view, setView] = useState<View>('list');
  const [selectedFormId, setSelectedFormId] = useState<string | undefined>(undefined);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [confirmDeleteFormId, setConfirmDeleteFormId] = useState<string | null>(null);

  // --- Forms tab queries ---
  const { data: formsData, isLoading: formsLoading } = useQuery({
    queryKey: ['intake-forms'],
    queryFn: () => apiService.getIntakeForms(),
    enabled: tab === 'forms' && view === 'list',
  });
  const forms: any[] = formsData?.forms || [];

  // --- Submissions tab queries ---
  const { data: submissionsData, isLoading: submissionsLoading } = useQuery({
    queryKey: ['intake-submissions', statusFilter],
    queryFn: () =>
      apiService.getIntakeSubmissions(
        undefined,
        statusFilter !== 'all' ? statusFilter : undefined,
      ),
    enabled: tab === 'submissions' && view === 'list',
  });
  const submissions: any[] = submissionsData?.submissions || [];

  // --- Delete form ---
  const deleteFormMutation = useMutation({
    mutationFn: (formId: string) => apiService.deleteIntakeForm(formId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['intake-forms'] }),
  });

  // --- Handlers ---
  const openDesigner = (formId?: string) => {
    setSelectedFormId(formId);
    setView('designer');
  };

  const openSubmission = (formId: string) => {
    setSelectedFormId(formId);
    setView('submission');
  };

  const openReview = (submissionId: string) => {
    setSelectedSubmissionId(submissionId);
    setView('review');
  };

  const backToList = () => {
    setView('list');
    setSelectedFormId(undefined);
    setSelectedSubmissionId('');
  };

  // --- Render sub-views ---
  if (view === 'designer') {
    return (
      <IntakeFormDesigner
        formId={selectedFormId}
        onClose={backToList}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['intake-forms'] });
          backToList();
        }}
      />
    );
  }

  if (view === 'submission' && selectedFormId) {
    return (
      <IntakeSubmissionForm
        formId={selectedFormId}
        onClose={backToList}
        onSubmitted={() => {
          queryClient.invalidateQueries({ queryKey: ['intake-submissions'] });
          backToList();
          setTab('submissions');
        }}
      />
    );
  }

  if (view === 'review' && selectedSubmissionId) {
    return (
      <IntakeReviewPanel
        submissionId={selectedSubmissionId}
        onClose={backToList}
        onUpdated={() => {
          queryClient.invalidateQueries({ queryKey: ['intake-submissions'] });
          backToList();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <ClipboardList className="w-5 h-5" /> Project Intake Forms
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Create intake forms, collect submissions, and convert approved requests into projects
          </p>
        </div>
        {tab === 'forms' && (
          <button
            onClick={() => openDesigner()}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" /> New Form
          </button>
        )}
      </div>

      {/* Tab navigation */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <div className="flex gap-6">
          <button
            onClick={() => setTab('forms')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              tab === 'forms'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-200'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <FileText className="w-4 h-4" /> Forms
            </span>
          </button>
          <button
            onClick={() => setTab('submissions')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              tab === 'submissions'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-200'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <ClipboardList className="w-4 h-4" /> Submissions
            </span>
          </button>
        </div>
      </div>

      {/* Forms Tab */}
      {tab === 'forms' && (
        <div>
          {formsLoading ? (
            <div className="text-center py-12 text-gray-400 dark:text-gray-500">Loading forms...</div>
          ) : forms.length === 0 ? (
            <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
              <FileText className="w-10 h-10 mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500 dark:text-gray-400 text-sm">No intake forms yet.</p>
              <button
                onClick={() => openDesigner()}
                className="mt-3 text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                Create your first form
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {forms.map((form: any) => (
                <div
                  key={form.id}
                  className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{form.name}</h3>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        form.is_active
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                      }`}
                    >
                      {form.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  {form.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 line-clamp-2">{form.description}</p>
                  )}
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
                    {form.fields?.length || 0} field{(form.fields?.length || 0) !== 1 ? 's' : ''}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openSubmission(form.id)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100 transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" /> Fill Out
                    </button>
                    <button
                      onClick={() => openDesigner(form.id)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setConfirmDeleteFormId(form.id)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-red-50 text-red-600 rounded-md hover:bg-red-100 transition-colors ml-auto"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Submissions Tab */}
      {tab === 'submissions' && (
        <div className="space-y-4">
          {/* Status filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Filter:</span>
            {['all', 'submitted', 'under_review', 'approved', 'rejected', 'converted'].map(
              (status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                    statusFilter === status
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
                  }`}
                >
                  {status === 'all' ? 'All' : statusLabels[status] || status}
                </button>
              ),
            )}
          </div>

          {/* Submissions table */}
          {submissionsLoading ? (
            <div className="text-center py-12 text-gray-400 dark:text-gray-500">Loading submissions...</div>
          ) : submissions.length === 0 ? (
            <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
              <ClipboardList className="w-10 h-10 mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500 dark:text-gray-400 text-sm">No submissions found.</p>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-x-auto">
              <table className="w-full text-sm min-w-[600px]">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Form Name
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Submitted By
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {submissions.map((sub: any) => (
                    <tr
                      key={sub.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                      onClick={() => openReview(sub.id)}
                    >
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                        {sub.form_name || sub.formName || 'Unknown Form'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                        {sub.submitted_by_name || sub.submittedByName || 'Unknown'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            statusBadgeStyles[sub.status] || 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
                          }`}
                        >
                          {statusLabels[sub.status] || sub.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                        {sub.created_at
                          ? new Date(sub.created_at).toLocaleDateString()
                          : ''}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openReview(sub.id);
                          }}
                          className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Delete Form Confirmation */}
      {confirmDeleteFormId && (
        <ConfirmModal
          title="Delete Form"
          message="Delete this form? This cannot be undone."
          confirmLabel="Delete"
          isPending={deleteFormMutation.isPending}
          onConfirm={() => { deleteFormMutation.mutate(confirmDeleteFormId); setConfirmDeleteFormId(null); }}
          onCancel={() => setConfirmDeleteFormId(null)}
        />
      )}
    </div>
  );
};
