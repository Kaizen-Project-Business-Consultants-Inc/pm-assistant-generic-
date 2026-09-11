import { storageConnectorRepository } from '../../database/StorageConnectorRepository';
import { storageConnectorService } from '../StorageConnectorService';
import logger from '../../utils/logger';

const MAX_CONCURRENT_SYNCS = 2;

export async function runStorageSync(): Promise<void> {
  let connectors;
  try {
    connectors = await storageConnectorRepository.findDueForSync();
  } catch {
    // Table may not exist yet
    return;
  }

  if (connectors.length === 0) return;

  logger.info(`[cron:storage-sync] Found ${connectors.length} connector(s) due for sync`);

  // Process with bounded concurrency
  for (let i = 0; i < connectors.length; i += MAX_CONCURRENT_SYNCS) {
    const batch = connectors.slice(i, i + MAX_CONCURRENT_SYNCS);
    await Promise.allSettled(
      batch.map(async (connector) => {
        const start = Date.now();
        try {
          const result = await storageConnectorService.syncConnector(connector.id);
          logger.info(`[cron:storage-sync] Connector ${connector.id} synced`, {
            connectorId: connector.id,
            durationMs: Date.now() - start,
            ...result,
          });
        } catch (err: any) {
          logger.error(`[cron:storage-sync] Connector ${connector.id} FAILED`, {
            connectorId: connector.id,
            durationMs: Date.now() - start,
            error: err.message,
          });
        }
      }),
    );
  }
}
