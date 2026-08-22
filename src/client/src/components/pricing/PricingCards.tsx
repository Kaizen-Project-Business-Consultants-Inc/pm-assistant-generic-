import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, X, Zap, Shield, Star } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/authStore';
import { apiService } from '../../services/api';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';
import { isPaidTier, SUPPORT_EMAIL } from '../../constants/branding';

export interface PlanDef {
  tier: string;
  name: string;
  monthly: number;
  annual: number;
  tokens: string;
  tokensEquiv: string;
  storage: string;
  viewerInvites: string;
  highlight?: boolean;
  perSeat?: boolean;
  minSeats?: number;
  features: string[];
}

const FALLBACK_PLANS: PlanDef[] = [
  {
    tier: 'trial',
    name: 'Free Trial',
    monthly: 0,
    annual: 0,
    tokens: '25K',
    tokensEquiv: 'Enough to explore all AI features',
    storage: '100MB',
    viewerInvites: '0',
    features: [
      'Up to 3 projects',
      '14-day full access (Pro features)',
      'Mjuzi AI assistant (25K tokens)',
      'Gantt, Kanban, Sprint boards',
      'RAID management',
      'No credit card required',
    ],
  },
  {
    tier: 'consultant_basic',
    name: 'Consultant Basic',
    monthly: 19,
    annual: 190,
    tokens: '—',
    tokensEquiv: 'Core PM features — no AI',
    storage: '1GB',
    viewerInvites: '5',
    features: [
      'Unlimited projects',
      'Gantt, Kanban, Sprint boards',
      'RAID management',
      'All exports (CSV, PDF, XML)',
      'API access & integrations',
      '5 free viewer invites for clients',
      'Stakeholder portal',
    ],
  },
  {
    tier: 'consultant_pro',
    name: 'Consultant Pro',
    monthly: 29,
    annual: 290,
    tokens: '500K',
    tokensEquiv: '~100 AI chats, 50 risk scans, or 25 reports/mo',
    storage: '1GB',
    viewerInvites: '5',
    highlight: true,
    features: [
      'Everything in Basic, plus:',
      'Mjuzi AI assistant (500K tokens/mo)',
      'AI risk scans & forecasting',
      'EVM dashboard & Monte Carlo',
      'Meeting intelligence & voice',
      'NL query engine',
      'AI auto-reschedule',
      'Token top-up packs',
    ],
  },
  {
    tier: 'sme',
    name: 'SME',
    monthly: 33,
    annual: 330,
    tokens: '500K',
    tokensEquiv: '500K AI tokens per seat, pooled across your team',
    storage: '5GB',
    viewerInvites: 'Unlimited',
    perSeat: true,
    minSeats: 3,
    features: [
      'Everything in Pro, plus:',
      '500K AI tokens per seat (pooled)',
      '5GB file storage',
      'Unlimited viewer invites',
      'Resource management & heatmaps',
      'Custom report builder',
      'DAG workflow automation',
      'Cross-project intelligence',
    ],
  },
];

function mapApiToPlan(t: any): PlanDef {
  return {
    tier: t.tier,
    name: t.displayName,
    monthly: t.monthlyPriceCents / 100,
    annual: t.annualPriceCents / 100,
    tokens: t.aiTokensLabel,
    tokensEquiv: t.aiTokensDescription || '',
    storage: t.storageLabel,
    viewerInvites: t.viewerLimitLabel,
    highlight: t.highlight,
    perSeat: t.isPerSeat,
    minSeats: t.minSeats,
    features: t.featuresJson || [],
  };
}

export { FALLBACK_PLANS as PLANS };

export interface FeatureRow {
  feature: string;
  trial: boolean | string;
  consultant_basic: boolean | string;
  consultant_pro: boolean | string;
  sme: boolean | string;
}

