import { useState } from 'react';
import { ChangeRequestList } from '../../components/approvals/ChangeRequestList';
import { ChangeRequestForm } from '../../components/approvals/ChangeRequestForm';
import { ChangeRequestDetail } from '../../components/approvals/ChangeRequestDetail';
import { WorkflowEditor } from '../../components/approvals/WorkflowEditor';
import { useProjectRole } from '../../hooks/useProjectRole';

export function ChangeRequestsTab({ projectId }: { projectId: string }) {
  const [view, setView] = useState<'list' | 'form' | 'detail' | 'workflow'>('list');
  const [selectedCrId, setSelectedCrId] = useState<string | undefined>();
  // Approval workflows are set up by the project's Manager/Owner (the server refuses anyone else)
  const { canEdit } = useProjectRole(projectId);

  if (view === 'form') {
    return (
      <div className="mt-6">
        <ChangeRequestForm
          projectId={projectId}
          crId={selectedCrId}
          onClose={() => { setView('list'); setSelectedCrId(undefined); }}
          onSaved={() => { setView('list'); setSelectedCrId(undefined); }}
        />
      </div>
    );
  }

  if (view === 'detail' && selectedCrId) {
    return (
      <div className="mt-6">
        <ChangeRequestDetail
          crId={selectedCrId}
          onBack={() => { setView('list'); setSelectedCrId(undefined); }}
        />
      </div>
    );
  }

  if (view === 'workflow' && canEdit) {
    return (
      <div className="mt-6">
        <WorkflowEditor
          projectId={projectId}
          onClose={() => setView('list')}
          onSaved={() => setView('list')}
        />
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">Change Requests</h3>
        {canEdit && <button
          onClick={() => setView('workflow')}
          className="text-sm text-primary-600 dark:text-primary-400 hover:text-primary-800"
        >
          Manage Workflows
        </button>}
      </div>
      <ChangeRequestList
        projectId={projectId}
        onSelect={(id) => { setSelectedCrId(id); setView('detail'); }}
        onNew={() => { setSelectedCrId(undefined); setView('form'); }}
      />
    </div>
  );
}
