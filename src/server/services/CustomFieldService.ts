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

  async bulkSetValues(entityId: string, values: Array<{ fieldId: string; text?: string; number?: number; date?: string; boolean?: boolean }>): Promise<void> {
    // every field is checked before anything is saved (a missing one used to stop half-way)
    const existing = await customFieldRepository.existingFieldIds([...new Set(values.map(v => v.fieldId))]);
    if (values.some(v => !existing.has(v.fieldId))) throw new Error('Field not found');
    await customFieldRepository.upsertValues(entityId, values);
  }
}

export const customFieldService = new CustomFieldService();
