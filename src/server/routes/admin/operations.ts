import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import os from 'os';
import { authMiddleware } from '../../middleware/auth';
import { databaseService } from '../../database/connection';
import { metricsService } from '../../services/MetricsService';
import { redisService } from '../../services/RedisService';
import { config } from '../../config';
import { EmailService } from '../../services/EmailService';

function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  const user = request.user!;
  if (!user || user.role !== 'admin') {
    reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' });
    return false;
  }
  return true;
}

interface Warning {
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  advice: string;
}

function computeWarnings(data: {
  memoryPercent: number;
  poolActive: number;
  poolTotal: number;
  p99Ms: number;
  errorRate5xx: number;
  aiBudgetPercent: number;
  redisConnected: boolean;
  diskPercent: number | null;
  swapPercent: number | null;
}): Warning[] {
  const warnings: Warning[] = [];

  // Memory
  if (data.memoryPercent > 90) {
    warnings.push({ severity: 'critical', title: 'High Memory Usage', message: `Memory at ${data.memoryPercent.toFixed(0)}%`, advice: 'Restart service or increase VM memory' });
  } else if (data.memoryPercent > 80) {
    warnings.push({ severity: 'warning', title: 'Elevated Memory Usage', message: `Memory at ${data.memoryPercent.toFixed(0)}%`, advice: 'Monitor closely; consider restart if trending up' });
  }

  // DB Pool
  const poolPercent = data.poolTotal > 0 ? (data.poolActive / data.poolTotal) * 100 : 0;
  if (poolPercent > 90) {
    warnings.push({ severity: 'critical', title: 'DB Pool Exhaustion', message: `${data.poolActive}/${data.poolTotal} connections in use`, advice: 'Increase pool size or check connection leaks' });
  } else if (poolPercent > 70) {
    warnings.push({ severity: 'warning', title: 'DB Pool High', message: `${data.poolActive}/${data.poolTotal} connections in use`, advice: 'Monitor for connection leaks' });
  }

  // API latency
  if (data.p99Ms > 5000) {
    warnings.push({ severity: 'critical', title: 'Very High Latency', message: `API p99 at ${data.p99Ms}ms`, advice: 'Review slow queries and heavy endpoints' });
  } else if (data.p99Ms > 2000) {
    warnings.push({ severity: 'warning', title: 'High Latency', message: `API p99 at ${data.p99Ms}ms`, advice: 'Check for slow queries or upstream timeouts' });
  }

  // 5xx error rate
  if (data.errorRate5xx > 10) {
    warnings.push({ severity: 'critical', title: 'High Error Rate', message: `5xx rate at ${data.errorRate5xx.toFixed(1)}%`, advice: 'Check logs for recurring errors' });
  } else if (data.errorRate5xx > 5) {
    warnings.push({ severity: 'warning', title: 'Elevated Error Rate', message: `5xx rate at ${data.errorRate5xx.toFixed(1)}%`, advice: 'Investigate recent 5xx errors in logs' });
  }

  // AI budget
  if (data.aiBudgetPercent > 95) {
    warnings.push({ severity: 'critical', title: 'AI Budget Near Limit', message: `${data.aiBudgetPercent.toFixed(0)}% of monthly budget used`, advice: 'Reduce AI features or increase budget' });
  } else if (data.aiBudgetPercent > 80) {
    warnings.push({ severity: 'warning', title: 'AI Budget Warning', message: `${data.aiBudgetPercent.toFixed(0)}% of monthly budget used`, advice: 'Monitor AI usage; consider throttling non-critical calls' });
  }

  // Redis
  if (!data.redisConnected) {
    warnings.push({ severity: 'warning', title: 'Redis Disconnected', message: 'Redis is not connected', advice: 'Restart Redis or check connectivity' });
  }

  // Disk
  if (data.diskPercent !== null) {
    if (data.diskPercent > 90) {
      warnings.push({ severity: 'critical', title: 'Disk Nearly Full', message: `Disk at ${data.diskPercent.toFixed(0)}%`, advice: 'Clean logs/temp files or expand storage' });
    } else if (data.diskPercent > 80) {
      warnings.push({ severity: 'warning', title: 'Disk Usage High', message: `Disk at ${data.diskPercent.toFixed(0)}%`, advice: 'Plan disk cleanup soon' });
    }
  }

  // Swap
  if (data.swapPercent !== null) {
    if (data.swapPercent > 80) {
      warnings.push({ severity: 'critical', title: 'Swap Usage Critical', message: `Swap at ${data.swapPercent.toFixed(0)}%`, advice: 'Server is under heavy memory pressure — consider adding RAM or reducing load' });
    } else if (data.swapPercent > 50) {
      warnings.push({ severity: 'warning', title: 'Swap Usage Elevated', message: `Swap at ${data.swapPercent.toFixed(0)}%`, advice: 'Monitor memory usage; performance may degrade' });
    }
  }

  return warnings;
}

