/**
 * Where a notification takes you. One rule for the bell, the Notifications page and the
 * dashboard feeds — and the same table as src/server/utils/notificationLink.ts, which puts
 * it on the "View Details" button in notification emails. Change both together.
 *
 * Before this, emails linked to /tasks/<id>, /raids/<id> … (pages that don't exist) and the
 * bell only let you click agent proposals.
 */
import { taskLink } from './briefingByProject';

export interface NotificationTarget {
  linkType?: string | null;
  linkId?: string | null;
  projectId?: string | null;
  scheduleId?: string | null;
}

export function notificationLink(n: NotificationTarget): string | null {
  const p = n.projectId || null;
  const project = (tab?: string) => (p ? `/project/${p}${tab ? `?tab=${tab}` : ''}` : null);
  switch (n.linkType) {
    case 'task':
      return p && n.linkId ? taskLink(p, n.scheduleId ?? undefined, n.linkId) : project('schedule');
    case 'schedule':
      return p ? `/project/${p}?tab=schedule${n.linkId ? `&schedule=${n.linkId}` : ''}` : null;
    case 'raid':
      return project('raid');
    case 'change_request':
      return project('change-requests') ?? '/change-requests';
    case 'project':
      return n.linkId ? `/project/${n.linkId}` : project();
    case 'evm':
      return project('performance');
    case 'time':
      return project('time') ?? '/timesheet';
    case 'timesheet':
      return '/timesheet';
    case 'meeting':
    case 'meeting_action_item':
      return '/meetings';
    case 'proposal':
      return '/agent';
    case 'resource_request':
      return '/resources';
    default:
      return project();
  }
}

/**
 * A proactive alert (GET /alerts) as a bell entry. Alerts carry `description` (not
 * `message`) and a `taskId` — both used to be dropped, so alerts showed no text and
 * "Overdue: <task>" opened the project instead of the task.
 */
export function alertAsNotification(a: {
  description?: string; message?: string; taskId?: string; scheduleId?: string;
}): { message: string; linkType?: string; linkId?: string; scheduleId?: string } {
  return {
    message: a.message ?? a.description ?? '',
    ...(a.taskId ? { linkType: 'task', linkId: a.taskId, scheduleId: a.scheduleId } : {}),
  };
}
