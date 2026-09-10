import type { AutomationEvent, AutomationContext } from './types';
import logger from '../../utils/logger';

export async function buildContext(event: AutomationEvent): Promise<AutomationContext> {
  const context: AutomationContext = {
    event,
    entity: event.payload,
    previous: event.previous,
  };

  // Fetch full entity if we only have an ID
  try {
    switch (event.entityType) {
      case 'task': {
        if (!event.payload.name) {
          const { scheduleService } = await import('../ScheduleService');
          const task = await scheduleService.findTaskById(event.entityId);
          if (task) context.entity = task as any;
        }
        break;
      }
      case 'project': {
        if (!event.payload.name) {
          const { projectService } = await import('../ProjectService');
          const project = await projectService.findById(event.entityId);
          if (project) context.entity = project as any;
        }
        break;
      }
      case 'risk': {
        if (!event.payload.title) {
          const { riskService } = await import('../RiskService');
          const risk = await riskService.findById(event.entityId);
          if (risk) context.entity = risk as any;
        }
        break;
      }
    }

    // Fetch project context
    if (event.projectId) {
      const { projectService } = await import('../ProjectService');
      const project = await projectService.findById(event.projectId);
      if (project) context.project = project as any;
    }
  } catch (err) {
    logger.warn('[AutomationContextBuilder] Failed to enrich context:', err);
  }

  return context;
}