function getDiskUsage(): { usedGB: number; totalGB: number; percentUsed: number } | null {
  try {
    const stats = fs.statfsSync('/');
    const totalBytes = stats.bsize * stats.blocks;
    const freeBytes = stats.bsize * stats.bavail;
    const usedBytes = totalBytes - freeBytes;
    if (totalBytes === 0) return null;
    return {
      usedGB: Math.round((usedBytes / (1024 ** 3)) * 100) / 100,
      totalGB: Math.round((totalBytes / (1024 ** 3)) * 100) / 100,
      percentUsed: Math.round((usedBytes / totalBytes) * 100 * 10) / 10,
    };
  } catch {
    return null;
  }
}

function getSwapUsage(): { usedMB: number; totalMB: number; percentUsed: number } | null {
  try {
    // Read /proc/meminfo directly instead of shell commands
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const swapTotal = meminfo.match(/SwapTotal:\s+(\d+)\s+kB/);
    const swapFree = meminfo.match(/SwapFree:\s+(\d+)\s+kB/);
    if (!swapTotal || !swapFree) return null;
    const totalKB = parseInt(swapTotal[1], 10);
    const freeKB = parseInt(swapFree[1], 10);
    if (isNaN(totalKB) || isNaN(freeKB) || totalKB === 0) return null;
    const usedKB = totalKB - freeKB;
    return {
      usedMB: Math.round(usedKB / 1024),
      totalMB: Math.round(totalKB / 1024),
      percentUsed: Math.round((usedKB / totalKB) * 100 * 10) / 10,
    };
  } catch {
    return null;
  }
}

async function getRedisMemory(): Promise<number | null> {
  const client = redisService.getClient();
  if (!client) return null;
  try {
    const info = await client.info('memory');
    const match = info.match(/used_memory:(\d+)/);
    if (match) return Math.round(parseInt(match[1], 10) / 1048576 * 100) / 100;
    return null;
  } catch {
    return null;
  }
}

async function getAiBudgetInfo(): Promise<{ totalRequests: number; inputTokens: number; outputTokens: number; costThisMonth: number; monthlyBudget: number; budgetUsedPercent: number }> {
  const pricingInput = config.AI_PRICING_INPUT;
  const pricingOutput = config.AI_PRICING_OUTPUT;
  // Budget in dollars: derive from token budget and pricing (tokens / 1M * price per M)
  const monthlyBudget = (config.AI_MONTHLY_TOKEN_BUDGET / 1_000_000) * ((pricingInput + pricingOutput) / 2);

  try {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const rows = await databaseService.queryControlPlane<{ total_requests: number; total_input: number; total_output: number }>(
      `SELECT COUNT(*) as total_requests, COALESCE(SUM(input_tokens), 0) as total_input, COALESCE(SUM(output_tokens), 0) as total_output FROM ai_usage_log WHERE created_at >= ?`,
      [monthStart]
    );
    const row = rows[0] || { total_requests: 0, total_input: 0, total_output: 0 };
    const cost = (Number(row.total_input) / 1_000_000) * pricingInput + (Number(row.total_output) / 1_000_000) * pricingOutput;
    return {
      totalRequests: Number(row.total_requests),
      inputTokens: Number(row.total_input),
      outputTokens: Number(row.total_output),
      costThisMonth: Math.round(cost * 10000) / 10000,
      monthlyBudget,
      budgetUsedPercent: monthlyBudget > 0 ? Math.round((cost / monthlyBudget) * 100 * 10) / 10 : 0,
    };
  } catch {
    return { totalRequests: 0, inputTokens: 0, outputTokens: 0, costThisMonth: 0, monthlyBudget, budgetUsedPercent: 0 };
  }
}

