import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().min(1000).max(65535).default(3001),
  HOST: z.string().min(1).default('0.0.0.0'),

  DB_HOST: z.string().min(1).default('localhost'),
  DB_PORT: z.coerce.number().min(1).max(65535).default(3306),
  DB_USER: z.string().min(1).default('root'),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().min(1).default('pm_assistant_generic'),
  DB_CONNECTION_LIMIT: z.coerce.number().min(1).max(50).default(5),
  DB_MAX_IDLE: z.coerce.number().min(0).max(50).default(2),
  DB_CONNECT_TIMEOUT: z.coerce.number().min(1000).max(30000).default(5000),
  DB_IDLE_TIMEOUT: z.coerce.number().min(5000).max(300000).default(60000),
  DB_QUEUE_LIMIT: z.coerce.number().min(0).max(500).default(50),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET must be at least 32 characters'),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']).default('debug'),

  // AI Configuration
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  AI_MODEL: z.string().default('claude-sonnet-4-5-20250929'),
  AI_TEMPERATURE: z.coerce.number().min(0).max(1).default(0.3),
  AI_MAX_TOKENS: z.coerce.number().min(100).max(8192).default(4096),
  AI_ENABLED: z.preprocess((val) => val === 'true' || val === '1' || val === true, z.boolean().default(false)),
  AI_FALLBACK_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  AI_FALLBACK_ENABLED: z.preprocess((val) => val === 'true' || val === '1' || val === true, z.boolean().default(false)),

  // Email Configuration (Resend)
  RESEND_API_KEY: z.string().optional().default(''),
  RESEND_FROM_EMAIL: z.string().default('noreply@kpbc.ca'),
  APP_URL: z.string().default('http://localhost:5173'),

  // Stripe Configuration
  STRIPE_SECRET_KEY: z.string().optional().default(''),
  STRIPE_PUBLISHABLE_KEY: z.string().optional().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(''),
  STRIPE_PRO_PRICE_ID: z.string().optional().default(''),
  STRIPE_MONTHLY_PRICE_ID: z.string().optional().default(''),
  STRIPE_ANNUAL_PRICE_ID: z.string().optional().default(''),
  STRIPE_PRO_MONTHLY_PRICE_ID: z.string().optional().default(''),
  STRIPE_PRO_ANNUAL_PRICE_ID: z.string().optional().default(''),
  STRIPE_BUSINESS_MONTHLY_PRICE_ID: z.string().optional().default(''),
  STRIPE_BUSINESS_ANNUAL_PRICE_ID: z.string().optional().default(''),
  STRIPE_CONSULTANT_MONTHLY_PRICE_ID: z.string().optional().default(''),
  STRIPE_CONSULTANT_ANNUAL_PRICE_ID: z.string().optional().default(''),
  STRIPE_TOPUP_PRICE_ID: z.string().optional().default(''),
  STRIPE_LAUNCH_COUPON_ID: z.string().optional().default(''),

  // Launch Offer
  LAUNCH_OFFER_ENABLED: z.preprocess((val) => val === 'true' || val === '1' || val === true, z.boolean().default(false)),

  // Weather Configuration
  WEATHER_API_PROVIDER: z.enum(['openweathermap', 'weatherapi', 'accuweather', 'mock']).default('mock'),
  WEATHER_API_KEY: z.string().optional().default(''),
  WEATHER_CACHE_MINUTES: z.coerce.number().min(1).max(1440).default(30),

  // Agent Configuration
  AGENT_ENABLED: z.preprocess((val) => val === 'true' || val === '1' || val === true, z.boolean().default(false)),
  AGENT_CRON_SCHEDULE: z.string().default('0 2 * * *'),
  AGENT_DELAY_THRESHOLD_DAYS: z.coerce.number().min(1).default(3),
  AGENT_BUDGET_CPI_THRESHOLD: z.coerce.number().min(0).max(2).default(0.9),
  AGENT_BUDGET_OVERRUN_THRESHOLD: z.coerce.number().min(0).max(100).default(50),
  AGENT_MC_CONFIDENCE_LEVEL: z.coerce.number().min(1).max(99).default(80),
  AGENT_OVERDUE_SCAN_MINUTES: z.coerce.number().min(1).max(1440).default(15),

  // Embedding / RAG Configuration
  OPENAI_API_KEY: z.string().optional().default(''),
  EMBEDDING_ENABLED: z.preprocess((val) => val === 'true' || val === '1' || val === true, z.boolean().default(false)),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  EMBEDDING_DIMENSIONS: z.coerce.number().min(256).max(3072).default(1536),
  RAG_TOP_K: z.coerce.number().min(1).max(50).default(5),
  RAG_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.3),

  // AI Budget & Pricing (per million tokens for the configured AI_MODEL)
  AI_MONTHLY_TOKEN_BUDGET: z.coerce.number().min(0).default(500000),
  AI_PRICING_INPUT: z.coerce.number().min(0).default(3.0),
  AI_PRICING_OUTPUT: z.coerce.number().min(0).default(15.0),

  // Per-tier AI budget defaults (tokens/month)
  AI_TIER_BUDGET_TRIAL: z.coerce.number().min(0).default(25000),
  AI_TIER_BUDGET_CONSULTANT_BASIC: z.coerce.number().min(0).default(25000),
  AI_TIER_BUDGET_CONSULTANT_PRO: z.coerce.number().min(0).default(500000),
  AI_TIER_BUDGET_SME: z.coerce.number().min(0).default(1500000),
  AI_TIER_BUDGET_ENTERPRISE: z.coerce.number().min(0).default(5000000),
  AI_TIER_BUDGET_SME_PER_SEAT: z.coerce.number().min(0).default(500000),

  // New Stripe price IDs for restructured tiers
  STRIPE_CONSULTANT_BASIC_MONTHLY_PRICE_ID: z.string().optional().default(''),
  STRIPE_CONSULTANT_BASIC_ANNUAL_PRICE_ID: z.string().optional().default(''),
  STRIPE_CONSULTANT_PRO_MONTHLY_PRICE_ID: z.string().optional().default(''),
  STRIPE_CONSULTANT_PRO_ANNUAL_PRICE_ID: z.string().optional().default(''),
  // Legacy (kept for backward compat with existing subscribers)
  STRIPE_CONSULTANT_NEW_MONTHLY_PRICE_ID: z.string().optional().default(''),
  STRIPE_CONSULTANT_NEW_ANNUAL_PRICE_ID: z.string().optional().default(''),
  STRIPE_SME_MONTHLY_PRICE_ID: z.string().optional().default(''),
  STRIPE_SME_ANNUAL_PRICE_ID: z.string().optional().default(''),
  STRIPE_SME_SEAT_MONTHLY_PRICE_ID: z.string().optional().default(''),
  STRIPE_SME_SEAT_ANNUAL_PRICE_ID: z.string().optional().default(''),
  STRIPE_ENTERPRISE_MONTHLY_PRICE_ID: z.string().optional().default(''),
  STRIPE_ENTERPRISE_ANNUAL_PRICE_ID: z.string().optional().default(''),

  // Token top-up pricing
  AI_TOPUP_TOKENS: z.coerce.number().min(0).default(500000),
  AI_TOPUP_PRICE_CENTS: z.coerce.number().min(0).default(500),

  // Metrics
  METRICS_ENABLED: z.preprocess((val) => val === 'true' || val === '1' || val === true || val === undefined, z.boolean().default(true)),
  REDIS_URL: z.string().optional().default(''),

  // Alerting Configuration
  ALERT_ENABLED: z.preprocess((val) => val === 'true' || val === '1' || val === true, z.boolean().default(false)),
  ALERT_EMAIL: z.string().optional().default(''),
  ALERT_WEBHOOK_URL: z.string().optional().default(''),
  ALERT_COOLDOWN_MINUTES: z.coerce.number().min(1).max(1440).default(30),

  // Multi-Tenant Configuration
  MULTI_TENANT_ENABLED: z.preprocess((val) => val === 'true' || val === '1' || val === true, z.boolean().default(false)),

  // Slack Configuration
  SLACK_SIGNING_SECRET: z.string().optional().default(''),
  SLACK_BOT_TOKEN: z.string().optional().default(''),

  // File Upload Configuration
  UPLOAD_DIR: z.string().default(process.env['HOME'] || process.env['USERPROFILE'] ? `${process.env['HOME'] || process.env['USERPROFILE']}/uploads/pm-assistant` : './uploads/pm-assistant'),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().min(1).max(100).default(10),
}).refine((data) => {
  if (data.JWT_SECRET === data.JWT_REFRESH_SECRET) {
    throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be different');
  }
  if (data.JWT_SECRET === data.COOKIE_SECRET) {
    throw new Error('JWT_SECRET and COOKIE_SECRET must be different');
  }
  if (data.JWT_REFRESH_SECRET === data.COOKIE_SECRET) {
    throw new Error('JWT_REFRESH_SECRET and COOKIE_SECRET must be different');
  }
  // Entropy check: reject secrets that are too short or trivial
  const secrets = [
    { name: 'JWT_SECRET', value: data.JWT_SECRET },
    { name: 'JWT_REFRESH_SECRET', value: data.JWT_REFRESH_SECRET },
    { name: 'COOKIE_SECRET', value: data.COOKIE_SECRET },
  ];
  for (const { name, value } of secrets) {
    if (value.length < 32) {
      throw new Error(`${name} is too short (${value.length} chars). Use at least 32 characters.`);
    }
    const uniqueChars = new Set(value).size;
    if (uniqueChars < 12) {
      throw new Error(`${name} has insufficient entropy (only ${uniqueChars} unique characters). Use a strong random secret.`);
    }
  }
  return true;
}, { message: 'Security secrets must be unique' });

