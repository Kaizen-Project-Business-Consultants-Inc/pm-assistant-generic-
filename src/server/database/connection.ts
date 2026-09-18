import mysql from 'mysql2/promise';
import { config } from '../config';
import logger from '../utils/logger';

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  waitForConnections: boolean;
  connectionLimit: number;
  maxIdle: number;
  connectTimeout: number;
  idleTimeout: number;
  queueLimit: number;
}

// Tables that exist ONLY in the control plane DB (not in tenant DBs).
// Querying these via tenant-routed query() will fail with "table doesn't exist".
const CONTROL_PLANE_ONLY_TABLES = new Set([
  'users', 'organizations', 'subscriptions', 'subscription_events',
  'api_keys', 'api_key_usage_log', 'invite_tokens',
  'pricing_config', 'tier_features', 'token_top_ups',
  'ai_conversations', 'ai_feedback', 'ai_accuracy_tracking', 'feedback',
  'oauth_auth_codes', 'oauth_clients', 'oauth_tokens',
]);

// Extract the first table name from a SQL statement (handles FROM, INTO, UPDATE, DELETE FROM, JOIN)
function extractTableName(sql: string): string | null {
  const match = sql.match(/(?:FROM|INTO|UPDATE|JOIN)\s+`?(\w+)`?/i);
  return match ? match[1] : null;
}

class DatabaseService {
  private pool: mysql.Pool | null = null;
  private isConnected = false;

  constructor() {
    this.initializePool();
  }

  private initializePool(): void {
    try {
      const dbConfig: DatabaseConfig = {
        host: config.DB_HOST,
        port: config.DB_PORT,
        user: config.DB_USER,
        password: config.DB_PASSWORD,
        database: config.DB_NAME,
        waitForConnections: true,
        connectionLimit: config.DB_CONNECTION_LIMIT,
        maxIdle: config.DB_MAX_IDLE,
        connectTimeout: config.DB_CONNECT_TIMEOUT,
        idleTimeout: config.DB_IDLE_TIMEOUT,
        queueLimit: config.DB_QUEUE_LIMIT,
      };

      this.pool = mysql.createPool({ ...dbConfig, dateStrings: true, charset: 'utf8mb4' });
      this.isConnected = true;
      logger.info('Database connection pool initialized', {
        connectionLimit: dbConfig.connectionLimit,
        maxIdle: dbConfig.maxIdle,
        idleTimeout: dbConfig.idleTimeout,
        queueLimit: dbConfig.queueLimit,
      });
    } catch (error) {
      logger.error('Failed to initialize database connection pool', { error });
      this.isConnected = false;
    }
  }

  private getTenantDbName(): string | undefined {
    if (!config.MULTI_TENANT_ENABLED) return undefined;
    // Lazy import to avoid circular dependency at module load time
    const { getRequestContext } = require('../middleware/requestContext');
    const ctx = getRequestContext();
    return ctx?.tenantDbName;
  }

  public async getConnection(): Promise<mysql.PoolConnection> {
    if (!this.pool) {
      throw new Error('Database pool not initialized');
    }
    const conn = await this.pool.getConnection();
    const tenantDb = this.getTenantDbName();
    if (tenantDb) {
      await conn.query(`USE \`${tenantDb}\``);
    }
    return conn;
  }

  /**
   * Run a statement on a connection that has just had `USE <db>` applied.
   *
   * MUST use conn.query(), never conn.execute(). mysql2 caches prepared statements per
   * connection keyed by SQL text, and a prepared statement stays bound to the database
   * it was prepared against. On a pooled connection that has since switched tenants,
   * conn.execute() therefore runs against the PREVIOUS tenant's database and silently
   * ignores the USE — proven on staging 2026-09-18, where `SELECT DATABASE()` itself
   * reported the stale database, and a backfill inserted one customer's rows into
   * another customer's tenant.
   *
   * conn.query() with placeholders is still parameterised (client-side escaping), so
   * this is not a SQL-injection regression. It gives up prepared-statement reuse, which
   * is the correct trade for guaranteed tenant isolation.
   */
  private async runOnConnection<T>(conn: mysql.PoolConnection, sql: string, params: any[]): Promise<T[]> {
    const [rows] = await conn.query(sql, params);
    return rows as T[];
  }

  public async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    if (!this.pool) {
      throw new Error('Database pool not initialized');
    }
    const tenantDb = this.getTenantDbName();
    // Dev-mode guard: warn when a control plane table is queried via tenant-routed path
    if (tenantDb && process.env.NODE_ENV === 'development') {
      const table = extractTableName(sql);
      if (table && CONTROL_PLANE_ONLY_TABLES.has(table)) {
        logger.warn(`[DB] Control plane table "${table}" queried via tenant-routed query(). Use queryControlPlane() instead. SQL: ${sql.substring(0, 120)}`);
      }
    }
    if (tenantDb) {
      const conn = await this.pool.getConnection();
      try {
        await conn.query(`USE \`${tenantDb}\``);
        return this.runOnConnection<T>(conn, sql, params);
      } finally {
        conn.release();
      }
    }
    const [rows] = await this.pool.execute(sql, params);
    return rows as T[];
  }

  /**
   * Run a statement on a caller-supplied connection (transactions).
   *
   * Also query(), not execute(): getConnection() applies `USE <tenant>` before handing
   * the connection over, so the same stale prepared-statement problem applies. See
   * runOnConnection above.
   */
  public async queryOn<T = any>(connection: mysql.PoolConnection, sql: string, params: any[] = []): Promise<T[]> {
    return this.runOnConnection<T>(connection, sql, params);
  }

  /**
   * Execute a query explicitly against the control plane database,
   * bypassing any tenant context from AsyncLocalStorage.
   */
  public async queryControlPlane<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    if (!this.pool) {
      throw new Error('Database pool not initialized');
    }
    if (config.MULTI_TENANT_ENABLED) {
      const conn = await this.pool.getConnection();
      try {
        await conn.query(`USE \`${config.DB_NAME}\``);
        return this.runOnConnection<T>(conn, sql, params);
      } finally {
        conn.release();
      }
    }
    const [rows] = await this.pool.execute(sql, params);
    return rows as T[];
  }

  public async transaction<T>(callback: (connection: mysql.PoolConnection) => Promise<T>): Promise<T> {
    const connection = await this.getConnection();
    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  public async testConnection(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch (error) {
      logger.error('Database connection test failed', { error });
      return false;
    }
  }

  public async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.isConnected = false;
      logger.info('Database connection pool closed');
    }
  }

  public isHealthy(): boolean {
    return this.isConnected && this.pool !== null;
  }

  /**
   * Get the underlying pool for direct connection management (e.g., tenant provisioning).
   * Use with caution — prefer query() or getConnection() for normal operations.
   */
  public getPool(): mysql.Pool | null {
    return this.pool;
  }
}

export const databaseService = new DatabaseService();
export default databaseService;
