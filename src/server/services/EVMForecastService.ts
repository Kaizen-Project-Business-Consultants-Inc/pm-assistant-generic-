import { claudeService, PromptTemplate } from './claudeService';
import { sCurveService, SCurveDataPoint } from './SCurveService';
import { projectService, Project } from './ProjectService';
import { redisService } from './RedisService';
import { config } from '../config';
import logger from '../utils/logger';
import {
  EVMForecastAIResponseSchema,
  type EVMForecastResult,
  type EVMCurrentMetrics,
  type EVMEarlyWarning,
  type EVMForecastComparison,
  type EVMForecastAIResponse,
} from '../schemas/evmForecastSchemas';

const AI_CACHE_TTL_SECONDS = 30 * 60; // 30 minutes

// ---------------------------------------------------------------------------
// Prompt Template
// ---------------------------------------------------------------------------

const evmForecastPrompt = new PromptTemplate(
  `You are an expert Earned Value Management (EVM) analyst and project cost engineer. Analyze the EVM data below and produce predictive forecasts.

Project context:
{{projectContext}}

Current EVM metrics:
{{evmMetrics}}

Historical weekly CPI/SPI trends:
{{historicalTrends}}

Early warnings detected:
{{earlyWarnings}}

Traditional forecast methods:
{{traditionalForecasts}}

Based on this data:
1. Predict CPI and SPI for the next 4 weeks (week 1 through week 4), considering the historical trend direction.
2. Provide an AI-adjusted EAC that accounts for trend momentum and project-specific risks.
3. Give a confidence range (low/high) for the EAC.
4. Assess the trend direction: improving, stable, or deteriorating.
5. Estimate the probability of a cost overrun (0-100%).
6. Recommend corrective actions with effort level, priority, and estimated impact.
7. Write a narrative summary explaining the forecast in plain language.

Return a JSON object matching the schema.`,
  '1.0.0',
);

// ---------------------------------------------------------------------------
// EVMForecastService
// ---------------------------------------------------------------------------

export class EVMForecastService {
  // -------------------------------------------------------------------------
  // Main entry point
  // -------------------------------------------------------------------------

