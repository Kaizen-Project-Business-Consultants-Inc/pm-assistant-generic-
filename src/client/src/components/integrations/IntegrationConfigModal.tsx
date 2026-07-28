import React, { useState, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { X, Save, Plug, Check, RefreshCw } from 'lucide-react';
import { apiService } from '../../services/api';
import { useModal } from '../../hooks/useModal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IntegrationConfigModalProps {
  provider: string;
  integrationId?: string; // if editing
  onClose: () => void;
  onSaved: () => void;
}

interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url';
  required: boolean;
  placeholder?: string;
}

// ---------------------------------------------------------------------------
// Provider field definitions
// ---------------------------------------------------------------------------

const PROVIDER_FIELDS: Record<string, FieldDef[]> = {
  jira: [
    {
      key: 'baseUrl',
      label: 'Base URL',
      type: 'url',
      required: true,
      placeholder: 'https://your-domain.atlassian.net',
    },
    {
      key: 'email',
      label: 'Email',
      type: 'text',
      required: true,
      placeholder: 'you@company.com',
    },
    {
      key: 'apiToken',
      label: 'API Token',
      type: 'password',
      required: true,
      placeholder: 'Enter your Jira API token',
    },
    {
      key: 'projectKey',
      label: 'Project Key',
      type: 'text',
      required: true,
      placeholder: 'e.g. PROJ',
    },
  ],
  github: [
    {
      key: 'owner',
      label: 'Repository Owner',
      type: 'text',
      required: true,
      placeholder: 'e.g. octocat',
    },
    {
      key: 'repo',
      label: 'Repository Name',
      type: 'text',
      required: true,
      placeholder: 'e.g. my-project',
    },
    {
      key: 'token',
      label: 'Personal Access Token',
      type: 'password',
      required: true,
      placeholder: 'ghp_...',
    },
  ],
  slack: [
    {
      key: 'webhookUrl',
      label: 'Webhook URL',
      type: 'url',
      required: true,
      placeholder: 'https://hooks.slack.com/services/...',
    },
    {
      key: 'channel',
      label: 'Channel',
      type: 'text',
      required: false,
      placeholder: '#project-updates (optional)',
    },
  ],
  trello: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      placeholder: 'Enter your Trello API key',
    },
    {
      key: 'token',
      label: 'Token',
      type: 'password',
      required: true,
      placeholder: 'Enter your Trello token',
    },
    {
      key: 'boardId',
      label: 'Board ID',
      type: 'text',
      required: true,
      placeholder: 'e.g. 60d5ec49f...',
    },
  ],
};

const PROVIDER_NAMES: Record<string, string> = {
  jira: 'Jira',
  github: 'GitHub',
  slack: 'Slack',
  trello: 'Trello',
};

const PROVIDER_COLORS: Record<string, string> = {
  jira: '#0052CC',
  github: '#333333',
  slack: '#4A154B',
  trello: '#0079BF',
};