export const COMPARISON: FeatureRow[] = [
  { feature: 'Projects', trial: '3', consultant_basic: 'Unlimited', consultant_pro: 'Unlimited', sme: 'Unlimited' },
  { feature: 'AI tokens/month', trial: '25K', consultant_basic: '—', consultant_pro: '500K', sme: '500K/seat' },
  { feature: 'File Storage', trial: '100MB', consultant_basic: '1GB', consultant_pro: '1GB', sme: '5GB' },
  { feature: 'Viewer Invites', trial: '5', consultant_basic: '5', consultant_pro: '5', sme: 'Unlimited' },
  { feature: 'Gantt Charts & Critical Path', trial: true, consultant_basic: true, consultant_pro: true, sme: true },
  { feature: 'Kanban Boards', trial: true, consultant_basic: true, consultant_pro: true, sme: true },
  { feature: 'Sprint / Agile Management', trial: true, consultant_basic: true, consultant_pro: true, sme: true },
  { feature: 'RAID Management', trial: true, consultant_basic: true, consultant_pro: true, sme: true },
  { feature: 'Export (CSV, PDF, XML)', trial: true, consultant_basic: true, consultant_pro: true, sme: true },
  { feature: 'Stakeholder Portal', trial: true, consultant_basic: true, consultant_pro: true, sme: true },
  { feature: 'API Access', trial: true, consultant_basic: true, consultant_pro: true, sme: true },
  { feature: 'Mjuzi AI Assistant', trial: true, consultant_basic: false, consultant_pro: true, sme: true },
  { feature: 'EVM Dashboard & AI Forecasting', trial: true, consultant_basic: false, consultant_pro: true, sme: true },
  { feature: 'Monte Carlo Simulation', trial: true, consultant_basic: false, consultant_pro: true, sme: true },
  { feature: 'AI Auto-Reschedule', trial: true, consultant_basic: false, consultant_pro: true, sme: true },
  { feature: 'Meeting Intelligence & Voice', trial: true, consultant_basic: false, consultant_pro: true, sme: true },
  { feature: 'NL Query Engine', trial: true, consultant_basic: false, consultant_pro: true, sme: true },
  { feature: 'Resource Management & Heatmaps', trial: true, consultant_basic: false, consultant_pro: true, sme: true },
  { feature: 'Custom Report Builder', trial: true, consultant_basic: false, consultant_pro: true, sme: true },
  { feature: 'DAG Workflow Automation', trial: true, consultant_basic: false, consultant_pro: true, sme: true },
  { feature: 'Cross-Project Intelligence', trial: true, consultant_basic: false, consultant_pro: true, sme: true },
  { feature: 'MCP Integration', trial: true, consultant_basic: false, consultant_pro: true, sme: true },
  { feature: 'Token Top-Up Packs', trial: true, consultant_basic: false, consultant_pro: true, sme: true },
];

interface PricingCardsProps {
  mode: 'checkout' | 'link';
}

