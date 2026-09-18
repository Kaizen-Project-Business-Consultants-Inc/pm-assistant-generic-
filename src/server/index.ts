import 'dotenv/config';
import Fastify from 'fastify';
import { config, logConfigSummary } from './config';
import { registerPlugins } from './plugins';
import { registerRoutes } from './routes';
import { databaseService } from './database/connection';
import { runMigrations } from './database/migrationRunner';
import { setDegraded } from './utils/degradedState';
import { runAllTenantMigrations } from './database/tenantMigrationRunner';
import './services/agentCapabilities';
import { redisService } from './services/RedisService';
import { metricsService } from './services/MetricsService';
import { emailService } from './services/EmailService';
import { serviceContainer } from './container';

const fastify = Fastify({
  logger: {
    level: config.NODE_ENV === 'production' ? 'info' : 'debug'
  },
  trustProxy: true
});

async function start() {
  try {
    fastify.log.info('Initializing Kovarti PM Assistant...');
    logConfigSummary();

    fastify.log.info('Testing database connection...');
    const isConnected = await databaseService.testConnection();
    if (!isConnected) {
      fastify.log.warn('Database connection failed - running in offline mode');
    } else {
      fastify.log.info('Database connection successful');

      // A failed migration used to be fatal, which turned one stale bookkeeping row
      // into a crash loop: on 2026-09-18 the production API was down for six minutes
      // across 58 restarts because a migration's columns already existed. A crash loop
      // is strictly worse than starting — it takes every feature down instead of the
      // ones touching the missing change, and it tells nobody why. Start, record the
      // state, and shout.
      const migrationOutcome = await runMigrations();
      if (migrationOutcome.failed) {
        setDegraded({
          reason: 'migration_failed',
          detail: `Migration ${migrationOutcome.failed.file} failed: ${migrationOutcome.failed.error}. ` +
            `${migrationOutcome.skipped.length} later migration(s) were not attempted. ` +
            `The database schema may not match this build.`,
        });
        fastify.log.error(
          { migration: migrationOutcome.failed, skipped: migrationOutcome.skipped },
          'MIGRATION FAILED — starting in DEGRADED mode. Schema may not match this build.',
        );
      }

      // Run pending tenant migrations if multi-tenant is enabled
      if (config.MULTI_TENANT_ENABLED) {
        fastify.log.info('Running tenant migrations...');
        await runAllTenantMigrations();
      }
    }

    // Connect to Redis (optional — graceful degradation if unavailable)
    if (config.REDIS_URL) {
      fastify.log.info('Connecting to Redis...');
      redisService.connect(config.REDIS_URL);
      // Load persisted metrics from Redis
      await metricsService.loadFromRedis();
    }

    // Verify external service connections
    await emailService.verifyConnection();

    // Register service container for DI
    fastify.decorate('services', serviceContainer);

    await registerPlugins(fastify);
    await registerRoutes(fastify);

    await fastify.listen({
      port: config.PORT,
      host: config.HOST
    });

    fastify.log.info(`Kovarti PM Assistant running on http://${config.HOST}:${config.PORT}`);
    fastify.log.info('Cron jobs managed externally via systemd timers');

    // Start Redis metrics sync if connected
    if (redisService.isConnected()) {
      metricsService.startRedisSync();
    }

  } catch (err) {
    fastify.log.error(err, 'Failed to start server');
    process.exit(1);
  }
}

// Crash-safety: log and exit on uncaught errors
process.on('uncaughtException', (err) => {
  process.stderr.write(`UNCAUGHT EXCEPTION — shutting down: ${err?.stack || err}\n`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  process.stderr.write(`UNHANDLED REJECTION — shutting down: ${reason}\n`);
  process.exit(1);
});

async function gracefulShutdown(signal: string) {
  fastify.log.info(`${signal} received — shutting down server...`);
  // Force exit after 30s if graceful shutdown hangs (e.g. long AI call)
  const forceTimer = setTimeout(() => {
    fastify.log.error('Graceful shutdown timed out after 30s — forcing exit');
    process.exit(1);
  }, 30_000);
  forceTimer.unref();

  metricsService.stopRedisSync();
  await fastify.close();
  await redisService.disconnect();
  await databaseService.close();
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

start();
