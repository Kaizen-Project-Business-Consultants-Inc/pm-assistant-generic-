import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth';
import { subscriptionRepository } from '../../database/SubscriptionRepository';
import { subscriptionEventRepository } from '../../database/SubscriptionEventRepository';
import { databaseService } from '../../database/connection';

import { isPlatformAdmin } from '../../utils/platformAdmin';
function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  const user = request.user!;
  if (!isPlatformAdmin(user)) {
    reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' });
    return false;
  }
  return true;
}

export async function revenueRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /api/v1/admin/revenue
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(request, reply)) return reply;

    try {
      // MRR calculation from active subscriptions
      const activeSubs = await subscriptionRepository.findAllActiveWithRevenue();
      let mrrCents = 0;
      for (const sub of activeSubs) {
        if (sub.billing_interval === 'year') {
          mrrCents += Math.round(sub.amount_cents / 12);
        } else {
          mrrCents += sub.amount_cents;
        }
      }
      const mrr = mrrCents / 100;
      const arr = mrr * 12;

      // Subscriber counts
      const subscribersByTier = await subscriptionRepository.getSubscriberCountsByTier();
      const totalActiveSubscribers = subscribersByTier.reduce((sum, t) => sum + Number(t.count), 0);

      // Event counts this month
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const monthStartStr = monthStart.toISOString().slice(0, 19).replace('T', ' ');

      const eventCounts = await subscriptionEventRepository.getCountsByType(monthStartStr);
      const newThisMonth = (eventCounts.subscription_created || 0);
      const churnedThisMonth = (eventCounts.subscription_canceled || 0);

      // Top-up revenue this month
      const topUpRows = await databaseService.queryControlPlane<{ total: number }>(
        `SELECT COALESCE(SUM(amount_cents), 0) AS total
         FROM token_top_ups
         WHERE purchased_at >= ?`,
        [monthStartStr],
      );
      const topUpRevenueThisMonth = Number(topUpRows[0]?.total || 0) / 100;

      // Trial conversion rate (last 90 days)
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 19).replace('T', ' ');
      const trialCounts = await subscriptionEventRepository.getCountsByType(ninetyDaysAgo);
      const trialStarts = (trialCounts.trial_started || 0) + (trialCounts.subscription_created || 0);
      const conversions = trialCounts.subscription_created || 0;
      const trialConversionRate = trialStarts > 0 ? conversions / trialStarts : 0;

      // Churn rate
      const churnRate = (totalActiveSubscribers + churnedThisMonth) > 0
        ? churnedThisMonth / (totalActiveSubscribers + churnedThisMonth)
        : 0;

      // Revenue trend (12 months)
      const revenueTrend = await subscriptionEventRepository.getMonthlyTrend(12);

      // Recent events
      const recentEvents = await subscriptionEventRepository.getRecentGlobal(20);

      return {
        mrr,
        arr,
        totalActiveSubscribers,
        subscribersByTier,
        newThisMonth,
        churnedThisMonth,
        topUpRevenueThisMonth,
        trialConversionRate,
        churnRate,
        revenueTrend: revenueTrend.map(r => ({
          month: r.month,
          mrr: Number(r.mrr_cents) / 100,
          topups: Number(r.topups_cents) / 100,
        })),
        recentEvents,
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
