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
  desc?: string;
  trial: boolean | string;
  consultant_basic: boolean | string;
  consultant_pro: boolean | string;
  sme: boolean | string;
}

export const COMPARISON: FeatureRow[] = [
  { feature: 'Projects', desc: 'Active projects you can manage simultaneously', trial: '3', consultant_basic: 'Unlimited', consultant_pro: 'Unlimited', sme: 'Unlimited' },
  { feature: 'AI tokens/month', desc: 'Monthly budget for AI-powered features', trial: '25K', consultant_basic: '—', consultant_pro: '500K', sme: '500K/seat' },
  { feature: 'File Storage', desc: 'Space for documents, attachments, and exports', trial: '100MB', consultant_basic: '1GB', consultant_pro: '1GB', sme: '5GB' },
  { feature: 'Viewer Invites', desc: 'Read-only access for clients and stakeholders', trial: '0', consultant_basic: '5', consultant_pro: '5', sme: 'Unlimited' },
  { feature: 'Gantt Charts & Critical Path', desc: 'Visual timelines with dependency tracking and critical path analysis', trial: true, consultant_basic: true, consultant_pro: true, sme: true },
  { feature: 'Kanban Boards', desc: 'Drag-and-drop task boards for agile workflows', trial: true, consultant_basic: true, consultant_pro: true, sme: true },
  { feature: 'Sprint / Agile Management', desc: 'Sprint planning, backlog grooming, and velocity tracking', trial: true, consultant_basic: true, consultant_pro: true, sme: true },
  { feature: 'RAID Management', desc: 'Track risks, actions, issues, and decisions in one place', trial: true, consultant_basic: true, consultant_pro: true, sme: true },
  { feature: 'Export (CSV, PDF, XML)', desc: 'Download reports and data in multiple formats', trial: true, consultant_basic: true, consultant_pro: true, sme: true },
  { feature: 'Stakeholder Portal', desc: 'Branded read-only view for client project updates', trial: true, consultant_basic: true, consultant_pro: true, sme: true },
  { feature: 'API Access', desc: 'REST API for custom integrations and automation', trial: true, consultant_basic: true, consultant_pro: true, sme: true },
  { feature: 'Mjuzi AI Assistant', desc: 'Chat-based AI that knows your project data', trial: true, consultant_basic: false, consultant_pro: true, sme: true },
  { feature: 'EVM Dashboard & AI Forecasting', desc: 'Earned value metrics with AI-powered cost and schedule predictions', trial: true, consultant_basic: false, consultant_pro: true, sme: true },
  { feature: 'Monte Carlo Simulation', desc: 'Probabilistic analysis for confident delivery date estimates', trial: true, consultant_basic: false, consultant_pro: true, sme: true },
  { feature: 'AI Auto-Reschedule', desc: 'One-click intelligent schedule optimization when plans change', trial: true, consultant_basic: false, consultant_pro: true, sme: true },
  { feature: 'Meeting Intelligence & Voice', desc: 'Upload transcripts, extract action items and decisions automatically', trial: true, consultant_basic: false, consultant_pro: true, sme: true },
  { feature: 'NL Query Engine', desc: 'Ask questions about your project data in plain English', trial: true, consultant_basic: false, consultant_pro: true, sme: true },
  { feature: 'Resource Management & Heatmaps', desc: 'Capacity planning with visual workload and allocation heatmaps', trial: true, consultant_basic: false, consultant_pro: true, sme: true },
  { feature: 'Custom Report Builder', desc: 'Generate tailored status reports with AI assistance', trial: true, consultant_basic: false, consultant_pro: true, sme: true },
  { feature: 'DAG Workflow Automation', desc: 'Automated task pipelines triggered by project events', trial: true, consultant_basic: false, consultant_pro: true, sme: true },
  { feature: 'Cross-Project Intelligence', desc: 'AI insights across your entire portfolio', trial: true, consultant_basic: false, consultant_pro: true, sme: true },
  { feature: 'MCP Integration', desc: 'Connect Kovarti PM to Claude and other AI tools', trial: true, consultant_basic: false, consultant_pro: true, sme: true },
  { feature: 'Token Top-Up Packs', desc: 'Buy extra AI tokens anytime — $5 per 500K', trial: true, consultant_basic: false, consultant_pro: true, sme: true },
];

interface PricingCardsProps {
  mode: 'checkout' | 'link' | 'waitlist';
  forceDark?: boolean;
}

