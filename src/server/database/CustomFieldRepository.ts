import { BaseRepository } from './BaseRepository';
import { v4 as uuidv4 } from 'uuid';

export interface CustomField {
  id: string;
  projectId: string;
  entityType: string;
  fieldName: string;
  fieldLabel: string;
  fieldType: string;
  options: string[] | null;
  isRequired: boolean;
  sortOrder: number;
  createdBy: string;
  createdAt: string;
}

export interface CustomFieldValue {
  id: string;
  fieldId: string;
  entityId: string;
  valueText: string | null;
  valueNumber: number | null;
  valueDate: string | null;
  valueBoolean: boolean | null;
  createdAt: string;
  updatedAt: string;
}

function fieldRowToDTO(row: any): CustomField {
  let opts: string[] | null = null;
  if (row.options) {
    try { opts = typeof row.options === 'string' ? JSON.parse(row.options) : row.options; } catch { opts = null; }
  }
  return {
    id: row.id,
    projectId: row.project_id,
    entityType: row.entity_type,
    fieldName: row.field_name,
    fieldLabel: row.field_label,
    fieldType: row.field_type,
    options: opts,
    isRequired: !!row.is_required,
    sortOrder: row.sort_order,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function valueRowToDTO(row: any): CustomFieldValue {
  return {
    id: row.id,
    fieldId: row.field_id,
    entityId: row.entity_id,
    valueText: row.value_text,
    valueNumber: row.value_number != null ? Number(row.value_number) : null,
    valueDate: row.value_date ? (typeof row.value_date === 'string' ? row.value_date : new Date(row.value_date).toISOString().slice(0, 10)) : null,
    valueBoolean: row.value_boolean != null ? !!row.value_boolean : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class CustomFieldRepository extends BaseRepository<CustomField> {
  constructor() {
    super('custom_fields', fieldRowToDTO);
  }

  async insertField(data: {
    projectId: string; entityType: string; fieldName: string; fieldLabel: string;
    fieldType: string; options?: string[]; isRequired?: boolean; sortOrder?: number; createdBy: string;
  }): Promise<CustomField> {
    const id = uuidv4();
    await this.queryRaw(
      `INSERT INTO custom_fields (id, project_id, entity_type, field_name, field_label, field_type, options, is_required, sort_order, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.projectId, data.entityType, data.fieldName, data.fieldLabel, data.fieldType,
       data.options ? JSON.stringify(data.options) : null, data.isRequired || false, data.sortOrder || 0, data.createdBy],
    );
    return (await this.findById(id))!;
  }

  async findByProject(projectId: string, entityType?: string): Promise<CustomField[]> {
    let sql = 'SELECT * FROM custom_fields WHERE project_id = ?';
    const params: any[] = [projectId];
    if (entityType) { sql += ' AND entity_type = ?'; params.push(entityType); }
    sql += ' ORDER BY sort_order, created_at';
    const rows = await this.queryRaw(sql, params);
    return this.mapRows(rows);
  }

  async updateField(id: string, data: { fieldLabel?: string; fieldType?: string; options?: string[]; isRequired?: boolean; sortOrder?: number }): Promise<CustomField> {
    const sets: string[] = [];
    const params: any[] = [];
    if (data.fieldLabel !== undefined) { sets.push('field_label = ?'); params.push(data.fieldLabel); }
    if (data.fieldType !== undefined) { sets.push('field_type = ?'); params.push(data.fieldType); }
    if (data.options !== undefined) { sets.push('options = ?'); params.push(JSON.stringify(data.options)); }
    if (data.isRequired !== undefined) { sets.push('is_required = ?'); params.push(data.isRequired); }
    if (data.sortOrder !== undefined) { sets.push('sort_order = ?'); params.push(data.sortOrder); }
    if (sets.length > 0) {
      params.push(id);
      await this.queryRaw(`UPDATE custom_fields SET ${sets.join(', ')} WHERE id = ?`, params);
    }
    return (await this.findById(id))!;
  }

  async deleteField(id: string): Promise<void> {
    await this.queryRaw('DELETE FROM custom_fields WHERE id = ?', [id]);
  }

  // --- Custom Field Values ---

  async findValues(fieldIds: string[], entityId: string): Promise<CustomFieldValue[]> {
    if (fieldIds.length === 0) return [];
    const placeholders = fieldIds.map(() => '?').join(',');
    const rows = await this.queryRaw(
      `SELECT * FROM custom_field_values WHERE field_id IN (${placeholders}) AND entity_id = ?`,
      [...fieldIds, entityId],
    );
    return rows.map(valueRowToDTO);
  }

  /** These fields' project and kind of item, by id (a missing field is simply absent) */
  async fieldOwners(fieldIds: string[]): Promise<Map<string, { projectId: string; entityType: string }>> {
    if (fieldIds.length === 0) return new Map();
    const rows = await this.queryRaw(
      `SELECT id, project_id, entity_type FROM custom_fields WHERE id IN (${fieldIds.map(() => '?').join(',')})`, fieldIds);
    return new Map(rows.map((r: any) => [r.id, { projectId: r.project_id, entityType: r.entity_type }]));
  }

  /** The project a task or project item belongs to, or null (unknown kind, or not found) */
  async itemProjectId(entityType: string, entityId: string): Promise<string | null> {
    if (entityType === 'project') {
      const rows = await this.queryRaw('SELECT id FROM projects WHERE id = ? LIMIT 1', [entityId]);
      return rows[0]?.id ?? null;
    }
    if (entityType === 'task') {
      const rows = await this.queryRaw(
        'SELECT s.project_id FROM tasks t JOIN schedules s ON s.id = t.schedule_id WHERE t.id = ? LIMIT 1', [entityId]);
      return rows[0]?.project_id ?? null;
    }
    return null;
  }

  /**
   * Several values for one item in one statement (was 3 per value; 2026-10-09). (field, item) is
   * unique, so a value already there is overwritten, as upsertValue does; a field listed twice keeps
   * its last value.
   */
  async upsertValues(entityId: string, list: Array<{ fieldId: string; text?: string; number?: number; date?: string; boolean?: boolean }>): Promise<void> {
    const values = [...new Map(list.map(v => [v.fieldId, v])).values()]; // a field listed twice: its last value
    if (values.length === 0) return;
    await this.queryRaw(
      `INSERT INTO custom_field_values (id, field_id, entity_id, value_text, value_number, value_date, value_boolean)
       VALUES ${values.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')}
       ON DUPLICATE KEY UPDATE value_text = VALUES(value_text), value_number = VALUES(value_number), value_date = VALUES(value_date), value_boolean = VALUES(value_boolean)`,
      values.flatMap(v => [uuidv4(), v.fieldId, entityId, v.text ?? null, v.number ?? null, v.date ?? null, v.boolean ?? null]),
    );
  }

  async findValue(fieldId: string, entityId: string): Promise<CustomFieldValue | null> {
    const rows = await this.queryRaw(
      'SELECT * FROM custom_field_values WHERE field_id = ? AND entity_id = ?',
      [fieldId, entityId],
    );
    return rows.length > 0 ? valueRowToDTO(rows[0]) : null;
  }

  async upsertValue(fieldId: string, entityId: string, value: { text?: string; number?: number; date?: string; boolean?: boolean }): Promise<CustomFieldValue> {
    const existing = await this.findValue(fieldId, entityId);

    if (existing) {
      await this.queryRaw(
        `UPDATE custom_field_values SET value_text = ?, value_number = ?, value_date = ?, value_boolean = ? WHERE field_id = ? AND entity_id = ?`,
        [value.text ?? null, value.number ?? null, value.date ?? null, value.boolean ?? null, fieldId, entityId],
      );
    } else {
      const id = uuidv4();
      await this.queryRaw(
        `INSERT INTO custom_field_values (id, field_id, entity_id, value_text, value_number, value_date, value_boolean)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, fieldId, entityId, value.text ?? null, value.number ?? null, value.date ?? null, value.boolean ?? null],
      );
    }

    return (await this.findValue(fieldId, entityId))!;
  }
}

export const customFieldRepository = new CustomFieldRepository();
