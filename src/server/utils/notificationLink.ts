/**
 * Where a notification takes you — the server copy of src/client/src/utils/notificationLink.ts,
 * used for the "View Details" button in notification emails. Change both together; each side
 * has a test with the same table.
 *
 * Emails used to link to `${APP_URL}/${linkType}s/${linkId}` (/tasks/…, /raids/…), which
 * are not pages in the app.
 */
export interface NotificationTarget {
  linkType?: string | null;
  linkId?: string | null;
  projectId?: string | null;
  scheduleId?: string | null;
}

/** Path inside the app (no host), or null when there is nowhere useful to go. */
export function notificationPath(n: NotificationTarget): string | null {
  const p = n.projectId || null;
  const project = (tab?: string) => (p ? `/project/${p}${tab ? `?tab=${tab}` : ''}` : null);
  switch (n.linkType) {
    case 'task': {
      if (!p || !n.linkId) return project('schedule');
      const params = new URLSearchParams({ tab: 'schedule' });
      if (n.scheduleId) params.set('schedule', n.scheduleId);
      params.set('task', n.linkId);
      return `/project/${p}?${params.toString()}`;
    }
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
