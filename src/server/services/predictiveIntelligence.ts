import { FastifyInstance } from 'fastify';
import { AIContextBuilder, ProjectContext, PortfolioContext } from './aiContextBuilder';
import { claudeService, PromptTemplate } from './claudeService';
import { dataProviderManager } from './dataProviders';
import { logAIUsage } from './aiUsageLogger';
import {
  AIRiskAssessmentSchema,
  AIWeatherImpactSchema,
  AIBudgetForecastSchema,
  AIDashboardPredictionsSchema,
  type AIRiskAssessment,
  type AIWeatherImpact,
  type AIBudgetForecast,
  type AIDashboardPredictions,
} from '../schemas/predictiveSchemas';
import type { WeatherForecast } from './dataProviders';
import { projectService } from './ProjectService';
import { redisService } from './RedisService';
import logger from '../utils/logger';

const DASHBOARD_CACHE_KEY = 'predictions:dashboard';
const DASHBOARD_CACHE_TTL = 300; // 5 minutes

// ---------------------------------------------------------------------------
// Project Metrics (computed inline since AIContextBuilder doesn't carry them)
// ---------------------------------------------------------------------------

export interface ProjectMetrics {
  completionRate: number;
  scheduleVariance: number;
  budgetUtilization: number;
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  daysElapsed: number;
  daysRemaining: number;
}