export const PricingCards: React.FC<PricingCardsProps> = ({ mode }) => {
  const { isAuthenticated, user } = useAuthStore();
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly');
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [smeSeats, setSmeSeats] = useState(3);

  const { data: pricingData } = useQuery({
    queryKey: ['pricing-config'],
    queryFn: () => apiService.getPricingConfig(),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const { data: stripeConfig } = useQuery({
    queryKey: ['stripe-config'],
    queryFn: () => apiService.request('get', '/stripe/config'),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const launchOfferEnabled = stripeConfig?.launchOfferEnabled || false;
  const launchDiscount = stripeConfig?.launchOfferDiscount || 0;

  const PLANS: PlanDef[] = pricingData?.tiers
    ? [FALLBACK_PLANS[0], ...pricingData.tiers.map(mapApiToPlan)]
    : FALLBACK_PLANS;

  const currentTier = isAuthenticated ? (user?.subscriptionTier || 'trial') : null;
  const isSubscribed = isPaidTier(currentTier);

  const handleSubscribe = async (tier: string) => {
    if (!isAuthenticated) {
      window.location.href = `/register?tier=${tier}&billing=${billing}`;
      return;
    }
    setLoading(tier);
    setError(null);
    try {
      const seats = tier === 'sme' ? smeSeats : undefined;
      const { url } = await apiService.createCheckoutSession(billing, tier, seats);
      window.location.href = url;
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to start checkout. Please try again.'));
      setLoading(null);
    }
  };

  const handleManageBilling = async () => {
    try {
      const { url } = await apiService.createPortalSession();
      window.location.href = url;
    } catch {
      // ignore
    }
  };

  return (
    <div>
      {/* Billing toggle */}
      <div className="flex justify-center mb-10">
        <div className="inline-flex items-center bg-gray-100 dark:bg-gray-700 rounded-full p-1">
          <button
            onClick={() => setBilling('monthly')}
            className={`px-5 py-2 text-sm font-medium rounded-full transition-colors ${
              billing === 'monthly'
                ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setBilling('annual')}
            className={`px-5 py-2 text-sm font-medium rounded-full transition-colors ${
              billing === 'annual'
                ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            Annual
            <span className="ml-1.5 text-xs text-green-600 dark:text-green-400 font-semibold">Save 17%</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="max-w-xl mx-auto mb-6 flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}

      {/* Plan cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {PLANS.filter((p) => p.tier !== 'sme').map((plan) => {
          const isCurrent = mode === 'checkout' && currentTier === plan.tier;
          const seats = plan.perSeat ? smeSeats : 1;
          const unitPrice = billing === 'monthly' ? plan.monthly : plan.annual;
          const isLaunchDiscount = launchOfferEnabled && plan.tier === 'consultant_pro' && billing === 'annual' && launchDiscount > 0;
          const originalPrice = plan.perSeat ? unitPrice * seats : unitPrice;
          const price = isLaunchDiscount ? Math.round(originalPrice * (1 - launchDiscount / 100)) : originalPrice;
          const perMonth = billing === 'annual' ? ((price) / 12).toFixed(2) : null;

          return (
            <div
              key={plan.tier}
              className={`relative rounded-2xl border-2 p-6 shadow-sm transition-all ${
                plan.highlight
                  ? 'border-primary-500 shadow-xl shadow-primary-500/10'
                  : 'border-gray-200 dark:border-slate-600 dark:shadow-lg dark:shadow-black/30'
              } bg-white dark:bg-slate-800`}
            >
              {plan.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-primary-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                    Most Popular
                  </span>
                </div>
              )}

              <div className="mb-4">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{plan.name}</h2>
                {plan.monthly === 0 ? (
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-gray-900 dark:text-white">Free</span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">/14 days</span>
                  </div>
                ) : plan.perSeat ? (
                  <>
                    <div className="mt-3 flex items-baseline gap-1">
                      <span className="text-4xl font-bold text-gray-900 dark:text-white">
                        ${unitPrice}
                      </span>
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        /seat/{billing === 'monthly' ? 'mo' : 'yr'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      {seats} seats = <span className="font-semibold text-gray-900 dark:text-white">${price}/{billing === 'monthly' ? 'mo' : 'yr'}</span>
                    </p>
                    {/* Seat selector */}
                    <div className="mt-3 flex items-center gap-3">
                      <label className="text-xs text-gray-500 dark:text-gray-400 font-medium">Seats:</label>
                      <div className="flex items-center border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
                        <button
                          onClick={() => setSmeSeats((s) => Math.max(plan.minSeats || 3, s - 1))}
                          className="px-2.5 py-1 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-30"
                          disabled={smeSeats <= (plan.minSeats || 3)}
                        >
                          &minus;
                        </button>
                        <span className="px-3 py-1 text-sm font-semibold text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-800 min-w-[2.5rem] text-center">
                          {smeSeats}
                        </span>
                        <button
                          onClick={() => setSmeSeats((s) => Math.min(50, s + 1))}
                          className="px-2.5 py-1 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        >
                          +
                        </button>
                      </div>
                      <span className="text-xs text-gray-400 dark:text-gray-500">{plan.minSeats}+ min</span>
                    </div>
                    {perMonth && (
                      <p className="text-xs text-green-600 dark:text-green-400 mt-1">~${perMonth}/mo</p>
                    )}
                  </>
                ) : (
                  <>
                    <div className="mt-3 flex items-baseline gap-1">
                      {isLaunchDiscount && (
                        <span className="text-lg font-medium text-gray-400 line-through mr-1">${originalPrice}</span>
                      )}
                      <span className="text-4xl font-bold text-gray-900 dark:text-white">
                        ${price}
                      </span>
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        /{billing === 'monthly' ? 'mo' : 'yr'}
                      </span>
                      {isLaunchDiscount && (
                        <span className="ml-2 text-xs font-bold bg-green-500 text-white px-2 py-0.5 rounded-full">
                          {launchDiscount}% OFF
                        </span>
                      )}
                    </div>
                    {isLaunchDiscount && (
                      <p className="text-xs text-green-500 font-semibold mt-1">
                        Save ${originalPrice - price} in your first year
                      </p>
                    )}
                    {perMonth && (
                      <p className="text-xs text-green-600 dark:text-green-400 mt-1">~${perMonth}/mo</p>
                    )}
                  </>
                )}
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                  {plan.perSeat ? `${plan.tokens} AI tokens/seat/month` : `${plan.tokens} AI tokens/month`} | {plan.storage} storage
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                  {plan.tokensEquiv}
                </p>
              </div>

              <div className="mb-6">
                {isCurrent ? (
                  <button
                    onClick={plan.tier !== 'trial' ? handleManageBilling : undefined}
                    className="w-full py-2.5 px-4 text-sm font-semibold rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    Current Plan
                  </button>
                ) : plan.tier === 'trial' ? (
                  <Link
                    to="/register"
                    className="block w-full py-2.5 px-4 text-sm font-semibold rounded-lg text-center bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors"
                  >
                    Start Free Trial
                  </Link>
                ) : mode === 'link' ? (
                  <Link
                    to={`/register?tier=${plan.tier}&billing=${billing}`}
                    className={`block w-full py-2.5 px-4 text-sm font-semibold rounded-lg text-center transition-colors ${
                      plan.highlight
                        ? 'bg-primary-600 text-white hover:bg-primary-700'
                        : 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100'
                    }`}
                  >
                    Subscribe
                  </Link>
                ) : (
                  <button
                    onClick={() => handleSubscribe(plan.tier)}
                    disabled={loading === plan.tier}
                    className={`w-full py-2.5 px-4 text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 ${
                      plan.highlight
                        ? 'bg-primary-600 text-white hover:bg-primary-700'
                        : 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100'
                    }`}
                  >
                    {loading === plan.tier ? (
                      <span className="flex items-center justify-center">
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                        Loading…
                      </span>
                    ) : isAuthenticated ? (
                      isSubscribed ? 'Switch Plan' : 'Subscribe'
                    ) : (
                      'Get Started'
                    )}
                  </button>
                )}

                {/* Refund guarantee — visible under Pro CTA */}
                {plan.tier === 'consultant_pro' && billing === 'annual' && (
                  <p className="mt-2.5 flex items-center justify-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                    <Shield className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                    Cancel within 30 days for a prorated refund.
                  </p>
                )}
              </div>

              {/* Founders badge callout during launch */}
              {launchOfferEnabled && plan.tier === 'consultant_pro' && (
                <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                  <Star className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span className="text-xs font-medium text-amber-300">Founders badge included — early supporters only</span>
                </div>
              )}

              <ul className="space-y-2.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200">
                    <Check className="w-4 h-4 text-primary-500 flex-shrink-0 mt-0.5" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
};

interface PricingSectionProps {
  mode: 'checkout' | 'link';
}

export const PricingSection: React.FC<PricingSectionProps> = ({ mode }) => {
  const { isAuthenticated } = useAuthStore();
  const [topUpLoading, setTopUpLoading] = useState(false);

  const handleBuyTokens = async () => {
    if (!isAuthenticated) {
      window.location.href = '/register';
      return;
    }
    setTopUpLoading(true);
    try {
      const { url } = await apiService.createTopUpSession(1);
      window.location.href = url;
    } catch {
      setTopUpLoading(false);
    }
  };

  return (
    <>
      <PricingCards mode={mode} />

      {/* Token top-up */}
      <div className="max-w-xl mx-auto mt-16">
        <div className="bg-amber-900/20 border border-amber-700 rounded-2xl p-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Zap className="w-5 h-5 text-amber-400" />
            <h3 className="text-lg font-bold text-white">Need more AI tokens?</h3>
          </div>
          <p className="text-sm text-gray-300 mb-4">
            Top up anytime. <strong className="text-white">500K tokens for $5</strong> — added instantly to your balance.
          </p>
          <button
            onClick={handleBuyTokens}
            disabled={topUpLoading}
            className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
          >
            {topUpLoading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Loading…
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                Buy Token Pack — $5
              </>
            )}
          </button>
        </div>
      </div>

      {/* Feature Comparison Matrix */}
      <div className="mt-20 mb-16">
        <h2 className="text-2xl font-bold text-white text-center mb-8">
          Compare plans
        </h2>
        <div className="overflow-x-auto flex justify-center">
          <table className="text-sm" style={{ maxWidth: '900px', width: '100%' }}>
            <thead>
              <tr className="border-b-2 border-gray-700">
                <th className="text-left py-3 pr-6 font-semibold text-white">Feature</th>
                <th className="text-center py-3 px-3 font-semibold text-gray-400 w-20">
                  Trial
                  <div className="text-[10px] font-normal text-gray-500">14 days</div>
                </th>
                <th className="text-center py-3 px-3 font-semibold text-white w-20">Basic</th>
                <th className="text-center py-3 px-3 font-semibold text-primary-400 w-20">Pro</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row, i) => (
                <tr key={row.feature} className={`border-b border-gray-700/50 ${i % 2 === 0 ? 'bg-gray-800/50' : ''}`}>
                  <td className="py-2.5 pr-4 text-gray-300">{row.feature}</td>
                  {(['trial', 'consultant_basic', 'consultant_pro'] as const).map((tier) => {
                    const val = row[tier];
                    return (
                      <td key={tier} className="py-2.5 px-3 text-center">
                        {val === true ? (
                          <Check className="w-4 h-4 text-primary-500 mx-auto" />
                        ) : val === false ? (
                          <X className="w-4 h-4 text-gray-600 mx-auto" />
                        ) : (
                          <span className="text-gray-300 font-medium">{val}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Refund policy */}
      <details className="mt-12 text-center text-xs text-gray-500">
        <summary className="cursor-pointer hover:text-gray-300 transition-colors">Refund &amp; cancellation policy</summary>
        <div className="mt-2 space-y-1">
          <p>Monthly subscriptions are non-refundable. Cancel anytime.</p>
          <p>Annual subscriptions: pro-rated refund within 30 days, non-refundable after.</p>
          <p>Token top-ups are non-refundable and do not expire.</p>
          <p>Questions? <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary-400 hover:underline">{SUPPORT_EMAIL}</a></p>
        </div>
      </details>
    </>
  );
};