async function getTenantStats(): Promise<any[]> {
  // Check Redis cache first
  if (redisService.isConnected()) {
    const cached = await redisService.get('ops:tenant_stats');
    if (cached) {
      try { return JSON.parse(cached); } catch { /* fall through */ }
    }
  }

  const tenants: any[] = [];

  if (config.MULTI_TENANT_ENABLED) {
    try {
      const orgs = await databaseService.queryControlPlane<{ id: string; name: string; slug: string }>(
        `SELECT id, name, slug FROM organizations WHERE is_active = 1`
      );
      for (const org of orgs) {
        const userRows = await databaseService.queryControlPlane<{ total: number; active: number }>(
          `SELECT COUNT(*) as total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active FROM users WHERE organization_id = ?`,
          [org.id]
        );
        tenants.push({
          id: org.id,
          name: org.name,
          slug: org.slug,
          totalUsers: Number(userRows[0]?.total || 0),
          activeUsers: Number(userRows[0]?.active || 0),
          apiRequestsToday: 0,
          apiRequestsWeek: 0,
          aiTokensThisMonth: 0,
          aiCostThisMonth: 0,
          projectCount: 0,
          taskCount: 0,
          storageRows: 0,
          lastActive: null,
        });
      }
    } catch { /* multi-tenant queries may fail if not set up */ }
  } else {
    // Single-tenant mode — return one row for the default instance
    try {
      const userRows = await databaseService.queryControlPlane<{ total: number; active: number }>(
        `SELECT COUNT(*) as total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active FROM users`
      );
      const projRows = await databaseService.queryControlPlane<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM projects`
      );
      const taskRows = await databaseService.queryControlPlane<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM tasks`
      );
      const ai = await getAiBudgetInfo();
      tenants.push({
        id: 'default',
        name: 'Default Instance',
        slug: 'default',
        totalUsers: Number(userRows[0]?.total || 0),
        activeUsers: Number(userRows[0]?.active || 0),
        apiRequestsToday: 0,
        apiRequestsWeek: 0,
        aiTokensThisMonth: ai.inputTokens + ai.outputTokens,
        aiCostThisMonth: ai.costThisMonth,
        projectCount: Number(projRows[0]?.cnt || 0),
        taskCount: Number(taskRows[0]?.cnt || 0),
        storageRows: 0,
        lastActive: null,
      });
    } catch { /* ignore */ }
  }

  // Cache for 30s
  if (redisService.isConnected()) {
    redisService.set('ops:tenant_stats', JSON.stringify(tenants), 30).catch(() => {});
  }

  return tenants;
}