export const PricingCards: React.FC<PricingCardsProps> = ({ mode, forceDark }) => {
  const { isAuthenticated, user } = useAuthStore();
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly');
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [smeSeats, setSmeSeats] = useState(3);
  const dk = forceDark; // shorthand

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
    ? [FALLBACK_PLANS[0], ...pricingData.tiers.filter((t: { tier: string }) => t.tier !== 'trial').map(mapApiToPlan)]
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
        <div className={`inline-flex items-center rounded-full p-1 ${dk ? 'bg-gray-700' : 'bg-gray-100 dark:bg-gray-700'}`}>
          <button
            onClick={() => setBilling('monthly')}
            aria-pressed={billing === 'monthly'}
            className={`px-5 py-2 text-sm font-medium rounded-full transition-colors ${
              billing === 'monthly'
                ? dk ? 'bg-gray-600 text-white shadow-sm' : 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                : dk ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setBilling('annual')}
            aria-pressed={billing === 'annual'}
            className={`px-5 py-2 text-sm font-medium rounded-full transition-colors ${
              billing === 'annual'
                ? dk ? 'bg-gray-600 text-white shadow-sm' : 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                : dk ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            Annual
            <span className={`ml-1.5 text-xs font-semibold ${dk ? 'text-green-400' : 'text-green-600 dark:text-green-400'}`}>Save 17%</span>
          </button>
        </div>
      </div>

      {error && (
        <div className={`max-w-xl mx-auto mb-6 flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${dk ? 'bg-red-900/20 border border-red-800 text-red-300' : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'}`}>
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

          const cardBg = dk ? 'bg-slate-800' : 'bg-white dark:bg-gray-800';
          const cardBorder = plan.highlight
            ? 'border-primary-500 shadow-xl shadow-primary-500/10'
            : dk ? 'border-slate-600 shadow-lg shadow-black/30' : 'border-gray-200 dark:border-gray-700';
          const textPrimary = dk ? 'text-white' : 'text-gray-900 dark:text-white';
          const textSecondary = dk ? 'text-gray-400' : 'text-gray-500 dark:text-gray-400';
          const textTertiary = dk ? 'text-gray-500' : 'text-gray-400 dark:text-gray-500';
          const textFeature = dk ? 'text-gray-200' : 'text-gray-700 dark:text-gray-200';

          return (
            <div
              key={plan.tier}
              className={`relative rounded-2xl border-2 p-6 shadow-sm transition-all ${cardBorder} ${cardBg}`}
            >
              {plan.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-primary-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                    Most Popular
                  </span>
                </div>
              )}

              <div className="mb-4">
                <h3 className={`text-xl font-bold ${textPrimary}`}>{plan.name}</h3>
                {plan.monthly === 0 ? (
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className={`text-4xl font-bold ${textPrimary}`}>Free</span>
                    <span className={`text-sm ${textSecondary}`}>/14 days</span>
                  </div>
                ) : plan.perSeat ? (
                  <>
                    <div className="mt-3 flex items-baseline gap-1">
                      <span className={`text-4xl font-bold ${textPrimary}`}>
                        ${unitPrice}
                      </span>
                      <span className={`text-sm ${textSecondary}`}>
                        USD/seat/{billing === 'monthly' ? 'mo' : 'yr'}
                      </span>
                    </div>
                    <p className={`text-sm mt-1 ${textSecondary}`}>
                      {seats} seats = <span className={`font-semibold ${textPrimary}`}>${price}/{billing === 'monthly' ? 'mo' : 'yr'}</span>
                    </p>
                    {/* Seat selector */}
                    <div className="mt-3 flex items-center gap-3">
                      <label className={`text-xs font-medium ${textSecondary}`}>Seats:</label>
                      <div className={`flex items-center border rounded-lg overflow-hidden ${dk ? 'border-gray-600' : 'border-gray-300 dark:border-gray-600'}`}>
                        <button
                          onClick={() => setSmeSeats((s) => Math.max(plan.minSeats || 3, s - 1))}
                          className={`px-2.5 py-1 text-sm font-medium transition-colors disabled:opacity-30 ${dk ? 'text-gray-200 hover:bg-gray-700' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                          disabled={smeSeats <= (plan.minSeats || 3)}
                        >
                          &minus;
                        </button>
                        <span className={`px-3 py-1 text-sm font-semibold min-w-[2.5rem] text-center ${dk ? 'text-white bg-gray-800' : 'text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-800'}`}>
                          {smeSeats}
                        </span>
                        <button
                          onClick={() => setSmeSeats((s) => Math.min(50, s + 1))}
                          className={`px-2.5 py-1 text-sm font-medium transition-colors ${dk ? 'text-gray-200 hover:bg-gray-700' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                        >
                          +
                        </button>
                      </div>
                      <span className={`text-xs ${textTertiary}`}>{plan.minSeats}+ min</span>
                    </div>
                    {perMonth && (
                      <p className={`text-xs mt-1 ${dk ? 'text-green-400' : 'text-green-600 dark:text-green-400'}`}>~${perMonth}/mo</p>
                    )}
                  </>
                ) : (
                  <>
                    <div className="mt-3 flex items-baseline gap-1">
                      {isLaunchDiscount && (
                        <span className="text-lg font-medium text-gray-400 line-through mr-1">${originalPrice}</span>
                      )}
                      <span className={`text-4xl font-bold ${textPrimary}`}>
                        ${price}
                      </span>
                      <span className={`text-sm ${textSecondary}`}>
                        USD/{billing === 'monthly' ? 'mo' : 'yr'}
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
                      <p className={`text-xs mt-1 ${dk ? 'text-green-400' : 'text-green-600 dark:text-green-400'}`}>~${perMonth}/mo</p>
                    )}
                  </>
                )}
                <p className={`text-sm mt-2 ${textSecondary}`}>
                  {plan.perSeat ? `${plan.tokens} AI tokens/seat/month` : `${plan.tokens} AI tokens/month`} | {plan.storage} storage
                </p>
                <p className={`text-xs mt-0.5 ${textTertiary}`}>
                  {plan.tokensEquiv}
                </p>
              </div>

              <div className="mb-6">
                {isCurrent ? (
                  <button
                    onClick={plan.tier !== 'trial' ? handleManageBilling : undefined}
                    className={`w-full py-2.5 px-4 text-sm font-semibold rounded-lg transition-colors ${dk ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
                  >
                    Current Plan
                  </button>
                ) : mode === 'waitlist' ? (
                  <a
                    href="#waitlist"
                    className={`block w-full py-2.5 px-4 text-sm font-semibold rounded-lg text-center transition-colors ${dk ? 'bg-primary-600 text-white hover:bg-primary-700' : 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100'}`}
                  >
                    {plan.tier === 'trial' ? 'Join Waitlist' : 'Join Waitlist'}
                  </a>
                ) : plan.tier === 'trial' ? (
                  <Link
                    to="/register"
                    className={`block w-full py-2.5 px-4 text-sm font-semibold rounded-lg text-center transition-colors ${dk ? 'bg-primary-600 text-white hover:bg-primary-700' : 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100'}`}
                  >
                    Start Free Trial
                  </Link>
                ) : mode === 'link' ? (
                  <Link
                    to={`/register?tier=${plan.tier}&billing=${billing}`}
                    className={`block w-full py-2.5 px-4 text-sm font-semibold rounded-lg text-center transition-colors ${
                      plan.highlight
                        ? 'bg-primary-600 text-white hover:bg-primary-700'
                        : dk ? 'bg-primary-600 text-white hover:bg-primary-700' : 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100'
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
                        : dk ? 'bg-primary-600 text-white hover:bg-primary-700' : 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100'
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
                  <p className={`mt-2.5 flex items-center justify-center gap-1.5 text-xs ${textSecondary}`}>
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
                  <li key={feature} className={`flex items-start gap-2 text-sm ${textFeature}`}>
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
  mode: 'checkout' | 'link' | 'waitlist';
  forceDark?: boolean;
}

export const PricingSection: React.FC<PricingSectionProps> = ({ mode, forceDark }) => {
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
      <PricingCards mode={mode} forceDark={forceDark} />

      {/* Token top-up — hidden in waitlist mode */}
      {mode !== 'waitlist' && <div className="max-w-xl mx-auto mt-16">
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
      </div>}

      {/* Feature Comparison Matrix */}
      <div className="mt-20 mb-16">
        <h2 className="text-2xl font-bold text-white text-center mb-8">
          Compare plans
        </h2>
        <div className="overflow-x-auto flex justify-center">
          <table className="text-sm" style={{ maxWidth: '900px', width: '100%' }}>
            <caption className="sr-only">Feature comparison across subscription tiers</caption>
            <thead>
              <tr className="border-b-2 border-gray-700">
                <th scope="col" className="text-left py-3 pr-6 font-semibold text-white">Feature</th>
                <th scope="col" className="text-center py-3 px-3 font-semibold text-gray-400 w-20">
                  Trial
                  <div className="text-[10px] font-normal text-gray-500">14 days</div>
                </th>
                <th scope="col" className="text-center py-3 px-3 font-semibold text-white w-20">Basic</th>
                <th scope="col" className="text-center py-3 px-3 font-semibold text-primary-400 w-20">Pro</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row, i) => (
                <tr key={row.feature} className={`border-b border-gray-700/50 ${i % 2 === 0 ? 'bg-gray-800/50' : ''}`}>
                  <td className="py-2.5 pr-4">
                    <div className="text-gray-300">{row.feature}</div>
                    {row.desc && <div className="text-xs text-gray-500 mt-0.5">{row.desc}</div>}
                  </td>
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