export function validateConfiguration() {
  try {
    const rawConfig = {
      NODE_ENV: process.env['NODE_ENV'],
      PORT: process.env['PORT'],
      HOST: process.env['HOST'],
      DB_HOST: process.env['DB_HOST'],
      DB_PORT: process.env['DB_PORT'],
      DB_USER: process.env['DB_USER'],
      DB_PASSWORD: process.env['DB_PASSWORD'],
      DB_NAME: process.env['DB_NAME'],
      DB_CONNECTION_LIMIT: process.env['DB_CONNECTION_LIMIT'],
      DB_MAX_IDLE: process.env['DB_MAX_IDLE'],
      DB_CONNECT_TIMEOUT: process.env['DB_CONNECT_TIMEOUT'],
      DB_IDLE_TIMEOUT: process.env['DB_IDLE_TIMEOUT'],
      DB_QUEUE_LIMIT: process.env['DB_QUEUE_LIMIT'],
      JWT_SECRET: process.env['JWT_SECRET'],
      JWT_REFRESH_SECRET: process.env['JWT_REFRESH_SECRET'],
      COOKIE_SECRET: process.env['COOKIE_SECRET'],
      CORS_ORIGIN: process.env['CORS_ORIGIN'],
      LOG_LEVEL: process.env['LOG_LEVEL'],
      ANTHROPIC_API_KEY: process.env['ANTHROPIC_API_KEY'],
      AI_MODEL: process.env['AI_MODEL'],
      AI_TEMPERATURE: process.env['AI_TEMPERATURE'],
      AI_MAX_TOKENS: process.env['AI_MAX_TOKENS'],
      AI_ENABLED: process.env['AI_ENABLED'],
      AI_FALLBACK_MODEL: process.env['AI_FALLBACK_MODEL'],
      AI_FALLBACK_ENABLED: process.env['AI_FALLBACK_ENABLED'],
      RESEND_API_KEY: process.env['RESEND_API_KEY'],
      RESEND_FROM_EMAIL: process.env['RESEND_FROM_EMAIL'],
      APP_URL: process.env['APP_URL'],
      STRIPE_SECRET_KEY: process.env['STRIPE_SECRET_KEY'],
      STRIPE_PUBLISHABLE_KEY: process.env['STRIPE_PUBLISHABLE_KEY'],
      STRIPE_WEBHOOK_SECRET: process.env['STRIPE_WEBHOOK_SECRET'],
      STRIPE_PRO_PRICE_ID: process.env['STRIPE_PRO_PRICE_ID'],
      STRIPE_MONTHLY_PRICE_ID: process.env['STRIPE_MONTHLY_PRICE_ID'],
      STRIPE_ANNUAL_PRICE_ID: process.env['STRIPE_ANNUAL_PRICE_ID'],
      STRIPE_PRO_MONTHLY_PRICE_ID: process.env['STRIPE_PRO_MONTHLY_PRICE_ID'],
      STRIPE_PRO_ANNUAL_PRICE_ID: process.env['STRIPE_PRO_ANNUAL_PRICE_ID'],
      STRIPE_BUSINESS_MONTHLY_PRICE_ID: process.env['STRIPE_BUSINESS_MONTHLY_PRICE_ID'],
      STRIPE_BUSINESS_ANNUAL_PRICE_ID: process.env['STRIPE_BUSINESS_ANNUAL_PRICE_ID'],
      STRIPE_CONSULTANT_MONTHLY_PRICE_ID: process.env['STRIPE_CONSULTANT_MONTHLY_PRICE_ID'],
      STRIPE_CONSULTANT_ANNUAL_PRICE_ID: process.env['STRIPE_CONSULTANT_ANNUAL_PRICE_ID'],
      STRIPE_TOPUP_PRICE_ID: process.env['STRIPE_TOPUP_PRICE_ID'],
      STRIPE_LAUNCH_COUPON_ID: process.env['STRIPE_LAUNCH_COUPON_ID'],
      LAUNCH_OFFER_ENABLED: process.env['LAUNCH_OFFER_ENABLED'],
      WEATHER_API_PROVIDER: process.env['WEATHER_API_PROVIDER'],
      WEATHER_API_KEY: process.env['WEATHER_API_KEY'],
      WEATHER_CACHE_MINUTES: process.env['WEATHER_CACHE_MINUTES'],
      AGENT_ENABLED: process.env['AGENT_ENABLED'],
      AGENT_CRON_SCHEDULE: process.env['AGENT_CRON_SCHEDULE'],
      AGENT_DELAY_THRESHOLD_DAYS: process.env['AGENT_DELAY_THRESHOLD_DAYS'],
      AGENT_BUDGET_CPI_THRESHOLD: process.env['AGENT_BUDGET_CPI_THRESHOLD'],
      AGENT_BUDGET_OVERRUN_THRESHOLD: process.env['AGENT_BUDGET_OVERRUN_THRESHOLD'],
      AGENT_MC_CONFIDENCE_LEVEL: process.env['AGENT_MC_CONFIDENCE_LEVEL'],
      AGENT_OVERDUE_SCAN_MINUTES: process.env['AGENT_OVERDUE_SCAN_MINUTES'],
      OPENAI_API_KEY: process.env['OPENAI_API_KEY'],
      EMBEDDING_ENABLED: process.env['EMBEDDING_ENABLED'],
      EMBEDDING_MODEL: process.env['EMBEDDING_MODEL'],
      EMBEDDING_DIMENSIONS: process.env['EMBEDDING_DIMENSIONS'],
      RAG_TOP_K: process.env['RAG_TOP_K'],
      RAG_SIMILARITY_THRESHOLD: process.env['RAG_SIMILARITY_THRESHOLD'],
      AI_MONTHLY_TOKEN_BUDGET: process.env['AI_MONTHLY_TOKEN_BUDGET'],
      AI_TIER_BUDGET_TRIAL: process.env['AI_TIER_BUDGET_TRIAL'],
      AI_TIER_BUDGET_CONSULTANT_BASIC: process.env['AI_TIER_BUDGET_CONSULTANT_BASIC'],
      AI_TIER_BUDGET_CONSULTANT_PRO: process.env['AI_TIER_BUDGET_CONSULTANT_PRO'],
      AI_TIER_BUDGET_SME: process.env['AI_TIER_BUDGET_SME'],
      AI_TIER_BUDGET_ENTERPRISE: process.env['AI_TIER_BUDGET_ENTERPRISE'],
      AI_TIER_BUDGET_SME_PER_SEAT: process.env['AI_TIER_BUDGET_SME_PER_SEAT'],
      STRIPE_CONSULTANT_BASIC_MONTHLY_PRICE_ID: process.env['STRIPE_CONSULTANT_BASIC_MONTHLY_PRICE_ID'],
      STRIPE_CONSULTANT_BASIC_ANNUAL_PRICE_ID: process.env['STRIPE_CONSULTANT_BASIC_ANNUAL_PRICE_ID'],
      STRIPE_CONSULTANT_PRO_MONTHLY_PRICE_ID: process.env['STRIPE_CONSULTANT_PRO_MONTHLY_PRICE_ID'],
      STRIPE_CONSULTANT_PRO_ANNUAL_PRICE_ID: process.env['STRIPE_CONSULTANT_PRO_ANNUAL_PRICE_ID'],
      STRIPE_CONSULTANT_NEW_MONTHLY_PRICE_ID: process.env['STRIPE_CONSULTANT_NEW_MONTHLY_PRICE_ID'],
      STRIPE_CONSULTANT_NEW_ANNUAL_PRICE_ID: process.env['STRIPE_CONSULTANT_NEW_ANNUAL_PRICE_ID'],
      STRIPE_SME_MONTHLY_PRICE_ID: process.env['STRIPE_SME_MONTHLY_PRICE_ID'],
      STRIPE_SME_ANNUAL_PRICE_ID: process.env['STRIPE_SME_ANNUAL_PRICE_ID'],
      STRIPE_SME_SEAT_MONTHLY_PRICE_ID: process.env['STRIPE_SME_SEAT_MONTHLY_PRICE_ID'],
      STRIPE_SME_SEAT_ANNUAL_PRICE_ID: process.env['STRIPE_SME_SEAT_ANNUAL_PRICE_ID'],
      STRIPE_ENTERPRISE_MONTHLY_PRICE_ID: process.env['STRIPE_ENTERPRISE_MONTHLY_PRICE_ID'],
      STRIPE_ENTERPRISE_ANNUAL_PRICE_ID: process.env['STRIPE_ENTERPRISE_ANNUAL_PRICE_ID'],
      AI_TOPUP_TOKENS: process.env['AI_TOPUP_TOKENS'],
      AI_TOPUP_PRICE_CENTS: process.env['AI_TOPUP_PRICE_CENTS'],
      METRICS_ENABLED: process.env['METRICS_ENABLED'],
      REDIS_URL: process.env['REDIS_URL'],
      ALERT_ENABLED: process.env['ALERT_ENABLED'],
      ALERT_EMAIL: process.env['ALERT_EMAIL'],
      ALERT_WEBHOOK_URL: process.env['ALERT_WEBHOOK_URL'],
      ALERT_COOLDOWN_MINUTES: process.env['ALERT_COOLDOWN_MINUTES'],
      MULTI_TENANT_ENABLED: process.env['MULTI_TENANT_ENABLED'],
      SLACK_SIGNING_SECRET: process.env['SLACK_SIGNING_SECRET'],
      SLACK_BOT_TOKEN: process.env['SLACK_BOT_TOKEN'],
      UPLOAD_DIR: process.env['UPLOAD_DIR'],
      MAX_UPLOAD_SIZE_MB: process.env['MAX_UPLOAD_SIZE_MB'],
    };

    // Logger not yet available during bootstrap — use process.stderr
    process.stderr.write('[config] Validating configuration...\n');

    const requiredVars = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'COOKIE_SECRET', 'DB_PASSWORD'];
    const missingVars = requiredVars.filter(varName => !process.env[varName]);

    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }

    const validatedConfig = configSchema.parse(rawConfig);
    process.stderr.write('[config] Configuration validation successful\n');
    return validatedConfig;
  } catch (error) {
    process.stderr.write('[config] Configuration validation failed:\n');

    if (error instanceof z.ZodError) {
      error.issues.forEach((issue: z.ZodIssue, index: number) => {
        const path = issue.path.length ? issue.path.join('.') : '(root)';
        process.stderr.write(`  ${index + 1}. ${path}: ${issue.message}\n`);
      });
    } else {
      process.stderr.write(`  ${error instanceof Error ? error.message : 'Unknown error'}\n`);
    }

    throw new Error('Configuration validation failed');
  }
}

