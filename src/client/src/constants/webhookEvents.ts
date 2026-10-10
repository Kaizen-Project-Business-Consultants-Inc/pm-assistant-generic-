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