const SLACK_EVENT_TYPES: { key: string; label: string }[] = [
  { key: 'task.completed', label: 'Task Completed' },
  { key: 'task_assigned', label: 'Task Assigned' },
  { key: 'risk.created', label: 'Risk/Issue Created' },
  { key: 'sprint.started', label: 'Sprint Started' },
  { key: 'sprint.completed', label: 'Sprint Completed' },
  { key: 'project.updated', label: 'Project Updated' },
  { key: 'proposal.created', label: 'Agent Proposal' },
  { key: 'budget_alert', label: 'Budget Alert' },
  { key: 'deadline_approaching', label: 'Deadline Approaching' },
  { key: 'member_added', label: 'Member Added' },
  { key: 'meeting_followup', label: 'Meeting Follow-up' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const IntegrationConfigModal: React.FC<IntegrationConfigModalProps> = ({
  provider,
  integrationId,
  onClose,
  onSaved,
}) => {
  const isEdit = !!integrationId;
  const fields = PROVIDER_FIELDS[provider] ?? [];
  const providerName = PROVIDER_NAMES[provider] ?? provider;

  // Form state: key -> value
  const [formValues, setFormValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const f of fields) {
      initial[f.key] = '';
    }
    return initial;
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Slack-specific: project selector + event filter
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [notifyEvents, setNotifyEvents] = useState<string[]>([]);

  const { data: projectsData } = useQuery({
    queryKey: ['projects-list'],
    queryFn: () => apiService.getProjects(),
    enabled: provider === 'slack',
  });

  // Load existing config if editing
  const { data: existingData } = useQuery({
    queryKey: ['integration', integrationId],
    queryFn: () => apiService.getIntegration(integrationId!),
    enabled: isEdit,
  });

  useEffect(() => {
    if (existingData?.integration) {
      const integration = existingData.integration;
      if (integration.config) {
        const config = integration.config as Record<string, any>;
        setFormValues((prev) => {
          const updated = { ...prev };
          for (const key of Object.keys(updated)) {
            if (config[key] !== undefined) {
              updated[key] = String(config[key]);
            }
          }
          return updated;
        });
        if (Array.isArray(config.notifyEvents)) {
          setNotifyEvents(config.notifyEvents);
        }
      }
      if (integration.projectId) {
        setSelectedProjectId(integration.projectId);
      }
    }
  }, [existingData]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: (config: Record<string, unknown>) => {
      if (isEdit) {
        return apiService.updateIntegration(integrationId!, {
          provider,
          config,
        });
      }
      return apiService.createIntegration({
        provider,
        config,
        ...(provider === 'slack' && selectedProjectId ? { projectId: selectedProjectId } : {}),
      });
    },
    onSuccess: () => {
      onSaved();
    },
  });

  // Test connection mutation
  const testMutation = useMutation({
    mutationFn: (id: string) => apiService.testIntegrationConnection(id),
    onSuccess: (data) => {
      setTestResult({
        success: data.success !== false,
        message: data.message || 'Connection successful!',
      });
    },
    onError: (err: any) => {
      setTestResult({
        success: false,
        message:
          err?.response?.data?.message ||
          err?.message ||
          'Connection test failed',
      });
    },
  });

  // Handlers
  const handleChange = (key: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
    // Clear field error on edit
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
    setTestResult(null);
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    for (const f of fields) {
      if (f.required && !formValues[f.key]?.trim()) {
        newErrors[f.key] = `${f.label} is required`;
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    const configPayload: Record<string, unknown> = { ...formValues };
    if (provider === 'slack' && notifyEvents.length > 0) {
      configPayload.notifyEvents = notifyEvents;
    }
    saveMutation.mutate(configPayload);
  };

  const handleTestConnection = () => {
    if (!integrationId) return;
    setTestResult(null);
    testMutation.mutate(integrationId);
  };

  const { dialogRef, handleKeyDown } = useModal(true, onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={`Configure ${provider}`} onKeyDown={handleKeyDown} tabIndex={-1} className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
              style={{ backgroundColor: PROVIDER_COLORS[provider] || '#6366f1' }}
            >
              {providerName.charAt(0)}
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {isEdit ? `Configure ${providerName}` : `Connect ${providerName}`}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {fields.map((field) => (
            <div key={field.key}>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {field.label}
                {field.required && (
                  <span className="text-red-500 ml-0.5">*</span>
                )}
              </label>
              <input
                type={field.type}
                value={formValues[field.key] || ''}
                onChange={(e) => handleChange(field.key, e.target.value)}
                placeholder={field.placeholder}
                className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:text-white ${
                  errors[field.key]
                    ? 'border-red-300 dark:border-red-600 bg-red-50 dark:bg-red-900/20'
                    : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900'
                }`}
              />
              {errors[field.key] && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                  {errors[field.key]}
                </p>
              )}
            </div>
          ))}

          {/* Slack-specific: project selector + event filter */}
          {provider === 'slack' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Project
                </label>
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 dark:text-white"
                >
                  <option value="">All Projects</option>
                  {(projectsData?.data || []).map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Select a project to scope notifications, or leave as &quot;All Projects&quot;.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Event Filters
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  Select which events post to Slack. Leave all unchecked to receive all events.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {SLACK_EVENT_TYPES.map((evt) => (
                    <label key={evt.key} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={notifyEvents.includes(evt.key)}
                        onChange={() => {
                          setNotifyEvents((prev) =>
                            prev.includes(evt.key)
                              ? prev.filter((e) => e !== evt.key)
                              : [...prev, evt.key],
                          );
                        }}
                        className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
                      />
                      {evt.label}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Test connection (only when editing an existing integration) */}
          {isEdit && (
            <div className="pt-2">
              <button
                onClick={handleTestConnection}
                disabled={testMutation.isPending}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
              >
                {testMutation.isPending ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Plug className="h-4 w-4" />
                )}
                Test Connection
              </button>

              {testResult && (
                <div
                  className={`mt-2 flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${
                    testResult.success
                      ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                      : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                  }`}
                >
                  {testResult.success ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <X className="h-4 w-4" />
                  )}
                  {testResult.message}
                </div>
              )}
            </div>
          )}

          {/* Save error */}
          {saveMutation.isError && (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm px-3 py-2 rounded-lg">
              {(saveMutation.error as any)?.response?.data?.message ||
                'Failed to save integration. Please try again.'}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
          >
            {saveMutation.isPending ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {isEdit ? 'Save Changes' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  );
};
