import { customFieldRepository, CustomField, CustomFieldValue } from '../database/CustomFieldRepository';

export type { CustomField, CustomFieldValue } from '../database/CustomFieldRepository';

export class CustomFieldService {
  async createField(data: {
    projectId: string;
    entityType: string;
    fieldName: string;
    fieldLabel: string;
    fieldType: string;
    options?: string[];
    isRequired?: boolean;
    sortOrder?: number;
    createdBy: string;
  }): Promise<CustomField> {
    return customFieldRepository.insertField(data);
  }

  async getFieldsByProject(projectId: string, entityType?: string): Promise<CustomField[]> {
    return customFieldRepository.findByProject(projectId, entityType);
  }

  async updateField(id: string, data: { fieldLabel?: string; fieldType?: string; options?: string[]; isRequired?: boolean; sortOrder?: number }): Promise<CustomField> {
    return customFieldRepository.updateField(id, data);
  }

  async deleteField(id: string): Promise<void> {
    return customFieldRepository.deleteField(id);
  }

  async getValues(entityType: string, entityId: string, projectId: string): Promise<Array<CustomField & { value: CustomFieldValue | null }>> {
    const fields = await customFieldRepository.findByProject(projectId, entityType);
    if (fields.length === 0) return [];

    const fieldIds = fields.map(f => f.id);
    const values = await customFieldRepository.findValues(fieldIds, entityId);
    const valueMap = new Map(values.map(v => [v.fieldId, v]));

    return fields.map(f => ({
      ...f,
      value: valueMap.get(f.id) || null,
    }));
  }

  async setValue(fieldId: string, entityId: string, value: { text?: string; number?: number; date?: string; boolean?: boolean }): Promise<CustomFieldValue> {
    const field = await customFieldRepository.findById(fieldId);
    if (!field) throw new Error('Field not found');
    return customFieldRepository.upsertValue(fieldId, entityId, value);
  }

  /**
   * Which project a save of these values is in — or why it is refused. Every field must exist,
   * be for this kind of item, and belong to the SAME project as the item itself (and as the
   * projectId the caller named, if any). Only body.projectId (or the first field's project) used to
   * be checked, so a PM of project A could write values onto a task of project B (2026-10-09 audit M7).
   */
  async projectForValues(
    entityType: string, entityId: string, fieldIds: string[], namedProjectId?: string,
  ): Promise<{ projectId: string } | { status: 400 | 404; message: string }> {
    const owners = await customFieldRepository.fieldOwners([...new Set(fieldIds)]);
    const projects = new Set<string>();
    for (const id of fieldIds) {
      const owner = owners.get(id);
      if (!owner) return { status: 404, message: 'One of these custom fields no longer exists.' };
      if (owner.entityType !== entityType) return { status: 400, message: `A custom field for a ${owner.entityType} can't be set on a ${entityType}.` };
      projects.add(owner.projectId);
    }
    if (projects.size > 1) return { status: 400, message: 'Save the custom fields of one project at a time.' };
    const [fieldsProject] = [...projects];
    // an item of another project answers like a missing one (it says nothing about that project)
    const itemProject = await customFieldRepository.itemProjectId(entityType, entityId);
    if (!itemProject || itemProject !== fieldsProject || (namedProjectId && namedProjectId !== itemProject)) {
      return { status: 404, message: `That ${entityType} was not found in this project.` };
    }
    return { projectId: itemProject };
  }

  /** Save several values for one item in one go — after projectForValues has checked them */
  async bulkSetValues(entityId: string, values: Array<{ fieldId: string; text?: string; number?: number; date?: string; boolean?: boolean }>): Promise<void> {
    await customFieldRepository.upsertValues(entityId, values);
  }
}

export const customFieldService = new CustomFieldService();