// ── Security & Auth ──
async function getSecurityStats(): Promise<{
  deactivatedAccounts: number; activeApiKeys: number; totalApiKeys: number;
  recentLogins24h: number; usersNeverLoggedIn: number;
}> {
  try {
    const [deactivated, apiKeys, recentLogins, neverLogged] = await Promise.all([
      databaseService.queryControlPlane<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM users WHERE is_active = 0`),
      databaseService.queryControlPlane<{ total: number; active: number }>(
        `SELECT COUNT(*) as total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active FROM api_keys`
      ),
      databaseService.queryControlPlane<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM users WHERE last_login_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`
      ),
      databaseService.queryControlPlane<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM users WHERE last_login_at IS NULL AND is_active = 1`
      ),
    ]);
    return {
      deactivatedAccounts: Number(deactivated[0]?.cnt || 0),
      activeApiKeys: Number(apiKeys[0]?.active || 0),
      totalApiKeys: Number(apiKeys[0]?.total || 0),
      recentLogins24h: Number(recentLogins[0]?.cnt || 0),
      usersNeverLoggedIn: Number(neverLogged[0]?.cnt || 0),
    };
  } catch {
    return { deactivatedAccounts: 0, activeApiKeys: 0, totalApiKeys: 0, recentLogins24h: 0, usersNeverLoggedIn: 0 };
  }
}

// ── Cron Jobs ──
const CRON_JOBS = ['agent-scan', 'overdue-scan', 'recurrence', 'digest', 'reports', 'health-snapshot', 'trial-reminder', 'alert-check', 'data-retention'];

async function getCronStats(): Promise<{ name: string; status: string; durationMs: number | null; finishedAt: string | null }[]> {
  if (!redisService.isConnected()) {
    return CRON_JOBS.map(name => ({ name, status: 'unknown', durationMs: null, finishedAt: null }));
  }
  const results = await Promise.all(
    CRON_JOBS.map(async (name) => {
      const raw = await redisService.get(`cron:last:${name}`);
      if (!raw) return { name, status: 'never_run', durationMs: null, finishedAt: null };
      try {
        const info = JSON.parse(raw);
        return { name, status: info.status || 'unknown', durationMs: info.durationMs ?? null, finishedAt: info.finishedAt ?? null };
      } catch {
        return { name, status: 'unknown', durationMs: null, finishedAt: null };
      }
    })
  );
  return results;
}

// ── Database Growth ──
async function getDbGrowth(): Promise<{ tableName: string; rows: number; sizeMB: number }[]> {
  try {
    const dbName = config.MULTI_TENANT_ENABLED ? 'pmassist' : config.DB_NAME || 'pmassist';
    const rows = await databaseService.queryControlPlane<{ TABLE_NAME: string; TABLE_ROWS: number; data_size: number; index_size: number }>(
      `SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH as data_size, INDEX_LENGTH as index_size
       FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC LIMIT 20`,
      [dbName]
    );
    return rows.map(r => ({
      tableName: r.TABLE_NAME,
      rows: Number(r.TABLE_ROWS || 0),
      sizeMB: Math.round((Number(r.data_size || 0) + Number(r.index_size || 0)) / 1048576 * 100) / 100,
    }));
  } catch {
    return [];
  }
}

// ── Email Delivery ──
async function getEmailStats(): Promise<{ sentThisMonth: number; failedThisMonth: number }> {
  const stats = await EmailService.getMonthlyStats();
  return { sentThisMonth: stats.sent, failedThisMonth: stats.failed };
}

// ── User Activity ──
async function getUserActivity(): Promise<{ dau: number; wau: number; mau: number; lastSeenUsers: { username: string; fullName: string; lastLogin: string }[] }> {
  try {
    const [dauRows, wauRows, mauRows, recentRows] = await Promise.all([
      databaseService.queryControlPlane<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM users WHERE last_login_at >= DATE_SUB(NOW(), INTERVAL 1 DAY) AND is_active = 1`
      ),
      databaseService.queryControlPlane<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM users WHERE last_login_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND is_active = 1`
      ),
      databaseService.queryControlPlane<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM users WHERE last_login_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND is_active = 1`
      ),
      databaseService.queryControlPlane<{ username: string; full_name: string; last_login_at: string }>(
        `SELECT username, full_name, last_login_at FROM users WHERE last_login_at IS NOT NULL AND is_active = 1 ORDER BY last_login_at DESC LIMIT 10`
      ),
    ]);
    return {
      dau: Number(dauRows[0]?.cnt || 0),
      wau: Number(wauRows[0]?.cnt || 0),
      mau: Number(mauRows[0]?.cnt || 0),
      lastSeenUsers: recentRows.map(r => ({ username: r.username, fullName: r.full_name, lastLogin: r.last_login_at })),
    };
  } catch {
    return { dau: 0, wau: 0, mau: 0, lastSeenUsers: [] };
  }
}

// ── Agent Performance ──
async function getAgentStats(): Promise<{ agentId: string; totalRuns: number; lastRun: string | null }[]> {
  try {
    const rows = await databaseService.queryControlPlane<{ agent_id: string; total_runs: number; last_run: string }>(
      `SELECT agent_id, COUNT(*) as total_runs, MAX(created_at) as last_run
       FROM agent_memory WHERE memory_type = 'reflection'
       GROUP BY agent_id ORDER BY total_runs DESC`
    );
    return rows.map(r => ({ agentId: r.agent_id, totalRuns: Number(r.total_runs), lastRun: r.last_run }));
  } catch {
    return [];
  }
}

