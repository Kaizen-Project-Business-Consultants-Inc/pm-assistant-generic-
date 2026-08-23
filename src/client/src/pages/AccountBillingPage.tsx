import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getApiErrorMessage } from '../utils/getApiErrorMessage';
import { TIER_LABELS, isPaidTier, FOUNDER_BADGE_CLASS } from '../constants/branding';
import {
  CreditCard,
  Crown,
  CheckCircle2,
  Clock,
  AlertCircle,
  ExternalLink,
  Zap,
  XCircle,
  Plus,
  Minus,
  Users,
} from 'lucide-react';
import { apiService } from '../services/api';

interface SubscriptionStatus {
  tier: string;
  status: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  isFounder?: boolean;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '--';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function getStatusBadge(status: string, cancelAtPeriodEnd: boolean) {
  if (cancelAtPeriodEnd) {
    return { label: 'Canceling', color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400', icon: XCircle };
  }
  switch (status) {
    case 'trialing':
      return { label: 'Trialing', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400', icon: Clock };
    case 'active':
      return { label: 'Active', color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400', icon: CheckCircle2 };
    case 'past_due':
      return { label: 'Past Due', color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400', icon: AlertCircle };
    case 'canceled':
      return { label: 'Canceled', color: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300', icon: XCircle };
    default:
      return { label: status || 'Free', color: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300', icon: CreditCard };
  }
}

const TIER_FEATURES: Record<string, string[]> = {
  trial: [
    'Up to 3 projects',
    'Basic PM features',
    '25K AI tokens/month',
  ],
  consultant_basic: [
    'Unlimited projects',
    'Core PM features',
    'Exports (CSV, PDF, XML)',
    'API access',
    '1GB file storage',
    '5 viewer invites',
  ],
  consultant_pro: [
    'Unlimited projects',
    'All features included',
    '500K AI tokens/month',
    '1GB file storage',
    '5 viewer invites',
  ],
  sme: [
    'Unlimited projects',
    'All features included',
    '500K AI tokens per seat (pooled)',
    '5GB file storage',
    'Unlimited viewer invites',
  ],
};

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

export const AccountBillingPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [portalLoading, setPortalLoading] = useState(false);
  const [topUpLoading, setTopUpLoading] = useState(false);
  const [seatLoading, setSeatLoading] = useState(false);
  const [seatError, setSeatError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<SubscriptionStatus>({
    queryKey: ['subscription-status'],
    queryFn: () => apiService.getSubscriptionStatus(),
  });

  const { data: topUpData } = useQuery({
    queryKey: ['topup-balance'],
    queryFn: () => apiService.getTopUpBalance(),
  });

  const { data: budgetData } = useQuery({
    queryKey: ['ai-budget'],
    queryFn: () => apiService.getAiBudget(),
    staleTime: 5 * 60_000,
  });

  const { data: seatData } = useQuery({
    queryKey: ['seat-info'],
    queryFn: () => apiService.getSeatInfo(),
    enabled: data?.tier === 'sme',
  });

  const handleManageBilling = async () => {
    setPortalLoading(true);
    try {
      const result = await apiService.createPortalSession();
      window.location.href = result.url;
    } catch {
      setPortalLoading(false);
    }
  };

  const handleBuyTopUp = async () => {
    setTopUpLoading(true);
    try {
      const result = await apiService.createTopUpSession(1);
      window.location.href = result.url;
    } catch {
      setTopUpLoading(false);
    }
  };

  const handleSeatChange = async (action: 'add' | 'remove') => {
    setSeatLoading(true);
    setSeatError(null);
    try {
      if (action === 'add') {
        await apiService.addSeats(1);
      } else {
        await apiService.removeSeats(1);
      }
      queryClient.invalidateQueries({ queryKey: ['seat-info'] });
      queryClient.invalidateQueries({ queryKey: ['ai-budget'] });
    } catch (err: unknown) {
      setSeatError(getApiErrorMessage(err, `Failed to ${action} seat.`));
    } finally {
      setSeatLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-64" />
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-48" />
          <div className="h-48 bg-gray-200 dark:bg-gray-700 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6 text-center">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
          <p className="text-red-700 dark:text-red-300 text-sm">Failed to load billing information. Please try again later.</p>
        </div>
      </div>
    );
  }

  const isPaid = isPaidTier(data.tier);
  const trialDays = daysUntil(data.trialEndsAt);
  const badge = getStatusBadge(data.status, data.cancelAtPeriodEnd);
  const BadgeIcon = badge.icon;
  const planLabel = TIER_LABELS[data.tier] || `${data.tier.charAt(0).toUpperCase() + data.tier.slice(1)} Plan`;
  const planFeatures = TIER_FEATURES[data.tier] || TIER_FEATURES.consultant_pro;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Account & Billing</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage your subscription and billing details</p>
      </div>

      {isPaid ? (
        <>
          {/* Current Plan Card */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-6 mb-4">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Current Plan</h2>
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center">
                <Crown className="w-6 h-6 text-primary-600 dark:text-primary-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-lg font-semibold text-gray-900 dark:text-white">{planLabel}</span>
                  <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.color}`}>
                    <BadgeIcon className="w-3 h-3" />
                    {badge.label}
                  </span>
                  {data.isFounder && (
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${FOUNDER_BADGE_CLASS}`}>
                      Founder
                    </span>
                  )}
                </div>

                <div className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-300">
                  {data.status === 'trialing' && trialDays !== null && (
                    <p>
                      Trial ends <span className="font-medium text-gray-900 dark:text-white">{formatDate(data.trialEndsAt)}</span>
                      {' '}({trialDays} day{trialDays !== 1 ? 's' : ''} remaining)
                    </p>
                  )}
                  {data.currentPeriodEnd && !data.cancelAtPeriodEnd && (
                    <p>
                      Next billing date: <span className="font-medium text-gray-900 dark:text-white">{formatDate(data.currentPeriodEnd)}</span>
                    </p>
                  )}
                  {data.cancelAtPeriodEnd && data.currentPeriodEnd && (
                    <p className="text-amber-700 dark:text-amber-400">
                      Access until <span className="font-medium">{formatDate(data.currentPeriodEnd)}</span>, then reverts to read-only
                    </p>
                  )}
                </div>

                <button
                  onClick={handleManageBilling}
                  disabled={portalLoading}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
                >
                  {portalLoading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <ExternalLink className="w-4 h-4" />
                  )}
                  Manage Billing
                </button>
              </div>
            </div>
          </div>

          {/* AI Usage Meter */}
          {budgetData && (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-6 mb-4">
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">AI Usage This Month</h2>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-600 dark:text-gray-300">
                  {formatTokens(budgetData.totalTokens)} of {formatTokens(budgetData.budget)} tokens used
                </span>
                <span className="text-sm font-semibold text-gray-900 dark:text-white">{budgetData.percentUsed}%</span>
              </div>
              <div className="w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    budgetData.percentUsed >= 90 ? 'bg-red-500' : budgetData.percentUsed >= 70 ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.min(budgetData.percentUsed, 100)}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {formatTokens(budgetData.remaining)} tokens remaining &middot; {budgetData.requestCount} API calls this month
              </p>
            </div>
          )}

          {/* Seat Management (SME per-seat only) */}
          {seatData && seatData.billingModel === 'per_seat' && (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-6 mb-4">
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Team Seats</h2>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                    <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-gray-900 dark:text-white">
                      {seatData.usedSeats} of {seatData.paidSeats} seats used
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {seatData.availableSeats} seat{seatData.availableSeats !== 1 ? 's' : ''} available &middot; ${(seatData.seatPriceCents / 100).toFixed(0)}/seat/mo
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSeatChange('remove')}
                    disabled={seatLoading || seatData.paidSeats <= 3}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-30"
                    aria-label="Remove seat"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleSeatChange('add')}
                    disabled={seatLoading}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors disabled:opacity-50"
                    aria-label="Add seat"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Seat
                  </button>
                </div>
              </div>
              {/* Seat usage bar */}
              <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all"
                  style={{ width: `${seatData.paidSeats > 0 ? (seatData.usedSeats / seatData.paidSeats) * 100 : 0}%` }}
                />
              </div>
              {seatError && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-2 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {seatError}
                </p>
              )}
              {seatLoading && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 flex items-center gap-1">
                  <span className="w-3 h-3 border border-gray-400 border-t-primary-500 rounded-full animate-spin" />
                  Updating seats…
                </p>
              )}
            </div>
          )}

          {/* Top-up Balance */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-6 mb-4">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Token Top-ups</h2>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {topUpData ? formatTokens(topUpData.remainingTokens ?? 0) : '...'}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Bonus tokens remaining</p>
              </div>
              <button
                onClick={handleBuyTopUp}
                disabled={topUpLoading}
                className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white text-sm font-medium rounded-lg hover:bg-cyan-700 transition-colors disabled:opacity-50"
              >
                {topUpLoading ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                Buy More Tokens
              </button>
            </div>
          </div>

          {/* Plan Details */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-6">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Plan Features</h2>
            <ul className="space-y-3">
              {planFeatures.map((feature) => (
                <li key={feature} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                  {feature}
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        /* Unpaid — Upgrade Card */
        <div className="bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-xl shadow-sm p-6">
          <div className="text-center max-w-md mx-auto">
            <div className="w-14 h-14 rounded-2xl bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center mx-auto mb-4">
              <Zap className="w-7 h-7 text-primary-600 dark:text-primary-400" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Upgrade Your Plan</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              {trialDays !== null && trialDays > 0
                ? `Your trial ends in ${trialDays} day${trialDays !== 1 ? 's' : ''}. Subscribe to keep full access.`
                : 'Your trial has ended. Subscribe to restore full access to all features.'}
            </p>

            <Link
              to="/pricing"
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 bg-primary-600 text-white text-sm font-semibold rounded-lg hover:bg-primary-700 transition-colors"
            >
              <Crown className="w-4 h-4" />
              View Plans & Subscribe
            </Link>
          </div>
        </div>
      )}
    </div>
  );
};
