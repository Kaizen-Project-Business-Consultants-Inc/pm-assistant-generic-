import { organizationRepository } from '../database/OrganizationRepository';
import { portalRepository } from '../database/PortalRepository';
import { config } from '../config';
import logger from './logger';

export interface ClientReportContext {
  /** The consultancy sending the report, so the client sees a name they know. */
  senderName?: string;
  /** A link the client can open without an account, if the project has one. */
  portalUrl?: string;
}

/**
 * What a report needs to know before it leaves for someone outside the product.
 *
 * On the consultant tiers the client never logs in — they receive information.
 * So a report addressed to them can only carry a link that works without an
 * account, and should say who it is from: the consultancy, not just the tool.
 *
 * Nothing here is essential to the report itself, so every failure is swallowed
 * and the report still goes out. A missing sender name is a smaller problem
 * than an unsent status report.
 */
export async function clientReportContext(
  projectId: string,
  userId?: string,
): Promise<ClientReportContext> {
  const context: ClientReportContext = {};

  if (userId) {
    try {
      const org = await organizationRepository.findByUserId(userId);
      if (org?.name) context.senderName = org.name;
    } catch (err) {
      logger.warn('clientReportContext: could not resolve the sending organisation', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  try {
    const links = await portalRepository.findLinksByProject(projectId);
    const now = Date.now();
    // Newest first from the repository; take the first that a client could
    // actually open today. An expired or disabled link is worse than none.
    const usable = links.find(
      (l) => l.isActive && (!l.expiresAt || new Date(l.expiresAt).getTime() > now),
    );
    if (usable) context.portalUrl = `${config.APP_URL}/portal/${usable.token}`;
  } catch (err) {
    logger.warn('clientReportContext: could not resolve a portal link', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return context;
}
