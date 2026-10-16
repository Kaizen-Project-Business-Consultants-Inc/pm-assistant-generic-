/**
 * Every event the server sends to webhooks — a copy of src/server/constants/webhookEvents.ts
 * (the client can't import server code); a test keeps the two equal.
 */
export const WEBHOOK_EVENTS = [
  'task.created', 'task.updated', 'task.deleted',
  'project.created', 'project.updated',
  'proposal.created', 'proposal.accepted',
  'sprint.created', 'sprint.started', 'sprint.completed',
  'risk.created', 'risk.updated',
  'change_request.created', 'change_request.approved', 'change_request.rejected', 'change_request.returned', 'change_request.withdrawn',
  'agent.scan_completed',
];

/** Each event in plain words (UAT U9), by area then action; the code name stays beside it for whoever sets up the other system */
const LABELS: Record<string, Record<string, string>> = {
  task: { created: 'A task is added', updated: 'A task is changed', deleted: 'A task is deleted' },
  project: { created: 'A project is created', updated: 'A project is changed' },
  proposal: { created: 'An AI suggestion is made', accepted: 'An AI suggestion is accepted' },
  sprint: { created: 'A sprint is planned', started: 'A sprint starts', completed: 'A sprint ends' },
  risk: { created: 'A risk or issue is logged', updated: 'A risk or issue is changed' },
  change_request: {
    created: 'A change request is raised', approved: 'A change request is approved', rejected: 'A change request is rejected',
    returned: 'A change request is sent back for changes', withdrawn: 'A change request is withdrawn',
  },
  agent: { scan_completed: 'An AI check finishes' },
};

export const webhookEventLabel = (event: string): string => {
  const [area, action] = event.split('.');
  return LABELS[area]?.[action] ?? event;
};
