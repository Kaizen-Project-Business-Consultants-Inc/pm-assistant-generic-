import { useState } from 'react';
import { AutomationList } from '../../components/automations/AutomationList';
import { AutomationForm } from '../../components/automations/AutomationForm';
import { AutomationDetail } from '../../components/automations/AutomationDetail';
import { useProjectRole } from '../../hooks/useProjectRole';
import { ViewOnlyNote } from '../../components/ui/ViewOnlyNote';

export function AutomationsTab({ projectId }: { projectId: string }) {
  const [view, setView] = useState<'list' | 'form' | 'detail'>('list');
  const [selectedId, setSelectedId] = useState<string | undefined>();
  // Automations change the project: its Manager/Owner sets them up
  const { canEdit, loaded: roleLoaded } = useProjectRole(projectId);

  if (view === 'form' && canEdit) {
    return (
      <div className="mt-6">
        <AutomationForm
          projectId={projectId}
          automationId={selectedId}
          onClose={() => { setView('list'); setSelectedId(undefined); }}
          onSaved={() => { setView('list'); setSelectedId(undefined); }}
        />
      </div>
    );
  }

  if (view === 'detail' && selectedId) {
    return (
      <div className="mt-6">
        <AutomationDetail
          projectId={projectId}
          automationId={selectedId}
          onBack={() => { setView('list'); setSelectedId(undefined); }}
          onEdit={() => setView('form')}
          canEdit={canEdit}
        />
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      {roleLoaded && !canEdit && <ViewOnlyNote />}
      <AutomationList
        canEdit={canEdit}
        projectId={projectId}
        onSelect={(id) => { setSelectedId(id); setView('detail'); }}
        onNew={() => { setSelectedId(undefined); setView('form'); }}
        onEdit={(id) => { setSelectedId(id); setView('form'); }}
      />
    </div>
  );
}