function computeProjectMetrics(ctx: ProjectContext, budgetSpent?: number): ProjectMetrics {
  const allTasks = ctx.schedules.flatMap((s) => s.tasks);
  const totalTasks = allTasks.length;
  const completedTasks = allTasks.filter((t) => t.status === 'completed').length;
  const completionRate =
    totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // overdue = not completed and has a dueDate in the past
  const now = new Date();
  const overdueTasks = allTasks.filter(
    (t) => t.status !== 'completed' && t.dueDate && new Date(t.dueDate) < now,
  ).length;

  // schedule variance: expected % complete vs actual
  const startDate = ctx.project.startDate ? new Date(ctx.project.startDate) : now;
  const endDate = ctx.project.endDate
    ? new Date(ctx.project.endDate)
    : new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  const totalDuration = endDate.getTime() - startDate.getTime();
  const elapsed = Math.max(0, now.getTime() - startDate.getTime());
  const daysElapsed = Math.round(elapsed / (24 * 60 * 60 * 1000));
  const daysRemaining = Math.max(
    0,
    Math.round((endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
  );
  const expectedPercent =
    totalDuration > 0 ? Math.min(100, (elapsed / totalDuration) * 100) : 0;
  const scheduleVariance = completionRate - expectedPercent;

  const budgetAllocated = ctx.project.budgetAllocated || 0;
  const spent = budgetSpent ?? ctx.project.budgetSpent ?? 0;
  const budgetUtilization =
    budgetAllocated > 0 ? (spent / budgetAllocated) * 100 : 0;

  return {
    completionRate,
    scheduleVariance,
    budgetUtilization,
    totalTasks,
    completedTasks,
    overdueTasks,
    daysElapsed,
    daysRemaining,
  };
}

// ---------------------------------------------------------------------------
// Outdoor-sensitive task category keywords
// ---------------------------------------------------------------------------

const OUTDOOR_KEYWORDS = [
  'construction',
  'earthwork',
  'excavation',
  'grading',
  'paving',
  'concrete',
  'foundation',
  'roofing',
  'landscaping',
  'drainage',
  'bridge',
  'road',
  'building',
  'installation',
  'site preparation',
  'demolition',
  'clearing',
  'survey',
  'inspection',
];

// ---------------------------------------------------------------------------
// Prompt Templates (GENERIC — no Guyana, no Ministry of Works)
// ---------------------------------------------------------------------------

const DOMAIN_RISK_GUIDANCE: Record<string, string> = {
  it: `Domain-specific risks to evaluate for IT/software projects:
- Data migration failure or data loss during system transitions
- Integration risks with existing systems, APIs, or third-party services
- Security vulnerabilities (authentication, data breaches, access control)
- Vendor lock-in or dependency on specific platforms/technologies
- Scope creep from changing requirements or stakeholder expectations
- Technical debt and maintainability concerns
- User adoption and change management resistance
- Performance and scalability under production load
- Regulatory compliance (data privacy, accessibility, industry standards)
- Key person dependency — loss of critical technical knowledge`,

  construction: `Domain-specific risks to evaluate for construction projects:
- Weather delays (rain, extreme heat/cold, storms, seasonal impacts)
- Supply chain disruptions (material shortages, price increases, delivery delays)
- Labor shortages or skill availability in the region
- Permit and regulatory approval delays
- Site conditions differing from surveys (soil, environmental, utilities)
- Subcontractor performance and coordination failures
- Safety incidents and occupational health hazards
- Design changes or clashes discovered during construction
- Equipment breakdown or availability issues
- Community opposition or stakeholder objections`,

  infrastructure: `Domain-specific risks to evaluate for infrastructure projects:
- Environmental impact assessment delays or regulatory challenges
- Right-of-way and land acquisition issues
- Utility relocation conflicts and coordination
- Geotechnical or subsurface condition surprises
- Public safety and traffic management during construction
- Multi-agency coordination and approval bottlenecks
- Long-term maintenance and lifecycle cost considerations
- Political or funding changes affecting project continuity
- Weather and seasonal construction window constraints
- Community disruption and public communication challenges`,

  roads: `Domain-specific risks to evaluate for road/transportation projects:
- Traffic management and public safety during construction
- Weather and seasonal paving/construction windows
- Utility relocation and underground service conflicts
- Environmental and drainage impact concerns
- Right-of-way acquisition and property access issues
- Subgrade and soil condition variability
- Material quality and supply chain reliability
- Regulatory and permit compliance (environmental, safety)
- Coordination with adjacent projects or jurisdictions
- Public opposition and stakeholder communication failures`,

  other: `Domain-specific risks to evaluate:
- Stakeholder alignment and expectation management
- Resource availability and key person dependencies
- Scope definition clarity and change management
- Regulatory or compliance requirements
- External dependencies and vendor/partner reliability
- Communication breakdowns across teams or organizations`,
};

const riskPredictionPrompt = new PromptTemplate(
  `You are a risk prediction engine for project management. Analyze the project data and produce a comprehensive risk assessment.

Consider all risk dimensions: schedule, budget, resource, weather, regulatory, technical, dependency, and stakeholder risks.

{{domainGuidance}}

For each risk:
- Score probability (1-5) and impact (1-5)
- Assign severity: low (score 1-5), medium (6-10), high (11-15), critical (16-25) where score = probability * impact
- List concrete, actionable mitigations specific to this project
- Identify affected tasks where possible

Even if the project metrics look healthy, identify risks that are inherent to this type of project and could emerge. A healthy project still has risks — surface them proactively.

Project data:
{{projectData}}

Weather summary:
{{weatherSummary}}

Return a JSON object matching the schema. Be specific to this project's context — avoid generic advice. Aim for 3-8 risks.`,
  '2.0.0',
);

const weatherImpactPrompt = new PromptTemplate(
  `You are a weather impact analyst for projects. Analyze the weather forecast against the project's outdoor tasks.

Project data:
{{projectData}}

Weather forecast (next 7 days):
{{weatherForecast}}

Outdoor-sensitive tasks:
{{outdoorTasks}}

Assess which tasks will be affected by weather, estimate delay days, and provide recommendations. Return a JSON object matching the schema.`,
  '1.0.0',
);

const budgetForecastPrompt = new PromptTemplate(
  `You are a budget and earned value management analyst. Interpret the EVM metrics and project context to provide actionable budget insights.

Project data:
{{projectData}}

EVM metrics:
{{evmMetrics}}

Provide budget recommendations, overrun probability assessment, and a clear summary. Return a JSON object matching the schema.`,
  '1.0.0',
);

const dashboardBriefingPrompt = new PromptTemplate(
  `You are a portfolio intelligence analyst. Generate a concise daily briefing for the project manager.

Portfolio data:
{{portfolioData}}

Weather overview:
{{weatherOverview}}

Return a JSON object with:
- risks: count of critical/high/medium/low risks across the portfolio
- weather: current condition and impact summary
- budget: projects over budget vs on track, average CPI
- summary: 1-2 sentence daily briefing
- highlights: array of key items (text + type: risk/success/info)
- projectHealthScores: array of {projectId, healthScore (0-100), riskLevel}

Be concise and actionable.`,
  '1.0.0',
);

// ---------------------------------------------------------------------------
// Pure Utility Functions (exported for testing)
// ---------------------------------------------------------------------------

export function computeDeterministicRiskScore(
  metrics: ProjectMetrics,
  budgetUtilization: number,
): { score: number; severity: 'low' | 'medium' | 'high' | 'critical'; healthScore: number } {
  let score = 0;

  // Schedule risk: behind schedule increases risk
  if (metrics.scheduleVariance < -20) score += 30;
  else if (metrics.scheduleVariance < -10) score += 20;
  else if (metrics.scheduleVariance < 0) score += 10;

  // Budget risk: over-utilization
  if (budgetUtilization > 100) score += 30;
  else if (budgetUtilization > 90) score += 20;
  else if (budgetUtilization > 75) score += 10;

  // Overdue task ratio
  const overdueRatio =
    metrics.totalTasks > 0 ? metrics.overdueTasks / metrics.totalTasks : 0;
  if (overdueRatio > 0.3) score += 25;
  else if (overdueRatio > 0.15) score += 15;
  else if (overdueRatio > 0) score += 5;

  // Low completion with time running out
  if (metrics.daysRemaining < 30 && metrics.completionRate < 50) score += 15;

  score = Math.min(score, 100);
  const healthScore = Math.max(0, 100 - score);

  let severity: 'low' | 'medium' | 'high' | 'critical';
  if (score >= 70) severity = 'critical';
  else if (score >= 45) severity = 'high';
  else if (score >= 20) severity = 'medium';
  else severity = 'low';

  return { score, severity, healthScore };
}

export function computeEVMMetrics(
  budgetAllocated: number,
  budgetSpent: number,
  completionRate: number,
  daysElapsed: number,
  totalDays: number,
): {
  cpi: number;
  spi: number;
  eac: number;
  etc: number;
  vac: number;
  burnRateDaily: number;
  burnRateMonthly: number;
  plannedValue: number;
  earnedValue: number;
  actualCost: number;
  cv: number;
  sv: number;
  tcpiBAC: number;
  tcpiEAC: number;
} {
  const percentElapsed =
    totalDays > 0 ? Math.min(daysElapsed / totalDays, 1) : 0;
  const plannedValue = budgetAllocated * percentElapsed;
  const earnedValue = budgetAllocated * (completionRate / 100);
  const actualCost = budgetSpent;

  const cpi =
    actualCost > 0
      ? parseFloat((earnedValue / actualCost).toFixed(2))
      : 1;
  const spi =
    plannedValue > 0
      ? parseFloat((earnedValue / plannedValue).toFixed(2))
      : 1;

  const eac =
    cpi > 0
      ? parseFloat((budgetAllocated / cpi).toFixed(2))
      : budgetAllocated;
  const etc = Math.max(0, parseFloat((eac - actualCost).toFixed(2)));
  const vac = parseFloat((budgetAllocated - eac).toFixed(2));

  const cv = parseFloat((earnedValue - actualCost).toFixed(2));
  const sv = parseFloat((earnedValue - plannedValue).toFixed(2));

  // TCPI = (BAC - EV) / (BAC - AC) — To Complete Performance Index against BAC
  const tcpiBAC =
    budgetAllocated - actualCost > 0
      ? parseFloat(((budgetAllocated - earnedValue) / (budgetAllocated - actualCost)).toFixed(2))
      : 1;

  // TCPI against EAC = (BAC - EV) / (EAC - AC)
  const tcpiEAC =
    eac - actualCost > 0
      ? parseFloat(((budgetAllocated - earnedValue) / (eac - actualCost)).toFixed(2))
      : 1;

  const burnRateDaily =
    daysElapsed > 0
      ? parseFloat((actualCost / daysElapsed).toFixed(2))
      : 0;
  const burnRateMonthly = parseFloat((burnRateDaily * 30).toFixed(2));

  return {
    cpi, spi, eac, etc, vac, burnRateDaily, burnRateMonthly,
    plannedValue: parseFloat(plannedValue.toFixed(2)),
    earnedValue: parseFloat(earnedValue.toFixed(2)),
    actualCost: parseFloat(actualCost.toFixed(2)),
    cv, sv, tcpiBAC, tcpiEAC,
  };
}

export function categorizeWeatherImpact(
  conditionCode: string,
  precipMm: number,
  windKph: number,
): 'none' | 'low' | 'moderate' | 'high' | 'severe' {
  const code = conditionCode.toLowerCase();
  const isStorm = code.includes('thunder') || code.includes('storm');
  const isHeavyRain = code.includes('heavy') && code.includes('rain');

  if (isStorm || precipMm > 50 || windKph > 80) return 'severe';
  if (isHeavyRain || precipMm > 20 || windKph > 50) return 'high';
  if (precipMm > 10 || windKph > 30 || code.includes('rain')) return 'moderate';
  if (
    precipMm > 2 ||
    code.includes('drizzle') ||
    code.includes('overcast')
  )
    return 'low';
  return 'none';
}

export function isOutdoorTask(taskName: string, category?: string): boolean {
  const text = `${taskName} ${category || ''}`.toLowerCase();
  return OUTDOOR_KEYWORDS.some((kw) => text.includes(kw));
}

// ---------------------------------------------------------------------------
// PredictiveIntelligenceService
// ---------------------------------------------------------------------------

export class PredictiveIntelligenceService {
  private contextBuilder: AIContextBuilder;
  private fastify: FastifyInstance;

  constructor(fastify: FastifyInstance) {
    this.fastify = fastify;
    this.contextBuilder = new AIContextBuilder(fastify);
  }

  // -----------------------------------------------------------------------
  // Helper: get project coordinates from the project record
  // -----------------------------------------------------------------------

  private async getProjectCoordinates(
    projectId: string,
  ): Promise<{ lat: number; lon: number } | null> {
    const project = await projectService.findById(projectId);
    if (project?.locationLat && project?.locationLon) {
      return { lat: project.locationLat, lon: project.locationLon };
    }
    return null;
  }

  // -----------------------------------------------------------------------
  // Helper: get budget spent from the project record
  // -----------------------------------------------------------------------

  private async getProjectBudgetSpent(projectId: string): Promise<number> {
    const project = await projectService.findById(projectId);
    return project?.budgetSpent ?? 0;
  }

  // -----------------------------------------------------------------------
  // 1. Risk Assessment
  // -----------------------------------------------------------------------

  async assessProjectRisks(
    projectId: string,
    userId?: string,
  ): Promise<{ assessment: AIRiskAssessment; aiPowered: boolean }> {
    const context = await this.contextBuilder.buildProjectContext(projectId);
    const budgetSpent = await this.getProjectBudgetSpent(projectId);
    const metrics = computeProjectMetrics(context, budgetSpent);
    const { score, severity, healthScore } = computeDeterministicRiskScore(
      metrics,
      metrics.budgetUtilization,
    );

    if (!claudeService.isAvailable()) {
      return {
        assessment: this.buildFallbackRiskAssessment(context, metrics, score, severity, healthScore),
        aiPowered: false,
      };
    }

    try {
      const projectPrompt = this.contextBuilder.toPromptString(context);

      let weatherSummary = 'Weather data unavailable';
      try {
        const coords = await this.getProjectCoordinates(projectId);
        if (coords) {
          const weather = await dataProviderManager.getWeather(coords.lat, coords.lon, 7);
          weatherSummary = `Current: ${weather.current.condition}, ${weather.current.temperature}\u00B0C, precipitation: ${weather.current.precipitation}mm, wind: ${weather.current.windSpeed}km/h`;
        }
      } catch {
        /* weather fetch failure is non-critical */
      }

      const projectType = context.project.projectType || 'other';
      const domainGuidance = DOMAIN_RISK_GUIDANCE[projectType] || DOMAIN_RISK_GUIDANCE.other;

      const systemPrompt = riskPredictionPrompt.render({
        projectData: projectPrompt,
        weatherSummary,
        domainGuidance,
      });

      const result = await claudeService.completeWithJsonSchema({
        systemPrompt,
        userMessage: 'Analyze this project and return the risk assessment JSON.',
        schema: AIRiskAssessmentSchema,
        temperature: 0.3,
      });

      logAIUsage({
        userId,
        feature: 'risk_assessment',
        model: 'claude',
        usage: result.usage,
        latencyMs: result.latencyMs,
        success: true,
        requestContext: { projectId },
      });

      this.storeRiskAssessment(projectId, result.data);

      return { assessment: result.data, aiPowered: true };
    } catch (err) {
      this.fastify.log.warn({ err }, 'AI risk assessment failed, using fallback');
      logAIUsage({
        userId,
        feature: 'risk_assessment',
        model: 'claude',
        usage: { inputTokens: 0, outputTokens: 0 },
        latencyMs: 0,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
        requestContext: { projectId },
      });
      return {
        assessment: this.buildFallbackRiskAssessment(context, metrics, score, severity, healthScore),
        aiPowered: false,
      };
    }
  }

  // -----------------------------------------------------------------------
  // 2. Weather Impact Analysis
  // -----------------------------------------------------------------------

  async analyzeWeatherImpact(
    projectId: string,
    userId?: string,
  ): Promise<{ impact: AIWeatherImpact; aiPowered: boolean }> {
    const context = await this.contextBuilder.buildProjectContext(projectId);
    const coords = await this.getProjectCoordinates(projectId);

    if (!coords) {
      return { impact: this.buildNoWeatherImpact(), aiPowered: false };
    }

    let weather: WeatherForecast;
    try {
      weather = await dataProviderManager.getWeather(coords.lat, coords.lon, 7);
    } catch {
      return { impact: this.buildNoWeatherImpact(), aiPowered: false };
    }

    const allTasks = context.schedules.flatMap((s) => s.tasks);
    const outdoorTasks = allTasks.filter(
      (t) => isOutdoorTask(t.name) && t.status !== 'completed',
    );

    if (!claudeService.isAvailable()) {
      return {
        impact: this.buildFallbackWeatherImpact(weather, outdoorTasks),
        aiPowered: false,
      };
    }

    try {
      const projectPrompt = this.contextBuilder.toPromptString(context);
      const forecastStr = weather.daily
        .map(
          (d) =>
            `${d.date}: ${d.condition}, precip ${d.precipitationAmount}mm (${d.precipitationChance}% chance), wind ${d.windSpeed}km/h`,
        )
        .join('\n');
      const outdoorStr =
        outdoorTasks.length > 0
          ? outdoorTasks
              .map(
                (t) =>
                  `- ${t.name} (${t.status}, ${t.progressPercentage ?? 0}% done)`,
              )
              .join('\n')
          : 'No outdoor-sensitive tasks identified';

      const systemPrompt = weatherImpactPrompt.render({
        projectData: projectPrompt,
        weatherForecast: forecastStr,
        outdoorTasks: outdoorStr,
      });

      const result = await claudeService.completeWithJsonSchema({
        systemPrompt,
        userMessage:
          'Analyze the weather impact on this project and return the JSON assessment.',
        schema: AIWeatherImpactSchema,
        temperature: 0.3,
      });

      logAIUsage({
        userId,
        feature: 'weather_impact',
        model: 'claude',
        usage: result.usage,
        latencyMs: result.latencyMs,
        success: true,
        requestContext: { projectId },
      });

      return { impact: result.data, aiPowered: true };
    } catch (err) {
      this.fastify.log.warn({ err }, 'AI weather impact failed, using fallback');
      return {
        impact: this.buildFallbackWeatherImpact(weather, outdoorTasks),
        aiPowered: false,
      };
    }
  }

  // -----------------------------------------------------------------------
  // 3. Budget Forecast
  // -----------------------------------------------------------------------

  async forecastBudget(
    projectId: string,
    userId?: string,
  ): Promise<{ forecast: AIBudgetForecast; aiPowered: boolean }> {
    const context = await this.contextBuilder.buildProjectContext(projectId);
    const budgetSpent = await this.getProjectBudgetSpent(projectId);
    const metrics = computeProjectMetrics(context, budgetSpent);
    const budgetAllocated = context.project.budgetAllocated || 0;

    const totalDays = metrics.daysElapsed + metrics.daysRemaining;
    const evm = computeEVMMetrics(
      budgetAllocated,
      budgetSpent,
      metrics.completionRate,
      metrics.daysElapsed,
      totalDays,
    );

    const overrunProbability =
      evm.cpi < 0.8
        ? 85
        : evm.cpi < 0.9
          ? 65
          : evm.cpi < 1.0
            ? 40
            : evm.cpi < 1.1
              ? 20
              : 10;

    const fallbackForecast: AIBudgetForecast = {
      ...evm,
      overrunProbability,
      projectedCompletionBudget: evm.eac,
      recommendations: this.buildBudgetRecommendations(evm),
      summary: this.buildBudgetSummary(evm, budgetAllocated),
    };

    if (!claudeService.isAvailable()) {
      return { forecast: fallbackForecast, aiPowered: false };
    }

    try {
      const projectPrompt = this.contextBuilder.toPromptString(context);

      const evmStr = Object.entries(evm)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');

      const systemPrompt = budgetForecastPrompt.render({
        projectData: projectPrompt,
        evmMetrics: `Budget Allocated: $${budgetAllocated.toLocaleString()}\nBudget Spent: $${budgetSpent.toLocaleString()}\n${evmStr}`,
      });

      const result = await claudeService.completeWithJsonSchema({
        systemPrompt,
        userMessage: 'Analyze the budget and return the forecast JSON.',
        schema: AIBudgetForecastSchema,
        temperature: 0.3,
      });

      logAIUsage({
        userId,
        feature: 'budget_forecast',
        model: 'claude',
        usage: result.usage,
        latencyMs: result.latencyMs,
        success: true,
        requestContext: { projectId },
      });

      return { forecast: result.data, aiPowered: true };
    } catch (err) {
      this.fastify.log.warn({ err }, 'AI budget forecast failed, using fallback');
      return { forecast: fallbackForecast, aiPowered: false };
    }
  }

  // -----------------------------------------------------------------------
  // 4. Dashboard Predictions
  // -----------------------------------------------------------------------

  async getDashboardPredictions(
    userId?: string,
    userRole?: string,
  ): Promise<{ predictions: AIDashboardPredictions; aiPowered: boolean }> {
    // Check cache first — return immediately if fresh data available
    const cacheKey = `${DASHBOARD_CACHE_KEY}:${userId || 'anon'}`;
    try {
      const cached = await redisService.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        return parsed;
      }
    } catch { /* cache miss, continue */ }

    const portfolio = await this.contextBuilder.buildPortfolioContext({ userId, role: userRole });

    // Compute per-project health deterministically
    const projectHealthScores: Array<{
      projectId: string;
      healthScore: number;
      riskLevel: 'low' | 'medium' | 'high' | 'critical';
    }> = [];
    let criticalCount = 0;
    let highCount = 0;
    let mediumCount = 0;
    let lowCount = 0;

    for (const p of portfolio.projects) {
      // Planning projects have no meaningful health data — skip them
      if (p.status === 'planning') continue;

      const completion = p.completionPercentage ?? 0;
      const budgetAllocated = p.budgetAllocated || 0;
      const spent = p.budgetSpent || 0;
      const budgetUtil = budgetAllocated > 0 ? (spent / budgetAllocated) * 100 : 0;

      // Weighted health: 40% schedule (progress), 30% budget, 30% general health
      const scheduleHealth =
        p.status === 'completed'
          ? 100
          : Math.min(completion, 100);
      const budgetHealth =
        budgetUtil <= 100
          ? 100 - budgetUtil * 0.5
          : Math.max(0, 100 - budgetUtil);

      // Simple general health indicator based on status
      const generalHealth =
        p.status === 'active' || p.status === 'completed'
          ? 85
          : p.status === 'on_hold'
            ? 55
            : p.status === 'cancelled'
              ? 25
              : 70; // planning

      const healthScore = Math.round(
        scheduleHealth * 0.4 + budgetHealth * 0.3 + generalHealth * 0.3,
      );

      let riskLevel: 'low' | 'medium' | 'high' | 'critical';
      if (healthScore >= 75) {
        riskLevel = 'low';
        lowCount++;
      } else if (healthScore >= 50) {
        riskLevel = 'medium';
        mediumCount++;
      } else if (healthScore >= 25) {
        riskLevel = 'high';
        highCount++;
      } else {
        riskLevel = 'critical';
        criticalCount++;
      }

      projectHealthScores.push({
        projectId: p.id,
        healthScore,
        riskLevel,
      });
    }

    const overBudgetCount = portfolio.projects.filter((p) => {
      const allocated = p.budgetAllocated || 0;
      const spent = p.budgetSpent || 0;
      return allocated > 0 && (spent / allocated) * 100 > 90;
    }).length;
    const onTrackCount = portfolio.projects.length - overBudgetCount;

    const activeProjects = portfolio.projects.filter(
      (p) => p.status === 'active',
    ).length;

    // Try to get weather for the first project with coordinates
    let weatherCondition = 'Clear';
    let weatherImpactStr = 'No weather impacts expected';
    let weatherOverview = 'Weather data unavailable';
    try {
      const allProjects = await projectService.findAll();
      const projectWithCoords = allProjects.find(
        (p) => p.locationLat && p.locationLon,
      );
      if (projectWithCoords) {
        const weather = await dataProviderManager.getWeather(
          projectWithCoords.locationLat!,
          projectWithCoords.locationLon!,
          7,
        );
        weatherCondition = weather.current.condition;
        const impact = categorizeWeatherImpact(
          weather.current.conditionCode,
          weather.current.precipitation,
          weather.current.windSpeed,
        );
        weatherImpactStr =
          impact === 'none'
            ? 'No weather impacts expected'
            : `${impact} impact \u2014 ${weather.current.condition}`;
        weatherOverview =
          `Current: ${weather.current.condition}, ${weather.current.temperature}\u00B0C, precip: ${weather.current.precipitation}mm. ` +
          `7-day outlook: ${weather.daily.map((d) => `${d.date}: ${d.condition}`).join(', ')}`;
      }
    } catch {
      /* non-critical */
    }

    const fallbackPredictions: AIDashboardPredictions = {
      risks: {
        critical: criticalCount,
        high: highCount,
        medium: mediumCount,
        low: lowCount,
      },
      weather: { condition: weatherCondition, impact: weatherImpactStr },
      budget: { overBudget: overBudgetCount, onTrack: onTrackCount },
      summary: `You have ${portfolio.totalProjects} project${portfolio.totalProjects !== 1 ? 's' : ''} in your portfolio. ${activeProjects} active.`,
      highlights: this.buildDashboardHighlights(
        criticalCount,
        highCount,
        overBudgetCount,
        activeProjects,
      ),
      projectHealthScores,
    };

    if (!claudeService.isAvailable()) {
      const fallbackResult = { predictions: fallbackPredictions, aiPowered: false };
      this.cacheDashboardResult(cacheKey, fallbackResult);
      return fallbackResult;
    }

    // Return fallback immediately, trigger AI enrichment in background
    const fallbackResult = { predictions: fallbackPredictions, aiPowered: false };

    // Fire-and-forget: enrich with AI and cache the result for subsequent requests
    this.enrichDashboardWithAI(cacheKey, portfolio, fallbackPredictions, weatherOverview, userId).catch((err) => {
      logger.warn('Background AI dashboard enrichment failed: ' + String(err));
    });

    return fallbackResult;
  }

  private async enrichDashboardWithAI(
    cacheKey: string,
    portfolio: PortfolioContext,
    fallbackPredictions: AIDashboardPredictions,
    weatherOverview: string,
    userId?: string,
  ): Promise<void> {
    const portfolioPrompt = this.contextBuilder.portfolioToPromptString(portfolio);

    const systemPrompt = dashboardBriefingPrompt.render({
      portfolioData: portfolioPrompt,
      weatherOverview,
    });

    const result = await claudeService.completeWithJsonSchema({
      systemPrompt,
      userMessage: 'Generate the dashboard predictions JSON.',
      schema: AIDashboardPredictionsSchema,
      temperature: 0.3,
    });

    logAIUsage({
      userId,
      feature: 'dashboard_predictions',
      model: 'claude',
      usage: result.usage,
      latencyMs: result.latencyMs,
      success: true,
      requestContext: {},
    });

    const merged: AIDashboardPredictions = {
      ...result.data,
      summary: fallbackPredictions.summary,
      risks: fallbackPredictions.risks,
      budget: fallbackPredictions.budget,
      projectHealthScores: fallbackPredictions.projectHealthScores,
    };

    const enrichedResult = { predictions: merged, aiPowered: true };
    this.cacheDashboardResult(cacheKey, enrichedResult);
  }

  private cacheDashboardResult(cacheKey: string, result: { predictions: AIDashboardPredictions; aiPowered: boolean }): void {
    redisService.set(cacheKey, JSON.stringify(result), DASHBOARD_CACHE_TTL).catch(() => {});
  }

  // -----------------------------------------------------------------------
  // 5. Project Health Score
  // -----------------------------------------------------------------------

  async getProjectHealthScore(
    projectId: string,
    _userId?: string,
  ): Promise<{
    healthScore: number;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    breakdown: {
      scheduleHealth: number;
      budgetHealth: number;
      riskHealth: number;
      weatherHealth: number;
    };
    aiPowered: boolean;
  }> {
    const context = await this.contextBuilder.buildProjectContext(projectId);
    const budgetSpent = await this.getProjectBudgetSpent(projectId);
    const metrics = computeProjectMetrics(context, budgetSpent);

    // Schedule health (0-100)
    const scheduleHealth = Math.max(
      0,
      Math.min(100, 50 + metrics.scheduleVariance),
    );

    // Budget health (0-100)
    const budgetHealth =
      metrics.budgetUtilization <= 100
        ? Math.max(0, 100 - metrics.budgetUtilization * 0.5)
        : Math.max(0, 100 - metrics.budgetUtilization);

    // Risk health from deterministic scoring
    const { healthScore: riskHealth } = computeDeterministicRiskScore(
      metrics,
      metrics.budgetUtilization,
    );

    // Weather health (attempt to check)
    let weatherHealth = 80; // default good
    try {
      const coords = await this.getProjectCoordinates(projectId);
      if (coords) {
        const weather = await dataProviderManager.getWeather(
          coords.lat,
          coords.lon,
          3,
        );
        const impact = categorizeWeatherImpact(
          weather.current.conditionCode,
          weather.current.precipitation,
          weather.current.windSpeed,
        );
        weatherHealth =
          impact === 'none'
            ? 95
            : impact === 'low'
              ? 80
              : impact === 'moderate'
                ? 60
                : impact === 'high'
                  ? 35
                  : 15;
      }
    } catch {
      /* use default */
    }

    // Weighted composite: 40% schedule, 30% budget, 20% risk, 10% weather
    const healthScore = Math.round(
      scheduleHealth * 0.4 +
        budgetHealth * 0.3 +
        riskHealth * 0.2 +
        weatherHealth * 0.1,
    );

    let riskLevel: 'low' | 'medium' | 'high' | 'critical';
    if (healthScore >= 75) riskLevel = 'low';
    else if (healthScore >= 50) riskLevel = 'medium';
    else if (healthScore >= 25) riskLevel = 'high';
    else riskLevel = 'critical';

    return {
      healthScore,
      riskLevel,
      breakdown: { scheduleHealth, budgetHealth, riskHealth, weatherHealth },
      aiPowered: false, // Health score is always deterministic
    };
  }

  // -----------------------------------------------------------------------
  // Private: Fallback Builders
  // -----------------------------------------------------------------------

  private buildFallbackRiskAssessment(
    context: ProjectContext,
    metrics: ProjectMetrics,
    score: number,
    severity: 'low' | 'medium' | 'high' | 'critical',
    healthScore: number,
  ): AIRiskAssessment {
    const risks: AIRiskAssessment['risks'] = [];

    if (metrics.scheduleVariance < -10) {
      risks.push({
        type: 'schedule',
        title: 'Schedule Delay',
        description: `Project is ${Math.abs(Math.round(metrics.scheduleVariance))}% behind schedule.`,
        probability: metrics.scheduleVariance < -20 ? 5 : 3,
        impact: 4,
        severity: metrics.scheduleVariance < -20 ? 'critical' : 'high',
        affectedTasks: [],
        mitigations: [
          'Review critical path tasks',
          'Consider additional resources',
          'Re-negotiate timeline with stakeholders',
        ],
      });
    }

    if (metrics.budgetUtilization > 90) {
      risks.push({
        type: 'budget',
        title: 'Budget Overrun Risk',
        description: `Budget utilization at ${Math.round(metrics.budgetUtilization)}%.`,
        probability: metrics.budgetUtilization > 100 ? 5 : 3,
        impact: 4,
        severity: metrics.budgetUtilization > 100 ? 'critical' : 'high',
        affectedTasks: [],
        mitigations: [
          'Conduct budget review',
          'Identify cost-saving opportunities',
          'Request supplementary funding if needed',
        ],
      });
    }

    if (metrics.overdueTasks > 0) {
      risks.push({
        type: 'resource',
        title: 'Overdue Tasks',
        description: `${metrics.overdueTasks} task${metrics.overdueTasks !== 1 ? 's are' : ' is'} overdue.`,
        probability: 4,
        impact: 3,
        severity: metrics.overdueTasks > 5 ? 'high' : 'medium',
        affectedTasks: [],
        mitigations: [
          'Reassign or reprioritize overdue tasks',
          'Address resource bottlenecks',
          'Update task estimates',
        ],
      });
    }

    // Domain-specific risks based on project type
    const domainRisks = this.getDomainFallbackRisks(context.project.projectType);
    risks.push(...domainRisks);

    const trend =
      metrics.scheduleVariance < -15
        ? ('deteriorating' as const)
        : metrics.scheduleVariance > 5
          ? ('improving' as const)
          : ('stable' as const);

    return {
      overallScore: score,
      overallSeverity: severity,
      healthScore,
      risks,
      summary: `Project "${context.project.name}" has ${severity} risk (score: ${score}/100). ${metrics.completionRate}% complete with ${metrics.daysRemaining} days remaining.`,
      trend,
    };
  }

  private getDomainFallbackRisks(projectType: string): AIRiskAssessment['risks'] {
    const risks: AIRiskAssessment['risks'] = [];

    switch (projectType) {
      case 'it':
        risks.push(
          {
            type: 'technical',
            title: 'Integration and Compatibility Risk',
            description: 'Integration with existing systems, APIs, or third-party services may encounter unexpected incompatibilities or data format issues.',
            probability: 3, impact: 3, severity: 'medium',
            affectedTasks: [],
            mitigations: ['Define integration contracts early', 'Build integration test environments', 'Plan for API versioning and rollback'],
          },
          {
            type: 'technical',
            title: 'Security Vulnerability Risk',
            description: 'New systems may introduce security gaps including authentication flaws, data exposure, or insufficient access controls.',
            probability: 2, impact: 4, severity: 'medium',
            affectedTasks: [],
            mitigations: ['Conduct security review before launch', 'Implement automated vulnerability scanning', 'Follow OWASP guidelines for all endpoints'],
          },
          {
            type: 'stakeholder',
            title: 'User Adoption Risk',
            description: 'End users may resist adopting the new system due to unfamiliarity, poor training, or preference for existing workflows.',
            probability: 3, impact: 3, severity: 'medium',
            affectedTasks: [],
            mitigations: ['Plan user training sessions', 'Involve end users in UAT early', 'Create user documentation and quick-start guides'],
          },
        );
        break;

      case 'construction':
        risks.push(
          {
            type: 'weather',
            title: 'Weather Delay Risk',
            description: 'Adverse weather (rain, extreme temperatures, storms) may halt outdoor construction activities and delay the schedule.',
            probability: 3, impact: 3, severity: 'medium',
            affectedTasks: [],
            mitigations: ['Build weather contingency days into schedule', 'Monitor forecasts weekly', 'Prepare covered work areas where feasible'],
          },
          {
            type: 'resource',
            title: 'Supply Chain and Material Risk',
            description: 'Material shortages, price increases, or delivery delays may impact construction timelines and budget.',
            probability: 3, impact: 4, severity: 'high',
            affectedTasks: [],
            mitigations: ['Pre-order long-lead materials', 'Identify alternative suppliers', 'Include material escalation clauses in contracts'],
          },
          {
            type: 'regulatory',
            title: 'Permit and Inspection Delay Risk',
            description: 'Permits or inspection approvals may take longer than anticipated, blocking subsequent construction phases.',
            probability: 3, impact: 3, severity: 'medium',
            affectedTasks: [],
            mitigations: ['Submit permit applications early', 'Maintain regular contact with authorities', 'Schedule inspections well in advance'],
          },
        );
        break;

      case 'infrastructure':
        risks.push(
          {
            type: 'regulatory',
            title: 'Environmental and Regulatory Compliance Risk',
            description: 'Environmental impact assessments, regulatory approvals, or multi-agency coordination may cause delays.',
            probability: 3, impact: 4, severity: 'high',
            affectedTasks: [],
            mitigations: ['Engage environmental consultants early', 'Track all regulatory milestones', 'Build approval lead times into schedule'],
          },
          {
            type: 'technical',
            title: 'Subsurface and Geotechnical Risk',
            description: 'Unexpected ground conditions, contamination, or utility conflicts may require design changes or additional work.',
            probability: 3, impact: 4, severity: 'high',
            affectedTasks: [],
            mitigations: ['Conduct thorough geotechnical surveys', 'Budget for subsurface contingency', 'Locate existing utilities before excavation'],
          },
          {
            type: 'stakeholder',
            title: 'Community and Stakeholder Opposition Risk',
            description: 'Public opposition or stakeholder objections may delay approvals or require project scope changes.',
            probability: 2, impact: 3, severity: 'medium',
            affectedTasks: [],
            mitigations: ['Hold public consultation sessions early', 'Publish transparent project communications', 'Address community concerns proactively'],
          },
        );
        break;

      case 'roads':
        risks.push(
          {
            type: 'weather',
            title: 'Weather and Seasonal Paving Window Risk',
            description: 'Paving, grading, and earthwork are weather-sensitive. Rain or freezing conditions may reduce the available construction window.',
            probability: 3, impact: 3, severity: 'medium',
            affectedTasks: [],
            mitigations: ['Schedule paving for optimal weather windows', 'Monitor forecasts and adjust daily plans', 'Build weather float into critical path'],
          },
          {
            type: 'dependency',
            title: 'Utility Relocation Risk',
            description: 'Underground utilities (gas, water, telecom) may need relocation, causing delays if not identified early.',
            probability: 3, impact: 4, severity: 'high',
            affectedTasks: [],
            mitigations: ['Commission utility locate surveys before construction', 'Coordinate with utility companies early', 'Build relocation lead time into schedule'],
          },
          {
            type: 'stakeholder',
            title: 'Traffic Management and Public Safety Risk',
            description: 'Maintaining traffic flow and public safety during construction may constrain work hours and methods.',
            probability: 3, impact: 3, severity: 'medium',
            affectedTasks: [],
            mitigations: ['Develop traffic management plan', 'Coordinate with local authorities', 'Schedule high-impact work during off-peak hours'],
          },
        );
        break;

      default:
        risks.push(
          {
            type: 'stakeholder',
            title: 'Stakeholder Alignment Risk',
            description: 'Misaligned expectations or unclear scope may lead to rework, scope changes, or stakeholder dissatisfaction.',
            probability: 3, impact: 3, severity: 'medium',
            affectedTasks: [],
            mitigations: ['Document and confirm scope with all stakeholders', 'Hold regular status meetings', 'Establish a formal change request process'],
          },
          {
            type: 'resource',
            title: 'Key Person Dependency Risk',
            description: 'Critical knowledge concentrated in one or two people creates a single point of failure if they become unavailable.',
            probability: 2, impact: 4, severity: 'medium',
            affectedTasks: [],
            mitigations: ['Cross-train team members on critical areas', 'Document key processes and decisions', 'Identify backup resources'],
          },
        );
        break;
    }

    return risks;
  }

  private buildFallbackWeatherImpact(
    weather: WeatherForecast,
    outdoorTasks: Array<{
      name: string;
      status: string;
      progressPercentage?: number;
    }>,
  ): AIWeatherImpact {
    const impactLevel = categorizeWeatherImpact(
      weather.current.conditionCode,
      weather.current.precipitation,
      weather.current.windSpeed,
    );

    // Estimate delay from forecast
    const badDays = weather.daily.filter((d) => {
      const dayImpact = categorizeWeatherImpact(
        d.conditionCode,
        d.precipitationAmount,
        d.windSpeed,
      );
      return dayImpact !== 'none' && dayImpact !== 'low';
    });
    const estimatedDelayDays =
      badDays.length > 0
        ? parseFloat((badDays.length * 0.5).toFixed(1))
        : 0;

    const affectedTasks = outdoorTasks.slice(0, 10).map((t) => ({
      taskName: t.name,
      reason: `Outdoor task may be affected by ${weather.current.condition.toLowerCase()}`,
      delayRisk:
        impactLevel === 'severe' || impactLevel === 'high'
          ? ('high' as const)
          : impactLevel === 'moderate'
            ? ('medium' as const)
            : ('low' as const),
    }));

    const weeklyOutlook = weather.daily.map((d) => {
      const dayImpact = categorizeWeatherImpact(
        d.conditionCode,
        d.precipitationAmount,
        d.windSpeed,
      );
      return {
        date: d.date,
        condition: d.condition,
        workable: dayImpact === 'none' || dayImpact === 'low',
        risk:
          dayImpact !== 'none'
            ? `${d.precipitationAmount}mm precipitation, ${d.windSpeed}km/h wind`
            : undefined,
      };
    });

    const recommendations: string[] = [];
    if (impactLevel !== 'none') {
      recommendations.push(
        'Monitor daily weather updates before dispatching outdoor crews',
      );
    }
    if (impactLevel === 'high' || impactLevel === 'severe') {
      recommendations.push(
        'Consider rescheduling outdoor tasks to dry days',
      );
      recommendations.push(
        'Ensure drainage and site protection measures are in place',
      );
    }
    if (recommendations.length === 0) {
      recommendations.push(
        'Weather conditions are favorable for outdoor work',
      );
    }

    return {
      currentCondition: weather.current.condition,
      impactLevel,
      estimatedDelayDays,
      affectedTasks,
      weeklyOutlook,
      recommendations,
    };
  }

  private buildNoWeatherImpact(): AIWeatherImpact {
    return {
      currentCondition: 'Data unavailable',
      impactLevel: 'none',
      estimatedDelayDays: 0,
      affectedTasks: [],
      weeklyOutlook: [],
      recommendations: [
        'Weather data is currently unavailable. Check back later.',
      ],
    };
  }

  private buildBudgetRecommendations(
    evm: ReturnType<typeof computeEVMMetrics>,
  ): string[] {
    const recs: string[] = [];
    if (evm.cpi < 0.9)
      recs.push(
        'Cost performance is below target. Review expenditures and identify cost-saving opportunities.',
      );
    if (evm.spi < 0.9)
      recs.push(
        'Schedule performance is behind. Consider resource reallocation or scope adjustment.',
      );
    if (evm.cpi >= 1.0 && evm.spi >= 1.0)
      recs.push(
        'Project is performing well on both cost and schedule. Continue current approach.',
      );
    if (evm.vac < 0)
      recs.push(
        `Projected budget overrun of $${Math.abs(evm.vac).toLocaleString()}. Plan for supplementary funding.`,
      );
    if (recs.length === 0)
      recs.push('Budget metrics are within acceptable ranges.');
    return recs;
  }

  private buildBudgetSummary(
    evm: ReturnType<typeof computeEVMMetrics>,
    budgetAllocated: number,
  ): string {
    const status = evm.cpi >= 1.0 ? 'under budget' : 'over budget';
    const scheduleStatus =
      evm.spi >= 1.0 ? 'ahead of schedule' : 'behind schedule';
    return `Project is ${status} (CPI: ${evm.cpi}) and ${scheduleStatus} (SPI: ${evm.spi}). Estimated at completion: $${evm.eac.toLocaleString()} vs. $${budgetAllocated.toLocaleString()} allocated.`;
  }

  private buildDashboardHighlights(
    criticalCount: number,
    highCount: number,
    overBudgetCount: number,
    activeCount: number,
  ): AIDashboardPredictions['highlights'] {
    const highlights: AIDashboardPredictions['highlights'] = [];
    if (criticalCount > 0) {
      highlights.push({
        text: `${criticalCount} project${criticalCount !== 1 ? 's' : ''} at critical risk`,
        type: 'risk',
      });
    }
    if (highCount > 0) {
      highlights.push({
        text: `${highCount} project${highCount !== 1 ? 's' : ''} at high risk`,
        type: 'risk',
      });
    }
    if (overBudgetCount > 0) {
      highlights.push({
        text: `${overBudgetCount} project${overBudgetCount !== 1 ? 's' : ''} near budget limit`,
        type: 'risk',
      });
    }
    if (activeCount > 0) {
      highlights.push({
        text: `${activeCount} active project${activeCount !== 1 ? 's' : ''}`,
        type: 'info',
      });
    }
    if (highlights.length === 0) {
      highlights.push({
        text: 'All projects within normal parameters',
        type: 'success',
      });
    }
    return highlights;
  }

  private storeRiskAssessment(
    projectId: string,
    assessment: AIRiskAssessment,
  ): void {
    const db = (this.fastify as any).mysql || (this.fastify as any).db;
    if (!db) return;

    // Fire-and-forget
    for (const risk of assessment.risks) {
      const id = crypto.randomUUID();
      db.query(
        `INSERT INTO ai_risk_assessments (id, project_id, risk_type, severity, probability, impact, description, mitigation_strategies, ai_confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          projectId,
          risk.type,
          risk.severity,
          risk.probability,
          risk.impact,
          risk.description,
          JSON.stringify(risk.mitigations),
          (risk.probability * risk.impact) / 25,
        ],
      ).catch((err: Error) => {
        this.fastify.log.warn(
          { err },
          'Failed to store risk assessment (non-critical)',
        );
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Task Slip Predictions — deterministic analysis of which tasks are likely to slip
  // ---------------------------------------------------------------------------

  async predictTaskSlips(projectId: string): Promise<{ data: any; aiPowered: boolean }> {
    const { scheduleService } = await import('./ScheduleService');
    const schedules = await scheduleService.findByProjectId(projectId);
    if (schedules.length === 0) return { data: { tasks: [], summary: 'No schedules found.' }, aiPowered: false };

    const now = new Date();
    const nowMs = now.getTime();
    const DAY_MS = 86_400_000;

    interface SlipTask {
      taskId: string;
      taskName: string;
      scheduleName: string;
      slipProbability: number;
      confidence: number;
      severity: 'low' | 'medium' | 'high' | 'critical';
      reasons: string[];
      suggestedAction?: string;
      currentProgress: number;
      expectedProgress: number;
      daysOverdue: number;
    }

    const slipTasks: SlipTask[] = [];

    const allBatchedTasks = await scheduleService.findTasksByScheduleIds(schedules.map(s => s.id));
    const schedNameMap = new Map(schedules.map(s => [s.id, s.name]));
    const taskMap = new Map(allBatchedTasks.map((t: any) => [t.id, t]));

    for (const sched of schedules) {
      const tasks = allBatchedTasks.filter(t => t.scheduleId === sched.id);

      for (const task of tasks) {
        if (task.status === 'completed' || task.status === 'cancelled') continue;
        if (!task.startDate || !task.endDate) continue;

        const startMs = new Date(task.startDate).getTime();
        const endMs = new Date(task.endDate).getTime();
        const durationDays = Math.max(1, Math.round((endMs - startMs) / DAY_MS));
        const elapsed = Math.max(0, (nowMs - startMs) / DAY_MS);
        const progress = task.progressPercentage ?? 0;
        const expectedProgress = Math.min(100, Math.round((elapsed / durationDays) * 100));
        const daysOverdue = Math.max(0, Math.round((nowMs - endMs) / DAY_MS));

        const reasons: string[] = [];
        let score = 0;

        // Factor 1: Overdue (40% weight)
        if (daysOverdue > 0) {
          const overdueFactor = Math.min(1, daysOverdue / Math.max(durationDays, 1));
          score += overdueFactor * 40;
          reasons.push(`${daysOverdue} day${daysOverdue > 1 ? 's' : ''} overdue`);
        }

        // Factor 2: Progress gap (30% weight)
        const progressGap = Math.max(0, expectedProgress - progress);
        if (progressGap > 10) {
          score += Math.min(1, progressGap / 50) * 30;
          reasons.push(`Progress ${progress}% vs expected ${expectedProgress}%`);
        }

        // Factor 3: Incomplete predecessors (20% weight)
        const deps = task.dependencies.map(d => d.dependencyId);
        if (deps.length > 0) {
          const incompleteDeps = deps.filter((did: string) => {
            const dep = taskMap.get(did);
            return dep && dep.status !== 'completed';
          });
          if (incompleteDeps.length > 0) {
            score += (incompleteDeps.length / deps.length) * 20;
            reasons.push(`${incompleteDeps.length}/${deps.length} predecessor${deps.length > 1 ? 's' : ''} incomplete`);
          }
        }

        // Factor 4: Long duration (10% weight)
        if (durationDays > 20) {
          score += Math.min(1, durationDays / 60) * 10;
          reasons.push(`Long duration task (${durationDays} days)`);
        }

        if (score < 10 && reasons.length === 0) continue;

        const slipProbability = Math.min(100, Math.round(score));
        const severity: 'low' | 'medium' | 'high' | 'critical' =
          slipProbability >= 80 ? 'critical' : slipProbability >= 60 ? 'high' : slipProbability >= 30 ? 'medium' : 'low';

        let suggestedAction: string | undefined;
        if (daysOverdue > 0) suggestedAction = 'Review blockers and consider rescheduling or adding resources';
        else if (progressGap > 30) suggestedAction = 'Escalate — significant progress gap detected';
        else if (reasons.some(r => r.includes('predecessor'))) suggestedAction = 'Unblock predecessors to prevent cascade delay';

        slipTasks.push({
          taskId: task.id,
          taskName: task.name,
          scheduleName: sched.name,
          slipProbability,
          confidence: Math.min(95, 50 + slipProbability * 0.4),
          severity,
          reasons,
          suggestedAction,
          currentProgress: progress,
          expectedProgress,
          daysOverdue,
        });
      }
    }

    slipTasks.sort((a, b) => b.slipProbability - a.slipProbability);
    const top = slipTasks.slice(0, 20);
    const atRisk = top.filter(t => t.slipProbability >= 30).length;

    return {
      data: {
        tasks: top,
        summary: atRisk > 0
          ? `${atRisk} task${atRisk > 1 ? 's' : ''} at risk of slipping`
          : 'No tasks currently at risk of slipping',
      },
      aiPowered: false,
    };
  }
}
