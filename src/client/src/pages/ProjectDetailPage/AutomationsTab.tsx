import { useState } from 'react';
import { AutomationList } from '../../components/automations/AutomationList';
import { AutomationForm } from '../../components/automations/AutomationForm';
import { AutomationDetail } from '../../components/automations/AutomationDetail';

export function AutomationsTab({ projectId }: { projectId: string }) {
  const [view, setView] = useState<'list' | 'form' | 'detail'>('list');
  const [selectedId, setSelectedId] = useState<string | undefined>();

  if (view === 'form') {
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
        />
      </div>
    );
  }

  return (
    <div className="mt-6">
      <AutomationList
        projectId={projectId}
        onSelect={(id) => { setSelectedId(id); setView('detail'); }}
        onNew={() => { setSelectedId(undefined); setView('form'); }}
        onEdit={(id) => { setSelectedId(id); setView('form'); }}
      />
    </div>
  );
}
