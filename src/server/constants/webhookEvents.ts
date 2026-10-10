/**
 * Every event the app sends to webhooks — the one list. `webhookService.dispatch` takes only
 * these names (so a new event must be added here), and Settings → Webhooks offers the same list
 * (client copy `src/client/src/constants/webhookEvents.ts`, kept equal by a client test).
 */
export const WEBHOOK_EVENTS = [
  'task.created', 'task.updated', 'task.deleted',
  'project.created', 'project.updated',
  'proposal.created', 'proposal.accepted',
  'sprint.created', 'sprint.started', 'sprint.completed',
  'risk.created', 'risk.updated',
  'change_request.created', 'change_request.approved', 'change_request.rejected', 'change_request.returned', 'change_request.withdrawn',
  'agent.scan_completed',
] as const;

export type WebhookEvent = typeof WEBHOOK_EVENTS[number];
