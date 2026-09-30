import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { projectService } from '../../services/ProjectService';
import { scheduleService } from '../../services/ScheduleService';
import { resourceService } from '../../services/ResourceService';
import { evmForecastService } from '../../services/EVMForecastService';
import { burndownService } from '../../services/BurndownService';
import { databaseService } from '../../database/connection';
import { redisService } from '../../services/RedisService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import logger from '../../utils/logger';

export async function portfolioRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  fastify.get('/', {
    preHandler: [requireScope('read')],
    schema: { description: 'Get portfolio overview with all projects and tasks', tags: ['portfolio'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const userId = user.userId;
      const projects = await projectService.findByUserId(userId);

      // Batch: 3 queries total instead of 1 + N + N×M
      const projectIds = projects.map(p => p.id);
      const allSchedules = await scheduleService.findByProjectIds(projectIds);
      const scheduleIds = allSchedules.map(s => s.id);
      const allTasks = await scheduleService.findTasksByScheduleIds(scheduleIds);

      // Group schedules by projectId, tasks by scheduleId
      const schedulesByProject = new Map<string, string[]>();
      for (const s of allSchedules) {
        let ids = schedulesByProject.get(s.projectId);
        if (!ids) { ids = []; schedulesByProject.set(s.projectId, ids); }
        ids.push(s.id);
      }

      const tasksBySchedule = new Map<string, typeof allTasks>();
      for (const t of allTasks) {
        let arr = tasksBySchedule.get(t.scheduleId);
        if (!arr) { arr = []; tasksBySchedule.set(t.scheduleId, arr); }
        arr.push(t);
      }

      const portfolioItems = projects.map(project => {
        const projScheduleIds = schedulesByProject.get(project.id) ?? [];
        const projectTasks = projScheduleIds.flatMap(sid => tasksBySchedule.get(sid) ?? []);

        const totalTasks = projectTasks.length;
        const completedTasks = projectTasks.filter(t => t.status === 'completed').length;
        const avgProgress = totalTasks > 0 ? Math.round(projectTasks.reduce((s, t) => s + (t.progressPercentage || 0), 0) / totalTasks) : 0;

        return {
          projectId: project.id,
          projectName: project.name,
          status: project.status,
          priority: project.priority,
          startDate: project.startDate,
          endDate: project.endDate,
          budgetAllocated: project.budgetAllocated || 0,
          budgetSpent: project.budgetSpent || 0,
          progressPercentage: avgProgress,
          totalTasks,
          completedTasks,
          tasks: projectTasks.map(t => ({
            id: t.id,
            name: t.name,
            status: t.status,
            priority: t.priority,
            startDate: t.startDate,
            endDate: t.endDate,
            progressPercentage: t.progressPercentage,
            parentTaskId: t.parentTaskId,
            assignedTo: t.assignedTo,
            dependency: t.dependency,
            dependencyType: t.dependencyType,
            dependencies: t.dependencies.map(d => ({ id: d.dependencyId, type: d.dependencyType, lag: d.lagDays })),
          })),
        };
      });

      return { portfolioItems };
    } catch (error) {
      logger.error('Get portfolio error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to fetch portfolio' });
    }
  });

  // GET /portfolio/resources — cross-project resource view
  fastify.get('/resources', {
    preHandler: [requireScope('read')],
    schema: { description: 'Get portfolio-level resource utilization across all projects', tags: ['portfolio'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const projects = await projectService.findByUserId(user.userId);
      const activeProjects = projects.filter(p => p.status === 'active' || p.status === 'planning');

      // Fetch workload for each active project in parallel
      const workloadResults = await Promise.all(
        activeProjects.map(async (p) => ({
          projectId: p.id,
          projectName: p.name,
          workload: await resourceService.computeWorkload(p.id),
        }))
      );

      // Pre-fetch all resources to avoid N+1 lookups
      const allResources = await resourceService.findAllResources();
      const resourceLookup = new Map(allResources.map(r => [r.id, r]));

      // Aggregate per resource across projects
      interface AggResource {
        resourceId: string;
        resourceName: string;
        role: string;
        costRateHourly: number | null;
        projects: { projectId: string; projectName: string; averageUtilization: number }[];
        combinedUtilization: number;
        isOverAllocated: boolean;
      }

      const resourceMap = new Map<string, AggResource>();

      for (const { projectId, projectName, workload } of workloadResults) {
        for (const w of workload) {
          let agg = resourceMap.get(w.resourceId);
          if (!agg) {
            const resource = resourceLookup.get(w.resourceId);
            agg = {
              resourceId: w.resourceId,
              resourceName: w.resourceName,
              role: w.role,
              costRateHourly: w.costRateHourly ?? resource?.costRateHourly ?? null, // today's rate, rate card included
              projects: [],
              combinedUtilization: 0,
              isOverAllocated: false,
            };
            resourceMap.set(w.resourceId, agg);
          }
          agg.projects.push({ projectId, projectName, averageUtilization: w.averageUtilization });
        }
      }

      // Calculate combined utilization and detect contention
      const resources: AggResource[] = [];
      const contentions: { resourceId: string; resourceName: string; role: string; projects: { projectId: string; projectName: string; averageUtilization: number }[]; combinedUtilization: number }[] = [];

      for (const agg of resourceMap.values()) {
        agg.combinedUtilization = agg.projects.reduce((s, p) => s + p.averageUtilization, 0);
        agg.isOverAllocated = agg.combinedUtilization > 100;
        resources.push(agg);

        if (agg.projects.length >= 2 && agg.combinedUtilization > 100) {
          contentions.push({
            resourceId: agg.resourceId,
            resourceName: agg.resourceName,
            role: agg.role,
            projects: agg.projects,
            combinedUtilization: agg.combinedUtilization,
          });
        }
      }

      // Sort by utilization desc
      resources.sort((a, b) => b.combinedUtilization - a.combinedUtilization);
      contentions.sort((a, b) => b.combinedUtilization - a.combinedUtilization);

      // Summary stats
      const totalResources = resources.length;
      const overAllocatedCount = resources.filter(r => r.isOverAllocated).length;
      const avgUtilization = totalResources > 0
        ? Math.round(resources.reduce((s, r) => s + r.combinedUtilization, 0) / totalResources)
        : 0;
      const totalWeeklyCost = resources.reduce((s, r) => {
        if (r.costRateHourly == null) return s;
        return s + r.costRateHourly * 40; // assume 40h/week for cost estimate
      }, 0);

      return {
        resources,
        contentions,
        summary: { totalResources, overAllocatedCount, avgUtilization, totalWeeklyCost: Math.round(totalWeeklyCost * 100) / 100 },
      };
    } catch (error) {
      logger.error('Get portfolio resources error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to fetch portfolio resources' });
    }
  });

  // GET /portfolio/analytics — cross-project CPI/SPI, burndown, health analytics
  fastify.get('/analytics', {
    preHandler: [requireScope('read')],
    schema: { description: 'Get portfolio-level analytics with EVM metrics and burndown data', tags: ['portfolio'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const userId = user.userId;

      // Check Redis cache
      const cacheKey = `portfolio:analytics:${userId}`;
      const cached = await redisService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const projects = await projectService.findByUserId(userId);
      const activeProjects = projects.filter(p => p.status === 'active' || p.status === 'planning');

      if (activeProjects.length === 0) {
        return { projects: [] };
      }

      // Get all schedules in batch
      const projectIds = activeProjects.map(p => p.id);
      const allSchedules = await scheduleService.findByProjectIds(projectIds);
      const schedulesByProject = new Map<string, typeof allSchedules>();
      for (const s of allSchedules) {
        let arr = schedulesByProject.get(s.projectId);
        if (!arr) { arr = []; schedulesByProject.set(s.projectId, arr); }
        arr.push(s);
      }

      // Fetch health history for all projects in one query
      const healthRows = await databaseService.query<{
        project_id: string; overall_health: number; recorded_at: string;
      }>(
        `SELECT project_id, health_score AS overall_health, recorded_at
         FROM project_health_history
         WHERE project_id IN (${projectIds.map(() => '?').join(',')})
           AND recorded_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         ORDER BY recorded_at DESC`,
        projectIds
      );
      const healthByProject = new Map<string, Array<{ score: number; date: string }>>();
      for (const row of healthRows) {
        let arr = healthByProject.get(row.project_id);
        if (!arr) { arr = []; healthByProject.set(row.project_id, arr); }
        arr.push({ score: row.overall_health, date: row.recorded_at });
      }

      // Process each project with bounded concurrency
      const CONCURRENCY = 5;
      const results: Array<{
        projectId: string;
        projectName: string;
        status: string;
        cpi: number | null;
        spi: number | null;
        cpiTrend: Array<{ date: string; value: number }>;
        spiTrend: Array<{ date: string; value: number }>;
        burndown: Array<{ date: string; ideal: number; actual: number }>;
        percentComplete: number;
        healthScore: number | null;
        healthTrend: 'improving' | 'declining' | 'stable';
        budgetUtilization: number;
        budgetAllocated: number;
        budgetSpent: number;
        totalTasks: number;
        completedTasks: number;
        scheduleVariance: number;
      }> = [];

      for (let i = 0; i < activeProjects.length; i += CONCURRENCY) {
        const batch = activeProjects.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.allSettled(
          batch.map(async (project) => {
            const projSchedules = schedulesByProject.get(project.id) ?? [];
            const firstSchedule = projSchedules[0];

            // EVM metrics (no AI call)
            let cpi: number | null = null;
            let spi: number | null = null;
            let cpiTrend: Array<{ date: string; value: number }> = [];
            let spiTrend: Array<{ date: string; value: number }> = [];
            let scheduleVariance = 0;

            try {
              const evm = await evmForecastService.generateMetricsOnly(project.id);
              cpi = evm.currentMetrics.CPI;
              spi = evm.currentMetrics.SPI;
              scheduleVariance = parseFloat(((spi - 1) * 100).toFixed(1));

              // Last 8 weeks of CPI/SPI trends
              const weekly = evm.historicalTrends.weeklyData.slice(-8);
              cpiTrend = weekly.map(w => ({ date: w.date, value: w.cpi }));
              spiTrend = weekly.map(w => ({ date: w.date, value: w.spi }));
            } catch { /* no EVM data — leave nulls */ }

            // Burndown data
            let burndown: Array<{ date: string; ideal: number; actual: number }> = [];
            let percentComplete = 0;
            let totalTasks = 0;
            let completedTasks = 0;

            if (firstSchedule) {
              try {
                const bd = await burndownService.getBurndownData(firstSchedule.id);
                percentComplete = bd.percentComplete;
                totalTasks = bd.totalScope;
                completedTasks = bd.completedCount;
                // Sample to max ~12 points for sparkline
                const pts = bd.dataPoints.filter(d => d.actual >= 0);
                const step = Math.max(1, Math.floor(pts.length / 12));
                burndown = pts
                  .filter((_, idx) => idx % step === 0 || idx === pts.length - 1)
                  .map(d => ({ date: d.date, ideal: d.ideal, actual: d.actual }));
              } catch { /* no burndown data */ }
            }

            // Health from pre-fetched data
            const healthHistory = healthByProject.get(project.id) ?? [];
            const healthScore = healthHistory.length > 0 ? healthHistory[0].score : null;
            let healthTrend: 'improving' | 'declining' | 'stable' = 'stable';
            if (healthHistory.length >= 2) {
              const diff = healthHistory[0].score - healthHistory[1].score;
              if (diff > 2) healthTrend = 'improving';
              else if (diff < -2) healthTrend = 'declining';
            }

            const budgetAllocated = project.budgetAllocated || 0;
            const budgetSpent = project.budgetSpent || 0;
            const budgetUtilization = budgetAllocated > 0 ? parseFloat(((budgetSpent / budgetAllocated) * 100).toFixed(1)) : 0;

            return {
              projectId: project.id,
              projectName: project.name,
              status: project.status,
              cpi,
              spi,
              cpiTrend,
              spiTrend,
              burndown,
              percentComplete,
              healthScore,
              healthTrend,
              budgetUtilization,
              budgetAllocated,
              budgetSpent,
              totalTasks,
              completedTasks,
              scheduleVariance,
            };
          })
        );

        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          }
        }
      }

      const response = { projects: results };

      // Cache for 5 minutes
      await redisService.set(cacheKey, JSON.stringify(response), 300);

      return response;
    } catch (error) {
      logger.error('Get portfolio analytics error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Failed to fetch portfolio analytics' });
    }
  });
}