// ── Webhook / Dead Letter ──
async function getWebhookStats(): Promise<{
  totalDeliveries: number; successDeliveries: number; failedDeliveries: number;
  dlqPending: number; dlqFailed: number; dlqResolved: number;
}> {
  try {
    const [deliveries, dlq] = await Promise.all([
      databaseService.queryControlPlane<{ total: number; success: number; failed: number }>(
        `SELECT COUNT(*) as total,
                SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) as success,
                SUM(CASE WHEN status_code IS NULL OR status_code >= 400 THEN 1 ELSE 0 END) as failed
         FROM webhook_deliveries WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
      ),
      databaseService.queryControlPlane<{ status: string; cnt: number }>(
        `SELECT status, COUNT(*) as cnt FROM dead_letter_queue GROUP BY status`
      ),
    ]);
    const dlqMap: Record<string, number> = {};
    dlq.forEach(r => { dlqMap[r.status] = Number(r.cnt); });
    return {
      totalDeliveries: Number(deliveries[0]?.total || 0),
      successDeliveries: Number(deliveries[0]?.success || 0),
      failedDeliveries: Number(deliveries[0]?.failed || 0),
      dlqPending: dlqMap['pending'] || 0,
      dlqFailed: dlqMap['failed'] || 0,
      dlqResolved: dlqMap['resolved'] || 0,
    };
  } catch {
    return { totalDeliveries: 0, successDeliveries: 0, failedDeliveries: 0, dlqPending: 0, dlqFailed: 0, dlqResolved: 0 };
  }
}

export async function operationsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(request, reply)) return;

    try {
      // System metrics (sync)
      const mem = process.memoryUsage();
      const heapUsedMB = Math.round(mem.heapUsed / 1048576 * 100) / 100;
      const heapTotalMB = Math.round(mem.heapTotal / 1048576 * 100) / 100;
      const rssMB = Math.round(mem.rss / 1048576 * 100) / 100;
      const memoryPercent = heapTotalMB > 0 ? Math.round((heapUsedMB / heapTotalMB) * 100 * 10) / 10 : 0;

      // OS-level memory
      const osTotalMB = Math.round(os.totalmem() / 1048576);
      const osFreeMB = Math.round(os.freemem() / 1048576);
      const osUsedMB = osTotalMB - osFreeMB;
      const osMemoryPercent = Math.round((osUsedMB / osTotalMB) * 100 * 10) / 10;

      // Swap
      const swap = getSwapUsage();

      const cpuUsage = process.cpuUsage();
      const uptimeMs = process.uptime() * 1000000; // microseconds
      const userPercent = uptimeMs > 0 ? Math.round((cpuUsage.user / uptimeMs) * 100 * 10) / 10 : 0;
      const systemPercent = uptimeMs > 0 ? Math.round((cpuUsage.system / uptimeMs) * 100 * 10) / 10 : 0;

      // DB pool info
      const pool = databaseService.getPool();
      let poolActive = 0, poolIdle = 0, poolTotal = config.DB_CONNECTION_LIMIT, poolWaiting = 0;
      if (pool) {
        const p = pool.pool;
        // mysql2 pool internals — no public API for these stats
        const internals = p as unknown as Record<string, { length?: number } | undefined>;
        poolActive = internals._allConnections?.length || 0;
        poolIdle = internals._freeConnections?.length || 0;
        poolWaiting = internals._connectionQueue?.length || 0;
      }

      // Metrics snapshot
      const metrics = metricsService.getSnapshot();
      const totalReqs = metrics.requests.total;
      const errorRate5xx = totalReqs > 0 ? (metrics.errors.total5xx / totalReqs) * 100 : 0;

      // Async data
      const [redisMemory, aiBudget, disk, tenants, security, cronJobs, dbGrowth, emailStats, userActivity, agentPerf, webhookStats] = await Promise.all([
        getRedisMemory(),
        getAiBudgetInfo(),
        Promise.resolve(getDiskUsage()),
        getTenantStats(),
        getSecurityStats(),
        getCronStats(),
        getDbGrowth(),
        getEmailStats(),
        getUserActivity(),
        getAgentStats(),
        getWebhookStats(),
      ]);

      // Compute warnings
      const warnings = computeWarnings({
        memoryPercent: osMemoryPercent,
        poolActive,
        poolTotal,
        p99Ms: metrics.latency.p99Ms,
        errorRate5xx,
        aiBudgetPercent: aiBudget.budgetUsedPercent,
        redisConnected: redisService.isConnected(),
        diskPercent: disk?.percentUsed ?? null,
        swapPercent: swap?.percentUsed ?? null,
      });

      // Summary aggregates — query directly, don't rely on tenants array
      let totalTenants = 0;
      let totalUsers = 0;
      let roleBreakdown: { role: string; count: number }[] = [];
      let aiDailyUsage: { date: string; requests: number; inputTokens: number; outputTokens: number; cost: number }[] = [];
      try {
        if (config.MULTI_TENANT_ENABLED) {
          const orgRows = await databaseService.queryControlPlane<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM organizations WHERE is_active = 1`);
          totalTenants = Number(orgRows[0]?.cnt || 0);
        } else {
          totalTenants = 1;
        }
        const userRows = await databaseService.queryControlPlane<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM users WHERE is_active = 1`);
        totalUsers = Number(userRows[0]?.cnt || 0);

        // Role breakdown
        const roleRows = await databaseService.queryControlPlane<{ role: string; cnt: number }>(
          `SELECT role, COUNT(*) as cnt FROM users WHERE is_active = 1 GROUP BY role ORDER BY cnt DESC`
        );
        roleBreakdown = roleRows.map(r => ({ role: r.role, count: Number(r.cnt) }));

        // AI daily usage for current month
        const now = new Date();
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const pricingInput = config.AI_PRICING_INPUT;
        const pricingOutput = config.AI_PRICING_OUTPUT;
        const dailyRows = await databaseService.queryControlPlane<{ day: string; reqs: number; inp: number; outp: number }>(
          `SELECT DATE(created_at) as day, COUNT(*) as reqs, COALESCE(SUM(input_tokens),0) as inp, COALESCE(SUM(output_tokens),0) as outp
           FROM ai_usage_log WHERE created_at >= ? GROUP BY DATE(created_at) ORDER BY day`,
          [monthStart]
        );
        aiDailyUsage = dailyRows.map(r => ({
          date: String(r.day),
          requests: Number(r.reqs),
          inputTokens: Number(r.inp),
          outputTokens: Number(r.outp),
          cost: Math.round(((Number(r.inp) / 1_000_000) * pricingInput + (Number(r.outp) / 1_000_000) * pricingOutput) * 10000) / 10000,
        }));
      } catch { /* fall back to tenant-derived counts */
        totalTenants = tenants.length || (config.MULTI_TENANT_ENABLED ? 0 : 1);
        totalUsers = tenants.reduce((sum, t) => sum + t.totalUsers, 0);
      }
      const availableRAM = osFreeMB;
      const estimatedHeadroom = Math.max(0, Math.floor(availableRAM / 15));

      return {
        system: {
          uptime: Math.floor(process.uptime()),
          memory: {
            heapUsedMB, heapTotalMB, rssMB, percentUsed: memoryPercent,
            osTotalMB, osUsedMB, osAvailableMB: osFreeMB, osPercent: osMemoryPercent,
          },
          swap,
          cpu: { userPercent, systemPercent },
          db: {
            poolActive,
            poolIdle,
            poolTotal,
            poolWaiting,
            latencyP50: metrics.latency.p50Ms,
            latencyP95: metrics.latency.p95Ms,
            latencyP99: metrics.latency.p99Ms,
            totalQueries: metrics.db.totalQueries,
          },
          redis: { connected: redisService.isConnected(), memoryUsedMB: redisMemory },
          api: {
            totalRequests: totalReqs,
            activeRequests: metrics.requests.activeRequests,
            p50Ms: metrics.latency.p50Ms,
            p95Ms: metrics.latency.p95Ms,
            p99Ms: metrics.latency.p99Ms,
            errorRate5xx: Math.round(errorRate5xx * 10) / 10,
          },
          ai: aiBudget,
          disk,
        },
        summary: { totalTenants, totalUsers, estimatedHeadroom },
        drilldown: {
          roleBreakdown,
          aiDailyUsage,
          headroom: {
            osTotalMB,
            osUsedMB,
            osAvailableMB: osFreeMB,
            heapUsedMB,
            rssMB,
            perUserEstimateMB: 15,
            estimatedHeadroom,
          },
        },
        warnings,
        tenants,
        security,
        cronJobs,
        dbGrowth,
        emailStats,
        userActivity,
        agentPerf,
        webhookStats,
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