export const config = validateConfiguration();

const TIER_BUDGET_MAP: Record<string, keyof typeof config> = {
  trial: 'AI_TIER_BUDGET_TRIAL',
  consultant_basic: 'AI_TIER_BUDGET_CONSULTANT_BASIC',
  consultant_pro: 'AI_TIER_BUDGET_CONSULTANT_PRO',
  sme: 'AI_TIER_BUDGET_SME',
  enterprise: 'AI_TIER_BUDGET_ENTERPRISE',
};

export function getTierBudget(tier: string): number {
  const key = TIER_BUDGET_MAP[tier];
  if (key) return config[key] as number;
  return config.AI_MONTHLY_TOKEN_BUDGET;
}

export function logConfigSummary(): void {
  const features: string[] = [];
  const warnings: string[] = [];

  features.push(`AI: ${config.AI_ENABLED ? 'ON' : 'OFF'}`);
  features.push(`Agents: ${config.AGENT_ENABLED ? 'ON' : 'OFF'}`);
  features.push(`Embeddings: ${config.EMBEDDING_ENABLED ? 'ON' : 'OFF'}`);
  features.push(`Multi-tenant: ${config.MULTI_TENANT_ENABLED ? 'ON' : 'OFF'}`);
  features.push(`Metrics: ${config.METRICS_ENABLED ? 'ON' : 'OFF'}`);
  features.push(`Alerts: ${config.ALERT_ENABLED ? 'ON' : 'OFF'}`);
  features.push(`AI Fallback: ${config.AI_FALLBACK_ENABLED ? 'ON' : 'OFF'}`);

  if (!config.REDIS_URL) warnings.push('REDIS_URL not set — using in-memory fallback for rate limiting and caching');
  if (!config.RESEND_API_KEY) warnings.push('RESEND_API_KEY not set — transactional emails disabled');
  if (!config.ANTHROPIC_API_KEY && config.AI_ENABLED) warnings.push('AI_ENABLED=true but ANTHROPIC_API_KEY is empty');
  if (config.ALERT_ENABLED && !config.ALERT_EMAIL && !config.ALERT_WEBHOOK_URL) {
    warnings.push('ALERT_ENABLED=true but no ALERT_EMAIL or ALERT_WEBHOOK_URL configured');
  }
  if (!config.STRIPE_SECRET_KEY) warnings.push('STRIPE_SECRET_KEY not set — billing disabled');

  process.stderr.write(`[config] Environment: ${config.NODE_ENV} | Port: ${config.PORT}\n`);
  process.stderr.write(`[config] Features: ${features.join(', ')}\n`);
  for (const w of warnings) {
    process.stderr.write(`[config] WARNING: ${w}\n`);
  }
}
