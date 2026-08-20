import { z } from 'zod';

// ---------------------------------------------------------------------------
// AI Response Schema — what Claude returns for EVM forecasting
// ---------------------------------------------------------------------------

export const EVMForecastWeeklyPredictionSchema = z.object({
  week: z.number(),
  value: z.number(),
});

export const EVMCorrectiveActionSchema = z.object({
  action: z.string(),
  effort: z.enum(['low', 'medium', 'high']),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  estimatedImpact: z.string(),
});

const WeeklyPredictionOrNumber = z.union([
  EVMForecastWeeklyPredictionSchema,
  z.number().transform((v) => ({ week: 0, value: v })),
]);

export const EVMForecastAIResponseSchema = z.object({
  predictedCPI: z.array(WeeklyPredictionOrNumber),
  predictedSPI: z.array(WeeklyPredictionOrNumber),
  aiAdjustedEAC: z.number(),
  eacConfidenceRange: z.object({
    low: z.number(),
    high: z.number(),
  }),
  trendDirection: z.enum(['improving', 'stable', 'deteriorating']),
  overrunProbability: z.number().min(0).max(100),
  correctiveActions: z.array(EVMCorrectiveActionSchema),
  narrativeSummary: z.string(),
});

export type EVMForecastAIResponse = z.infer<typeof EVMForecastAIResponseSchema>;

// ---------------------------------------------------------------------------
// Full Forecast Result Schema — returned to the client
// ---------------------------------------------------------------------------

export const EVMCurrentMetricsSchema = z.object({
  BAC: z.number(),
  EV: z.number(),
  AC: z.number(),
  PV: z.number(),
  CPI: z.number(),
  SPI: z.number(),
  EAC: z.number(),
  ETC: z.number(),
  VAC: z.number(),
  TCPI: z.number(),
});

export const EVMHistoricalWeekSchema = z.object({
  date: z.string(),
  cpi: z.number(),
  spi: z.number(),
});

export const EVMEarlyWarningSchema = z.object({
  type: z.string(),
  message: z.string(),
  severity: z.enum(['info', 'warning', 'critical']),
});

export const EVMForecastComparisonSchema = z.object({
  method: z.string(),
  eacValue: z.number(),
  varianceFromBAC: z.number(),
});

export const SCurveDataPointSchema = z.object({
  date: z.string(),
  pv: z.number(),
  ev: z.number(),
  ac: z.number(),
});

export const SprintContextSchema = z.object({
  activeSprintId: z.string().optional(),
  avgVelocity: z.number(),
  totalBacklogPoints: z.number(),
  completedPoints: z.number(),
  sprintCount: z.number(),
});

export const EVMForecastResultSchema = z.object({
  currentMetrics: EVMCurrentMetricsSchema,
  historicalTrends: z.object({
    weeklyData: z.array(EVMHistoricalWeekSchema),
  }),
  earlyWarnings: z.array(EVMEarlyWarningSchema),
  traditionalForecasts: z.object({
    eacCumulative: z.number(),
    eacComposite: z.number(),
    eacManagement: z.number(),
  }),
  aiPredictions: EVMForecastAIResponseSchema.optional(),
  forecastComparison: z.array(EVMForecastComparisonSchema),
  sCurveData: z.array(SCurveDataPointSchema).optional(),
  methodology: z.enum(['waterfall', 'agile', 'hybrid']).optional(),
  sprintContext: SprintContextSchema.optional(),
});

export type EVMForecastResult = z.infer<typeof EVMForecastResultSchema>;
export type EVMCurrentMetrics = z.infer<typeof EVMCurrentMetricsSchema>;
export type EVMEarlyWarning = z.infer<typeof EVMEarlyWarningSchema>;
export type EVMForecastComparison = z.infer<typeof EVMForecastComparisonSchema>;
