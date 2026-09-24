import { databaseService } from './connection';
import type { ResultSetHeader } from 'mysql2';

export type RowMapper<T> = (row: any) => T;

export interface RepositoryOptions {
  controlPlane?: boolean;  // default: false (tenant-routed)
}

// Allowlist pattern for ORDER BY clauses: column names, optional ASC/DESC, optional comma-separated
const SAFE_ORDER_BY = /^[a-zA-Z_][a-zA-Z0-9_]*(\s+(ASC|DESC))?(,\s*[a-zA-Z_][a-zA-Z0-9_]*(\s+(ASC|DESC))?)*$/i;

// Allowlist pattern for column names used in dynamic WHERE clauses
const SAFE_COLUMN_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export class BaseRepository<T> {
  constructor(
    protected readonly tableName: string,
    protected readonly rowMapper: RowMapper<T>,
    protected readonly options: RepositoryOptions = {},
  ) {}

  async findById(id: string): Promise<T | null> {
    const rows = await this.queryRaw(
      `SELECT * FROM ${this.tableName} WHERE id = ?`,
      [id],
    );
    return rows.length > 0 ? this.rowMapper(rows[0]) : null;
  }

  async findAll(limit = 1000): Promise<T[]> {
    const rows = await this.queryRaw(
      `SELECT * FROM ${this.tableName} ORDER BY created_at DESC LIMIT ?`,
      [limit],
    );
    return rows.map(this.rowMapper);
  }

  async deleteById(id: string, ...extraWhere: { column: string; value: any }[]): Promise<boolean> {
    let sql = `DELETE FROM ${this.tableName} WHERE id = ?`;
    const params: any[] = [id];
    for (const w of extraWhere) {
      if (!SAFE_COLUMN_NAME.test(w.column)) {
        throw new Error(`Invalid column name: ${w.column}`);
      }
      sql += ` AND ${w.column} = ?`;
      params.push(w.value);
    }
    const result = await this.queryRaw(sql, params) as unknown as ResultSetHeader;
    return (result.affectedRows ?? 0) > 0;
  }

  async countWhere(where: string, params: any[]): Promise<number> {
    const rows = await this.queryRaw(
      `SELECT COUNT(*) AS cnt FROM ${this.tableName} WHERE ${where}`,
      params,
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  async queryPaginated(
    where: string,
    params: any[],
    orderBy: string,
    limit: number,
    offset: number,
  ): Promise<{ rows: T[]; total: number }> {
    if (!SAFE_ORDER_BY.test(orderBy)) {
      throw new Error(`Invalid ORDER BY clause: ${orderBy}`);
    }
    const [countResult, dataRows] = await Promise.all([
      this.queryRaw(
        `SELECT COUNT(*) AS cnt FROM ${this.tableName} WHERE ${where}`,
        params,
      ),
      this.queryRaw(
        `SELECT * FROM ${this.tableName} WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      ),
    ]);
    return {
      rows: dataRows.map(this.rowMapper),
      total: Number(countResult[0]?.cnt ?? 0),
    };
  }

  buildUpdate(
    data: Record<string, any>,
    columnMap: Record<string, string>,
    valueTransform?: (key: string, value: any) => any,
  ): { sql: string; values: any[] } | null {
    const fields: string[] = [];
    const values: any[] = [];

    for (const [key, column] of Object.entries(columnMap)) {
      // `key in data` is true even for a key present with value `undefined` —
      // which routes.ts handlers sometimes produce defensively (e.g.
      // `startDate: parsed.startDate || undefined`) — and wrote NULL over a
      // column the caller never touched. Checking the value itself is the
      // correct partial-update semantics: only an explicit `null` clears a
      // column; a genuinely omitted/undefined field leaves it alone.
      if (data[key] !== undefined) {
        fields.push(`${column} = ?`);
        let val = data[key];
        if (valueTransform) {
          val = valueTransform(key, val);
        }
        values.push(val ?? null);
      }
    }

    if (fields.length === 0) return null;

    return {
      sql: `UPDATE ${this.tableName} SET ${fields.join(', ')} WHERE id = ?`,
      values,
    };
  }

  protected async queryRaw(sql: string, params: any[] = []): Promise<any[]> {
    if (this.options.controlPlane) {
      return databaseService.queryControlPlane(sql, params);
    }
    return databaseService.query(sql, params);
  }

  /**
   * Query the control plane database, bypassing tenant context.
   * Use this in repositories for tables that live in the control plane (users, api_keys).
   */
  protected async queryControlPlaneRaw(sql: string, params: any[] = []): Promise<any[]> {
    return databaseService.queryControlPlane(sql, params);
  }

  protected mapRows(rows: any[]): T[] {
    return rows.map(this.rowMapper);
  }
}
