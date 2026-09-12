export interface AutomationEventTypeInfo {
  type: string;
  entityType: string;
  description: string;
}

export const AUTOMATION_EVENT_TYPES: AutomationEventTypeInfo[] = [
  // Task events
  { type: 'task.created', entityType: 'task', description: 'A new task is created' },
  { type: 'task.updated', entityType: 'task', description: 'A task is updated' },
  { type: 'task.deleted', entityType: 'task', description: 'A task is deleted' },
  { type: 'task.status_changed', entityType: 'task', description: 'A task status changes' },
  { type: 'task.assigned', entityType: 'task', description: 'A task is assigned or reassigned' },
  { type: 'task.completed', entityType: 'task', description: 'A task is marked as completed' },

  // Project events
  { type: 'project.created', entityType: 'project', description: 'A new project is created' },
  { type: 'project.updated', entityType: 'project', description: 'A project is updated' },
  { type: 'project.status_changed', entityType: 'project', description: 'A project status changes' },

  // Risk events
  { type: 'risk.created', entityType: 'risk', description: 'A new RAID item is created' },
  { type: 'risk.updated', entityType: 'risk', description: 'A RAID item is updated' },
  { type: 'risk.status_changed', entityType: 'risk', description: 'A RAID item status changes' },

  // Sprint events
  { type: 'sprint.created', entityType: 'sprint', description: 'A new sprint is created' },
  { type: 'sprint.started', entityType: 'sprint', description: 'A sprint is started' },
  { type: 'sprint.completed', entityType: 'sprint', description: 'A sprint is completed' },

  // Change request events
  { type: 'change_request.created', entityType: 'change_request', description: 'A change request is created' },
  { type: 'change_request.approved', entityType: 'change_request', description: 'A change request is approved' },
  { type: 'change_request.rejected', entityType: 'change_request', description: 'A change request is rejected' },
  { type: 'change_request.returned', entityType: 'change_request', description: 'A change request is returned for revision' },
  { type: 'change_request.withdrawn', entityType: 'change_request', description: 'A change request is withdrawn' },

  // Proposal events
  { type: 'proposal.created', entityType: 'proposal', description: 'A reschedule proposal is created' },
  { type: 'proposal.accepted', entityType: 'proposal', description: 'A reschedule proposal is accepted' },

  // Time entry events
  { type: 'time_entry.created', entityType: 'time_entry', description: 'A time entry is logged' },
  { type: 'time_entry.updated', entityType: 'time_entry', description: 'A time entry is updated' },
  { type: 'time_entry.deleted', entityType: 'time_entry', description: 'A time entry is deleted' },
  { type: 'timesheet.submitted', entityType: 'timesheet', description: 'A timesheet is submitted for approval' },

  // Schedule-based triggers (time-driven, not event-driven)
  { type: 'schedule.interval', entityType: 'schedule', description: 'Runs at a recurring interval (every N minutes)' },
  { type: 'schedule.daily', entityType: 'schedule', description: 'Runs once daily at a specific time' },
  { type: 'schedule.weekly', entityType: 'schedule', description: 'Runs once weekly on a specific day and time' },
  { type: 'schedule.monthly', entityType: 'schedule', description: 'Runs once monthly on a specific day and time' },
  { type: 'schedule.cron', entityType: 'schedule', description: 'Runs on a custom cron expression' },
];
