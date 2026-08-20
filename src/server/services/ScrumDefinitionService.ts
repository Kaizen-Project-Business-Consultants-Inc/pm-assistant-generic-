import { v4 as uuidv4 } from 'uuid';
import { scrumDefinitionRepository, ScrumDefinition, ScrumDefinitionCriterion } from '../database/ScrumDefinitionRepository';
import { taskChecklistRepository, TaskChecklist, TaskChecklistItem } from '../database/TaskChecklistRepository';

class ScrumDefinitionService {
  async getDefinitions(projectId: string): Promise<{ dor: ScrumDefinition | null; dod: ScrumDefinition | null }> {
    const defs = await scrumDefinitionRepository.findByProject(projectId);
    return {
      dor: defs.find((d) => d.type === 'dor') || null,
      dod: defs.find((d) => d.type === 'dod') || null,
    };
  }

  async upsertDefinition(projectId: string, type: 'dor' | 'dod', criteria: ScrumDefinitionCriterion[], userId: string): Promise<ScrumDefinition> {
    return scrumDefinitionRepository.upsert(projectId, type, criteria, userId);
  }

  async initializeChecklist(taskId: string, projectId: string, type: 'dor' | 'dod'): Promise<TaskChecklist> {
    const definition = await scrumDefinitionRepository.findByProjectAndType(projectId, type);
    if (!definition || definition.criteria.length === 0) {
      throw new Error(`No ${type.toUpperCase()} template defined for this project`);
    }

    const items: TaskChecklistItem[] = definition.criteria.map((c) => ({
      id: c.id,
      label: c.label,
      checked: false,
    }));

    return taskChecklistRepository.upsert(taskId, projectId, type, items);
  }

  async updateChecklistItem(checklistId: string, criterionId: string, checked: boolean): Promise<TaskChecklist> {
    const checklist = await taskChecklistRepository.findById(checklistId);
    if (!checklist) throw new Error('Checklist not found');

    const updatedItems = checklist.items.map((item) =>
      item.id === criterionId ? { ...item, checked } : item,
    );

    const updated = await taskChecklistRepository.updateItems(checklistId, updatedItems);
    if (!updated) throw new Error('Failed to update checklist');
    return updated;
  }

  async getTaskChecklists(taskId: string): Promise<{ dor: TaskChecklist | null; dod: TaskChecklist | null }> {
    const checklists = await taskChecklistRepository.findByTask(taskId);
    return {
      dor: checklists.find((c) => c.type === 'dor') || null,
      dod: checklists.find((c) => c.type === 'dod') || null,
    };
  }

  async getReadinessBulk(taskIds: string[], type: 'dor' | 'dod'): Promise<Record<string, { ready: boolean; checked: number; total: number }>> {
    return taskChecklistRepository.getReadinessBulk(taskIds, type);
  }
}

export const scrumDefinitionService = new ScrumDefinitionService();