  async generateForecast(projectId: string, userId?: string): Promise<EVMForecastResult> {
    // 1. Get project
    const project = await projectService.findById(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    // 2. Compute S-curve data
    const sCurveData = await sCurveService.computeSCurveData(projectId);

    // 3. Compute current EVM metrics
    const BAC = project.budgetAllocated || 0;
    const currentMetrics = this.computeCurrentMetrics(BAC, sCurveData);

    // 4. Compute historical weekly CPI/SPI trends
    const weeklyData = this.computeHistoricalTrends(BAC, sCurveData);

    // 5. Generate early warnings
    const earlyWarnings = this.generateEarlyWarnings(currentMetrics);

    // 6. Compute traditional forecasts (3 methods)
    const traditionalForecasts = this.computeTraditionalForecasts(currentMetrics);

    // 7. Build forecast comparison table (start with traditional methods)
    const forecastComparison: EVMForecastComparison[] = [
      {
        method: 'EAC (Cumulative CPI)',
        eacValue: traditionalForecasts.eacCumulative,
        varianceFromBAC: parseFloat((traditionalForecasts.eacCumulative - BAC).toFixed(2)),
      },
      {
        method: 'EAC (Composite CPI*SPI)',
        eacValue: traditionalForecasts.eacComposite,
        varianceFromBAC: parseFloat((traditionalForecasts.eacComposite - BAC).toFixed(2)),
      },
      {
        method: 'EAC (Management Estimate)',
        eacValue: traditionalForecasts.eacManagement,
        varianceFromBAC: parseFloat((traditionalForecasts.eacManagement - BAC).toFixed(2)),
      },
    ];

    // 8. Check Redis cache for AI predictions
    let aiPredictions: EVMForecastAIResponse | undefined;
    const cacheKey = `evm:ai:${projectId}`;

    if (config.AI_ENABLED && claudeService.isAvailable()) {
      try {
        const cached = await redisService.get(cacheKey);
        if (cached) {
          aiPredictions = JSON.parse(cached);
          logger.debug('[EVMForecastService] AI predictions loaded from cache', { projectId });
        } else {
          aiPredictions = await this.getAIPredictions(
            project,
            currentMetrics,
            weeklyData,
            earlyWarnings,
            traditionalForecasts,
          );

          // Cache the result
          if (aiPredictions) {
            await redisService.set(cacheKey, JSON.stringify(aiPredictions), AI_CACHE_TTL_SECONDS);
          }
        }

        // Add AI prediction to comparison table
        if (aiPredictions) {
          forecastComparison.push({
            method: 'AI-Adjusted EAC',
            eacValue: aiPredictions.aiAdjustedEAC,
            varianceFromBAC: parseFloat((aiPredictions.aiAdjustedEAC - BAC).toFixed(2)),
          });
        }
      } catch (err) {
        // AI failure is non-critical — continue with traditional forecasts
        logger.warn('[EVMForecastService] AI prediction failed, using traditional only:', err);
      }
    }

    return {
      currentMetrics,
      historicalTrends: { weeklyData },
      earlyWarnings,
      traditionalForecasts,
      aiPredictions,
      forecastComparison,
      sCurveData,
    };
  }

  // -------------------------------------------------------------------------
  // Generate metrics only (no AI) — used for fast initial load
  // -------------------------------------------------------------------------

  async generateMetricsOnly(projectId: string): Promise<Omit<EVMForecastResult, 'aiPredictions'> & { aiPredictions?: EVMForecastAIResponse }> {
    const project = await projectService.findById(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const sCurveData = await sCurveService.computeSCurveData(projectId);
    const BAC = project.budgetAllocated || 0;
    const currentMetrics = this.computeCurrentMetrics(BAC, sCurveData);
    const weeklyData = this.computeHistoricalTrends(BAC, sCurveData);
    const earlyWarnings = this.generateEarlyWarnings(currentMetrics);
    const traditionalForecasts = this.computeTraditionalForecasts(currentMetrics);

    const forecastComparison: EVMForecastComparison[] = [
      { method: 'EAC (Cumulative CPI)', eacValue: traditionalForecasts.eacCumulative, varianceFromBAC: parseFloat((traditionalForecasts.eacCumulative - BAC).toFixed(2)) },
      { method: 'EAC (Composite CPI*SPI)', eacValue: traditionalForecasts.eacComposite, varianceFromBAC: parseFloat((traditionalForecasts.eacComposite - BAC).toFixed(2)) },
      { method: 'EAC (Management Estimate)', eacValue: traditionalForecasts.eacManagement, varianceFromBAC: parseFloat((traditionalForecasts.eacManagement - BAC).toFixed(2)) },
    ];

    // Check Redis cache — if AI is cached, include it for free
    let aiPredictions: EVMForecastAIResponse | undefined;
    const cacheKey = `evm:ai:${projectId}`;
    try {
      const cached = await redisService.get(cacheKey);
      if (cached) {
        aiPredictions = JSON.parse(cached);
        forecastComparison.push({
          method: 'AI-Adjusted EAC',
          eacValue: aiPredictions!.aiAdjustedEAC,
          varianceFromBAC: parseFloat((aiPredictions!.aiAdjustedEAC - BAC).toFixed(2)),
        });
      }
    } catch { /* ignore cache errors */ }

    return {
      currentMetrics,
      historicalTrends: { weeklyData },
      earlyWarnings,
      traditionalForecasts,
      aiPredictions,
      forecastComparison,
      sCurveData,
    };
  }

  // -------------------------------------------------------------------------
  // AI predictions only — used for deferred loading
  // -------------------------------------------------------------------------

  async generateAIPredictions(projectId: string, userId?: string): Promise<EVMForecastAIResponse | null> {
    if (!config.AI_ENABLED || !claudeService.isAvailable()) return null;

    const cacheKey = `evm:ai:${projectId}`;

    // Check cache first
    try {
      const cached = await redisService.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch { /* ignore */ }

    // Generate fresh
    const project = await projectService.findById(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    const sCurveData = await sCurveService.computeSCurveData(projectId);
    const BAC = project.budgetAllocated || 0;
    const currentMetrics = this.computeCurrentMetrics(BAC, sCurveData);
    const weeklyData = this.computeHistoricalTrends(BAC, sCurveData);
    const earlyWarnings = this.generateEarlyWarnings(currentMetrics);
    const traditionalForecasts = this.computeTraditionalForecasts(currentMetrics);

    const aiPredictions = await this.getAIPredictions(project, currentMetrics, weeklyData, earlyWarnings, traditionalForecasts);

    // Cache
    if (aiPredictions) {
      await redisService.set(cacheKey, JSON.stringify(aiPredictions), AI_CACHE_TTL_SECONDS);
    }

    return aiPredictions;
  }

  // -------------------------------------------------------------------------
  // Sample data for trial users (no DB or AI calls)
  // -------------------------------------------------------------------------

  generateSampleMetrics(): EVMForecastResult {
    const BAC = 500000;
    const currentMetrics: EVMCurrentMetrics = {
      BAC, EV: 320000, AC: 345000, PV: 300000,
      CPI: 0.93, SPI: 1.07, EAC: 537634, ETC: 192634, VAC: -37634, TCPI: 1.16,
    };

    const weeklyData = [
      { date: '2026-06-01', cpi: 1.02, spi: 0.95 },
      { date: '2026-06-08', cpi: 0.99, spi: 0.97 },
      { date: '2026-06-15', cpi: 0.97, spi: 1.00 },
      { date: '2026-06-22', cpi: 0.95, spi: 1.02 },
      { date: '2026-06-29', cpi: 0.94, spi: 1.04 },
      { date: '2026-07-06', cpi: 0.93, spi: 1.05 },
      { date: '2026-07-13', cpi: 0.93, spi: 1.07 },
    ];

    const earlyWarnings: EVMEarlyWarning[] = [
      { type: 'cost', message: 'Cost performance slightly below target (CPI: 0.93). Monitor spending closely.', severity: 'info' },
      { type: 'completion', message: 'To-Complete Performance Index is slightly elevated (TCPI: 1.16). Efficiency improvements needed to meet budget targets.', severity: 'info' },
      { type: 'budget', message: 'Minor projected cost overrun of 7.5% (VAC: -$37,634).', severity: 'info' },
    ];

    const traditionalForecasts = {
      eacCumulative: 537634,
      eacComposite: 510204,
      eacManagement: 525000,
    };

    const forecastComparison: EVMForecastComparison[] = [
      { method: 'EAC (Cumulative CPI)', eacValue: 537634, varianceFromBAC: 37634 },
      { method: 'EAC (Composite CPI*SPI)', eacValue: 510204, varianceFromBAC: 10204 },
      { method: 'EAC (Management Estimate)', eacValue: 525000, varianceFromBAC: 25000 },
    ];

    const sCurveData = [
      { date: '2026-05-25', pv: 40000, ev: 38000, ac: 37000 },
      { date: '2026-06-01', pv: 85000, ev: 80000, ac: 78000 },
      { date: '2026-06-08', pv: 130000, ev: 122000, ac: 123000 },
      { date: '2026-06-15', pv: 175000, ev: 165000, ac: 170000 },
      { date: '2026-06-22', pv: 215000, ev: 210000, ac: 220000 },
      { date: '2026-06-29', pv: 250000, ev: 248000, ac: 263000 },
      { date: '2026-07-06', pv: 280000, ev: 290000, ac: 310000 },
      { date: '2026-07-13', pv: 300000, ev: 320000, ac: 345000 },
    ];

    return { currentMetrics, historicalTrends: { weeklyData }, earlyWarnings, traditionalForecasts, forecastComparison, sCurveData };
  }

  // -------------------------------------------------------------------------
  // Compute current EVM metrics from latest S-curve data point
  // -------------------------------------------------------------------------

  private computeCurrentMetrics(
    BAC: number,
    sCurveData: SCurveDataPoint[],
  ): EVMCurrentMetrics {
    // Use the latest data point that is on or before today
    const today = new Date().toISOString().slice(0, 10);
    const pastPoints = sCurveData.filter((d) => d.date <= today);
    const latest = pastPoints.length > 0
      ? pastPoints[pastPoints.length - 1]
      : sCurveData.length > 0
        ? sCurveData[0]
        : { pv: 0, ev: 0, ac: 0 };

    const EV = latest.ev;
    const AC = latest.ac;
    const PV = latest.pv;

    const CPI = AC > 0 ? parseFloat((EV / AC).toFixed(4)) : 1;
    const SPI = PV > 0 ? parseFloat((EV / PV).toFixed(4)) : 1;

    const EAC = CPI > 0
      ? parseFloat((BAC / CPI).toFixed(2))
      : BAC;
    const ETC = Math.max(0, parseFloat((EAC - AC).toFixed(2)));
    const VAC = parseFloat((BAC - EAC).toFixed(2));

    const TCPI = (BAC - AC) > 0
      ? parseFloat(((BAC - EV) / (BAC - AC)).toFixed(4))
      : 1;

    return { BAC, EV, AC, PV, CPI, SPI, EAC, ETC, VAC, TCPI };
  }

  // -------------------------------------------------------------------------
  // Compute historical weekly CPI/SPI from S-curve data
  // -------------------------------------------------------------------------

  private computeHistoricalTrends(
    BAC: number,
    sCurveData: SCurveDataPoint[],
  ): { date: string; cpi: number; spi: number }[] {
    if (BAC <= 0) return [];

    const today = new Date().toISOString().slice(0, 10);

    return sCurveData
      .filter((d) => d.date <= today)
      .map((d) => {
        const cpi = d.ac > 0 ? parseFloat((d.ev / d.ac).toFixed(4)) : 1;
        const spi = d.pv > 0 ? parseFloat((d.ev / d.pv).toFixed(4)) : 1;
        return { date: d.date, cpi, spi };
      });
  }

  // -------------------------------------------------------------------------
  // Rule-based early warning engine
  // -------------------------------------------------------------------------

  private generateEarlyWarnings(metrics: EVMCurrentMetrics): EVMEarlyWarning[] {
    const warnings: EVMEarlyWarning[] = [];

    // CPI warnings
    if (metrics.CPI < 0.8) {
      warnings.push({
        type: 'cost',
        message: `Cost performance critically below target (CPI: ${metrics.CPI}). Project is spending significantly more than planned for the work completed.`,
        severity: 'critical',
      });
    } else if (metrics.CPI < 0.9) {
      warnings.push({
        type: 'cost',
        message: `Cost performance significantly below target (CPI: ${metrics.CPI}). Review expenditures and identify cost-saving opportunities.`,
        severity: 'warning',
      });
    } else if (metrics.CPI < 0.95) {
      warnings.push({
        type: 'cost',
        message: `Cost performance slightly below target (CPI: ${metrics.CPI}). Monitor spending closely.`,
        severity: 'info',
      });
    }

    // SPI warnings
    if (metrics.SPI < 0.8) {
      warnings.push({
        type: 'schedule',
        message: `Schedule performance critically behind (SPI: ${metrics.SPI}). Major schedule recovery effort required.`,
        severity: 'critical',
      });
    } else if (metrics.SPI < 0.85) {
      warnings.push({
        type: 'schedule',
        message: `Schedule performance significantly behind (SPI: ${metrics.SPI}). Consider fast-tracking or crashing critical path activities.`,
        severity: 'warning',
      });
    } else if (metrics.SPI < 0.95) {
      warnings.push({
        type: 'schedule',
        message: `Schedule performance slightly behind (SPI: ${metrics.SPI}). Monitor progress on critical path tasks.`,
        severity: 'info',
      });
    }

    // TCPI warning — if it takes significantly more efficiency to finish on budget
    if (metrics.TCPI > 1.3) {
      warnings.push({
        type: 'completion',
        message: `To-Complete Performance Index is very high (TCPI: ${metrics.TCPI}). Completing within budget is extremely unlikely without corrective action.`,
        severity: 'critical',
      });
    } else if (metrics.TCPI > 1.2) {
      warnings.push({
        type: 'completion',
        message: `To-Complete Performance Index is elevated (TCPI: ${metrics.TCPI}). Remaining work must be completed at higher efficiency than current performance to stay within budget.`,
        severity: 'warning',
      });
    } else if (metrics.TCPI > 1.1) {
      warnings.push({
        type: 'completion',
        message: `To-Complete Performance Index is slightly elevated (TCPI: ${metrics.TCPI}). Efficiency improvements needed to meet budget targets.`,
        severity: 'info',
      });
    }

    // VAC warning — projected overrun
    if (metrics.VAC < 0) {
      const overrunPercent = metrics.BAC > 0
        ? Math.abs(parseFloat(((metrics.VAC / metrics.BAC) * 100).toFixed(1)))
        : 0;

      if (overrunPercent > 20) {
        warnings.push({
          type: 'budget',
          message: `Projected cost overrun of ${overrunPercent}% (VAC: $${metrics.VAC.toLocaleString()}). Budget rebaseline may be necessary.`,
          severity: 'critical',
        });
      } else if (overrunPercent > 10) {
        warnings.push({
          type: 'budget',
          message: `Projected cost overrun of ${overrunPercent}% (VAC: $${metrics.VAC.toLocaleString()}). Management attention required.`,
          severity: 'warning',
        });
      } else {
        warnings.push({
          type: 'budget',
          message: `Minor projected cost overrun of ${overrunPercent}% (VAC: $${metrics.VAC.toLocaleString()}).`,
          severity: 'info',
        });
      }
    }

    // Combined CPI & SPI below threshold
    if (metrics.CPI < 0.9 && metrics.SPI < 0.9) {
      warnings.push({
        type: 'combined',
        message: `Both cost and schedule performance are below target (CPI: ${metrics.CPI}, SPI: ${metrics.SPI}). Project is in a distressed state requiring immediate management intervention.`,
        severity: 'critical',
      });
    }

    // Positive indicator — if everything is good, add an info message
    if (warnings.length === 0) {
      warnings.push({
        type: 'status',
        message: 'All EVM indicators are within acceptable ranges. Project is performing on or above target.',
        severity: 'info',
      });
    }

    return warnings;
  }

  // -------------------------------------------------------------------------
  // Traditional EAC forecast methods
  // -------------------------------------------------------------------------

  private computeTraditionalForecasts(metrics: EVMCurrentMetrics): {
    eacCumulative: number;
    eacComposite: number;
    eacManagement: number;
  } {
    const { BAC, EV, AC, CPI, SPI } = metrics;

    // Method 1: EAC using cumulative CPI — EAC = BAC / CPI
    const eacCumulative = CPI > 0
      ? parseFloat((BAC / CPI).toFixed(2))
      : BAC;

    // Method 2: EAC using composite CPI * SPI — EAC = AC + (BAC - EV) / (CPI * SPI)
    const compositeIndex = CPI * SPI;
    const eacComposite = compositeIndex > 0
      ? parseFloat((AC + (BAC - EV) / compositeIndex).toFixed(2))
      : BAC;

    // Method 3: EAC management estimate — AC + remaining work at original rate
    // This assumes remaining work will be done at the planned rate: EAC = AC + (BAC - EV)
    const eacManagement = parseFloat((AC + (BAC - EV)).toFixed(2));

    return { eacCumulative, eacComposite, eacManagement };
  }

  // -------------------------------------------------------------------------
  // AI-powered predictions via Claude
  // -------------------------------------------------------------------------

  private async getAIPredictions(
    project: Project,
    currentMetrics: EVMCurrentMetrics,
    weeklyData: { date: string; cpi: number; spi: number }[],
    earlyWarnings: EVMEarlyWarning[],
    traditionalForecasts: { eacCumulative: number; eacComposite: number; eacManagement: number },
  ): Promise<EVMForecastAIResponse> {
    const projectContext = [
      `Project: ${project.name}`,
      `Type: ${project.projectType}`,
      `Status: ${project.status}`,
      `Budget Allocated (BAC): $${(project.budgetAllocated || 0).toLocaleString()}`,
      `Budget Spent: $${project.budgetSpent.toLocaleString()}`,
      `Start Date: ${project.startDate ? new Date(project.startDate).toISOString().slice(0, 10) : 'N/A'}`,
      `End Date: ${project.endDate ? new Date(project.endDate).toISOString().slice(0, 10) : 'N/A'}`,
      `Priority: ${project.priority}`,
    ].join('\n');

    const evmMetricsStr = Object.entries(currentMetrics)
      .map(([key, value]) => `${key}: ${typeof value === 'number' ? value.toLocaleString() : value}`)
      .join('\n');

    const trendsStr = weeklyData.length > 0
      ? weeklyData
          .slice(-12) // last 12 weeks max
          .map((w) => `${w.date}: CPI=${w.cpi}, SPI=${w.spi}`)
          .join('\n')
      : 'No historical data available';

    const warningsStr = earlyWarnings.length > 0
      ? earlyWarnings
          .map((w) => `[${w.severity.toUpperCase()}] ${w.type}: ${w.message}`)
          .join('\n')
      : 'No warnings';

    const forecastsStr = [
      `EAC (Cumulative CPI): $${traditionalForecasts.eacCumulative.toLocaleString()}`,
      `EAC (Composite CPI*SPI): $${traditionalForecasts.eacComposite.toLocaleString()}`,
      `EAC (Management Estimate): $${traditionalForecasts.eacManagement.toLocaleString()}`,
    ].join('\n');

    const systemPrompt = evmForecastPrompt.render({
      projectContext,
      evmMetrics: evmMetricsStr,
      historicalTrends: trendsStr,
      earlyWarnings: warningsStr,
      traditionalForecasts: forecastsStr,
    });

    const result = await claudeService.completeWithJsonSchema({
      systemPrompt,
      userMessage: 'Analyze the EVM data and return the forecast predictions JSON.',
      schema: EVMForecastAIResponseSchema,
      temperature: 0.3,
      maxTokens: 2048,
    });

    return result.data;
  }
}

export const evmForecastService = new EVMForecastService();
