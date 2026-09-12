import type { AutomationDefinition } from './types';

export interface GovernancePackAutomation {
  name: string;
  description: string;
  triggerEventType: string;
  triggerEntityType?: string;
  scope: 'project' | 'portfolio';
  definition: AutomationDefinition;
  maxRunsPerDay?: number;
  cooldownSeconds?: number;
}

export interface GovernancePack {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  automations: GovernancePackAutomation[];
}

export const GOVERNANCE_PACKS: GovernancePack[] = [
  {
    id: 'change-control',
    name: 'Change Control',
    description: 'Enforce change request governance with notifications and audit trails.',
    category: 'governance',
    icon: 'shield-check',
    automations: [
      {
        name: 'Notify on New Change Request',
        description: 'Notify the project owner when a change request is submitted.',
        triggerEventType: 'change_request.created',
        triggerEntityType: 'change_request',
        scope: 'project',
        definition: {
          actions: [{
            id: 'a1', type: 'notify', runOrder: 0,
            params: { recipients: 'project_owner', messageTemplate: 'New change request: {{entity.title}}', title: 'Change Request Submitted', severity: 'medium' },
          }],
        },
      },
      {
        name: 'Escalate Rejected Change Requests',
        description: 'Escalate to project owner when a change request is rejected.',
        triggerEventType: 'change_request.rejected',
        triggerEntityType: 'change_request',
        scope: 'project',
        definition: {
          actions: [{
            id: 'a1', type: 'escalate', runOrder: 0,
            params: { recipients: 'project_owner', messageTemplate: 'Change request "{{entity.title}}" has been rejected and may need review.', title: 'CR Rejected' },
          }],
        },
      },
      {
        name: 'Audit Log on CR Approval',
        description: 'Create audit trail when a change request is approved.',
        triggerEventType: 'change_request.approved',
        triggerEntityType: 'change_request',
        scope: 'project',
        definition: {
          actions: [{
            id: 'a1', type: 'log_audit', runOrder: 0,
            params: { messageTemplate: 'Change request "{{entity.title}}" approved', action: 'change_request_approved' },
          }],
        },
      },
    ],
  },
  {
    id: 'risk-management',
    name: 'Risk Management',
    description: 'Monitor and escalate risks across projects.',
    category: 'governance',
    icon: 'shield-alert',
    automations: [
      {
        name: 'Notify on Critical Risk',
        description: 'Alert the project owner when a critical risk is identified.',
        triggerEventType: 'risk.created',
        triggerEntityType: 'risk',
        scope: 'project',
        definition: {
          conditions: { logic: 'and', conditions: [{ field: 'severity', operator: 'equals', value: 'critical' }] },
          actions: [{
            id: 'a1', type: 'notify', runOrder: 0,
            params: { recipients: 'project_owner', messageTemplate: 'Critical risk created: {{entity.title}}', title: 'Critical Risk Alert', severity: 'critical' },
          }],
        },
      },
      {
        name: 'Escalate High-Severity Risks (Portfolio)',
        description: 'Escalate high or critical risks across all projects to the project owner.',
        triggerEventType: 'risk.created',
        triggerEntityType: 'risk',
        scope: 'portfolio',
        definition: {
          conditions: { logic: 'or', conditions: [
            { field: 'severity', operator: 'equals', value: 'high' },
            { field: 'severity', operator: 'equals', value: 'critical' },
          ] },
          actions: [{
            id: 'a1', type: 'escalate', runOrder: 0,
            params: { recipients: 'project_owner', messageTemplate: 'High-severity risk in {{project.name}}: {{entity.title}} ({{entity.severity}})', title: 'Portfolio Risk Escalation' },
          }],
        },
      },
      {
        name: 'Audit Log on Risk Status Change',
        description: 'Track all risk status transitions for compliance.',
        triggerEventType: 'risk.status_changed',
        triggerEntityType: 'risk',
        scope: 'project',
        definition: {
          actions: [{
            id: 'a1', type: 'log_audit', runOrder: 0,
            params: { messageTemplate: 'Risk "{{entity.title}}" status changed from {{previous.status}} to {{entity.status}}', action: 'risk_status_change' },
          }],
        },
      },
    ],
  },
  {
    id: 'quality-assurance',
    name: 'Quality Assurance',
    description: 'Track milestone completions and sprint deliverables.',
    category: 'delivery',
    icon: 'check-check',
    automations: [
      {
        name: 'Notify on Milestone Completion',
        description: 'Notify when a milestone task is completed.',
        triggerEventType: 'task.completed',
        triggerEntityType: 'task',
        scope: 'project',
        definition: {
          conditions: { logic: 'and', conditions: [{ field: 'isMilestone', operator: 'equals', value: true }] },
          actions: [{
            id: 'a1', type: 'notify', runOrder: 0,
            params: { recipients: 'project_owner', messageTemplate: 'Milestone completed: {{entity.name}}', title: 'Milestone Reached', severity: 'low' },
          }],
        },
      },
      {
        name: 'Escalate Incomplete Sprint Deliverables',
        description: 'Alert when a sprint completes with unfinished tasks.',
        triggerEventType: 'sprint.completed',
        triggerEntityType: 'sprint',
        scope: 'project',
        definition: {
          actions: [{
            id: 'a1', type: 'escalate', runOrder: 0,
            params: { recipients: 'project_owner', messageTemplate: 'Sprint "{{entity.name}}" completed. Review unfinished items.', title: 'Sprint Review Required' },
          }],
        },
      },
      {
        name: 'Audit Log on Task Completion',
        description: 'Track all task completions for delivery reporting.',
        triggerEventType: 'task.completed',
        triggerEntityType: 'task',
        scope: 'project',
        definition: {
          actions: [{
            id: 'a1', type: 'log_audit', runOrder: 0,
            params: { messageTemplate: 'Task "{{entity.name}}" completed by {{user.email}}', action: 'task_completed' },
          }],
        },
      },
    ],
  },
  {
    id: 'budget-oversight',
    name: 'Budget Oversight',
    description: 'Monitor project spending and status transitions.',
    category: 'financial',
    icon: 'banknote',
    automations: [
      {
        name: 'Notify on Large Time Entry',
        description: 'Alert when a time entry exceeds 8 hours.',
        triggerEventType: 'time_entry.created',
        triggerEntityType: 'time_entry',
        scope: 'project',
        definition: {
          conditions: { logic: 'and', conditions: [{ field: 'hours', operator: 'greater_than', value: 8 }] },
          actions: [{
            id: 'a1', type: 'notify', runOrder: 0,
            params: { recipients: 'project_owner', messageTemplate: 'Large time entry logged: {{entity.hours}}h by {{user.email}}', title: 'Time Entry Alert', severity: 'medium' },
          }],
        },
      },
      {
        name: 'Audit Log on Project Status Change',
        description: 'Record all project status transitions for financial compliance.',
        triggerEventType: 'project.status_changed',
        triggerEntityType: 'project',
        scope: 'project',
        definition: {
          actions: [{
            id: 'a1', type: 'log_audit', runOrder: 0,
            params: { messageTemplate: 'Project status changed from {{previous.status}} to {{entity.status}}', action: 'project_status_change' },
          }],
        },
      },
    ],
  },
];
