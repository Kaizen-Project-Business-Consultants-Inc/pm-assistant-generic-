import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/authStore';
import { apiService } from '../../services/api';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';

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
      '14-day full access',
      'Mjuzi AI assistant (25K tokens)',
      'Gantt, Kanban, Sprint boards',
      'RAID management',
      'No credit card required',
    ],
  },
  {
    tier: 'consultant',
    name: 'Consultant',
    monthly: 19,
    annual: 190,
    tokens: '500K',
    tokensEquiv: '~100 AI chats, 50 risk scans, or 25 reports/mo',
    storage: '1GB',
    viewerInvites: '5',
    features: [
      'Unlimited projects',
      'All PM features included',
      'Mjuzi AI assistant (500K tokens/mo)',
      'Gantt, Kanban, Sprint boards',
      'RAID management & risk scans',
      'All exports (CSV, PDF, XML)',
      'API access & integrations',
      '5 free viewer invites for clients',
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
    highlight: true,
    perSeat: true,
    minSeats: 3,
    features: [
      'Everything in Consultant, plus:',
      '500K AI tokens per seat (pooled)',
      '5GB file storage',
      'Unlimited viewer invites',
      'EVM dashboard & Monte Carlo',
      'Resource management & heatmaps',
      'Custom report builder',
      'DAG workflow automation',
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
  consultant: boolean | string;
  sme: boolean | string;
}

export const COMPARISON: FeatureRow[] = [
  { feature: 'Projects', trial: '3', consultant: 'Unlimited', sme: 'Unlimited' },
  { feature: 'AI tokens/month', trial: '25K', consultant: '500K', sme: '500K/seat' },
  { feature: 'File Storage', trial: '100MB', consultant: '1GB', sme: '5GB' },
  { feature: 'Viewer Invites', trial: '0', consultant: '5', sme: 'Unlimited' },
  { feature: 'Duration', trial: '14 days', consultant: 'Unlimited', sme: 'Unlimited' },
  { feature: 'Mjuzi AI Assistant', trial: true, consultant: true, sme: true },
  { feature: 'Gantt Charts & Critical Path', trial: true, consultant: true, sme: true },
  { feature: 'Kanban Boards', trial: true, consultant: true, sme: true },
  { feature: 'Sprint / Agile Management', trial: true, consultant: true, sme: true },
  { feature: 'RAID Management', trial: true, consultant: true, sme: true },
  { feature: 'Export (CSV, PDF, XML)', trial: false, consultant: true, sme: true },
  { feature: 'API Access', trial: false, consultant: true, sme: true },
  { feature: 'EVM Dashboard & AI Forecasting', trial: false, consultant: true, sme: true },
  { feature: 'Monte Carlo Simulation', trial: false, consultant: true, sme: true },
  { feature: 'Resource Management & Heatmaps', trial: false, consultant: true, sme: true },
  { feature: 'Custom Report Builder', trial: false, consultant: true, sme: true },
  { feature: 'DAG Workflow Automation', trial: false, consultant: true, sme: true },
  { feature: 'Stakeholder Portal', trial: false, consultant: true, sme: true },
  { feature: 'Cross-Project Intelligence', trial: false, consultant: true, sme: true },
  { feature: 'AI Auto-Reschedule', trial: false, consultant: true, sme: true },
  { feature: 'Meeting Intelligence & Voice', trial: false, consultant: true, sme: true },
  { feature: 'NL Query Engine', trial: false, consultant: true, sme: true },
  { feature: 'MCP Integration', trial: false, consultant: true, sme: true },
  { feature: 'Token Top-Up Packs', trial: false, consultant: true, sme: true },
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

  const PLANS: PlanDef[] = pricingData?.tiers
    ? pricingData.tiers.map(mapApiToPlan)
    : FALLBACK_PLANS;

  const currentTier = user?.subscriptionTier || 'trial';
  const isSubscribed = currentTier === 'consultant' || currentTier === 'sme';

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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {PLANS.map((plan) => {
          const isCurrent = mode === 'checkout' && currentTier === plan.tier;
          const seats = plan.perSeat ? smeSeats : 1;
          const unitPrice = billing === 'monthly' ? plan.monthly : plan.annual;
          const price = plan.perSeat ? unitPrice * seats : unitPrice;
          const perMonth = billing === 'annual' ? ((plan.annual * seats) / 12).toFixed(2) : null;

          return (
            <div
              key={plan.tier}
              className={`relative rounded-2xl border-2 p-6 shadow-sm transition-all ${
                plan.highlight
                  ? 'border-primary-500 shadow-xl shadow-primary-500/10'
                  : 'border-gray-200 dark:border-gray-700'
              } bg-white dark:bg-gray-800`}
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
                      <span className="text-4xl font-bold text-gray-900 dark:text-white">
                        ${price}
                      </span>
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        /{billing === 'monthly' ? 'mo' : 'yr'}
                      </span>
                    </div>
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
              </div>

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
