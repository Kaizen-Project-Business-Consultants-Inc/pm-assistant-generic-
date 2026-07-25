import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { AdminPageWrapper } from './AdminPageWrapper';
import { Save, Check, X } from 'lucide-react';

interface PricingConfig {
  tier: string;
  displayName: string;
  monthlyPriceCents: number;
  annualPriceCents: number;
  aiTokensMonthly: number;
  aiTokensLabel: string;
  aiTokensDescription: string | null;
  storageMb: number;
  storageLabel: string;
  viewerLimit: number;
  viewerLimitLabel: string;
  maxProjects: number;
  isPerSeat: boolean;
  minSeats: number;
  durationDays: number;
  highlight: boolean;
  stripeMonthlyPriceId: string | null;
  stripeAnnualPriceId: string | null;
  featuresJson: string[];
  sortOrder: number;
  isActive: boolean;
}

interface TierFeature {
  tier: string;
  featureKey: string;
  enabled: boolean;
}

const FEATURE_LABELS: Record<string, string> = {
  exports: 'CSV/PDF/XML Export',
  evm: 'EVM Dashboard & Forecasting',
  monte_carlo: 'Monte Carlo Simulation',
  auto_reschedule: 'AI Auto-Reschedule',
  resources: 'Resource Management',
  reports: 'Custom Report Builder',
  workflows: 'DAG Workflow Automation',
  portal: 'Stakeholder Portal',
  meeting_intelligence: 'Meeting Intelligence',
  nl_query: 'NL Query Engine',
  cross_project_intelligence: 'Cross-Project Intelligence',
  api_keys: 'API Access & Integrations',
};

const FEATURE_KEYS = Object.keys(FEATURE_LABELS);

function TierCard({ tier, onSave }: { tier: PricingConfig; onSave: (data: Partial<PricingConfig>) => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    displayName: tier.displayName,
    monthlyPriceCents: tier.monthlyPriceCents,
    annualPriceCents: tier.annualPriceCents,
    aiTokensMonthly: tier.aiTokensMonthly,
    aiTokensLabel: tier.aiTokensLabel,
    storageMb: tier.storageMb,
    storageLabel: tier.storageLabel,
    viewerLimit: tier.viewerLimit,
    viewerLimitLabel: tier.viewerLimitLabel,
    maxProjects: tier.maxProjects,
    minSeats: tier.minSeats,
    durationDays: tier.durationDays,
    highlight: tier.highlight,
    stripeMonthlyPriceId: tier.stripeMonthlyPriceId || '',
    stripeAnnualPriceId: tier.stripeAnnualPriceId || '',
  });

  const handleSave = () => {
    onSave(form);
    setEditing(false);
  };

  const field = (label: string, key: keyof typeof form, type: 'text' | 'number' = 'text') => (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">{label}</span>
      {editing ? (
        <input
          type={type}
          value={form[key] as string | number}
          onChange={(e) => setForm({ ...form, [key]: type === 'number' ? Number(e.target.value) : e.target.value })}
          className="w-32 text-right text-sm px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        />
      ) : (
        <span className="text-sm font-medium text-gray-900 dark:text-white">
          {type === 'number' && key.toString().includes('PriceCents')
            ? `$${(Number(form[key]) / 100).toFixed(2)}`
            : String(form[key])}
        </span>
      )}
    </div>
  );

  return (
    <div className={`rounded-xl border-2 p-5 ${tier.highlight ? 'border-primary-500' : 'border-gray-200 dark:border-gray-700'} bg-white dark:bg-gray-800`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white">{tier.displayName}</h3>
        <div className="flex gap-1">
          {editing ? (
            <>
              <button onClick={handleSave} className="p-1.5 rounded-lg bg-green-100 text-green-700 hover:bg-green-200 transition-colors" title="Save">
                <Check className="w-4 h-4" />
              </button>
              <button onClick={() => setEditing(false)} className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors" title="Cancel">
                <X className="w-4 h-4" />
              </button>
            </>
          ) : (
            <button onClick={() => setEditing(true)} className="px-3 py-1 rounded-lg text-xs font-medium bg-primary-100 text-primary-700 hover:bg-primary-200 transition-colors">
              Edit
            </button>
          )}
        </div>
      </div>
      <span className="inline-block px-2 py-0.5 rounded text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 mb-3">{tier.tier}</span>

      <div className="space-y-0.5 divide-y divide-gray-100 dark:divide-gray-700">
        {field('Display Name', 'displayName')}
        {field('Monthly (cents)', 'monthlyPriceCents', 'number')}
        {field('Annual (cents)', 'annualPriceCents', 'number')}
        {field('AI Tokens/mo', 'aiTokensMonthly', 'number')}
        {field('Tokens Label', 'aiTokensLabel')}
        {field('Storage (MB)', 'storageMb', 'number')}
        {field('Storage Label', 'storageLabel')}
        {field('Viewer Limit', 'viewerLimit', 'number')}
        {field('Viewer Label', 'viewerLimitLabel')}
        {field('Max Projects', 'maxProjects', 'number')}
        {field('Min Seats', 'minSeats', 'number')}
        {field('Duration Days', 'durationDays', 'number')}
        {field('Stripe Monthly ID', 'stripeMonthlyPriceId')}
        {field('Stripe Annual ID', 'stripeAnnualPriceId')}
      </div>

      {editing && (
        <label className="flex items-center gap-2 mt-3 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
          <input
            type="checkbox"
            checked={form.highlight}
            onChange={(e) => setForm({ ...form, highlight: e.target.checked })}
            className="rounded border-gray-300 dark:border-gray-600"
          />
          Show "Most Popular" badge
        </label>
      )}
    </div>
  );
}

function FeatureMatrix({
  tiers,
  features,
  onToggle,
}: {
  tiers: PricingConfig[];
  features: TierFeature[];
  onToggle: (tier: string, featureKey: string, enabled: boolean) => void;
}) {
  const getEnabled = (tier: string, key: string) => {
    const f = features.find((x) => x.tier === tier && x.featureKey === key);
    return f ? f.enabled : false;
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            <th className="pb-3 pr-4">Feature</th>
            {tiers.map((t) => (
              <th key={t.tier} className="pb-3 text-center">{t.displayName}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {FEATURE_KEYS.map((key) => (
            <tr key={key} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
              <td className="py-2.5 pr-4 text-gray-700 dark:text-gray-200">{FEATURE_LABELS[key]}</td>
              {tiers.map((t) => {
                const enabled = getEnabled(t.tier, key);
                return (
                  <td key={t.tier} className="py-2.5 text-center">
                    <button
                      onClick={() => onToggle(t.tier, key, !enabled)}
                      className={`w-8 h-5 rounded-full relative inline-flex items-center transition-colors ${
                        enabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
                      }`}
                    >
                      <span className={`absolute w-3.5 h-3.5 rounded-full bg-white shadow-sm transform transition-transform ${
                        enabled ? 'translate-x-3.5' : 'translate-x-0.5'
                      }`} />
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdminPricingPage() {
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-pricing'],
    queryFn: () => apiService.getAdminPricing(),
  });

  const updateTier = useMutation({
    mutationFn: ({ tier, data: d }: { tier: string; data: Record<string, unknown> }) =>
      apiService.updateAdminPricing(tier, d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-pricing'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const updateFeature = useMutation({
    mutationFn: ({ tier, features }: { tier: string; features: Record<string, boolean> }) =>
      apiService.updateAdminFeatures(tier, features),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-pricing'] });
    },
  });

  if (isLoading) return <AdminPageWrapper title="Pricing Configuration" subtitle="Loading..."><div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading pricing config...</div></AdminPageWrapper>;
  if (error) return <AdminPageWrapper title="Pricing Configuration" subtitle="Error"><div className="text-center py-12 text-red-500">Failed to load pricing configuration.</div></AdminPageWrapper>;

  const tiers: PricingConfig[] = data?.tiers ?? [];
  const features: TierFeature[] = data?.features ?? [];

  return (
    <AdminPageWrapper title="Pricing Configuration" subtitle="Manage tier pricing, feature gating, and Stripe configuration">
      {saved && (
        <div className="mb-4 flex items-center gap-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 text-sm text-green-800 dark:text-green-300">
          <Save className="w-4 h-4" />
          Pricing configuration saved. Changes take effect immediately.
        </div>
      )}

      {/* Tier cards */}
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Tier Configuration</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {tiers.map((t) => (
          <TierCard
            key={t.tier}
            tier={t}
            onSave={(d) => updateTier.mutate({ tier: t.tier, data: d })}
          />
        ))}
      </div>

      {/* Feature gating matrix */}
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Feature Gating</h2>
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <FeatureMatrix
          tiers={tiers}
          features={features}
          onToggle={(tier, key, enabled) =>
            updateFeature.mutate({ tier, features: { [key]: enabled } })
          }
        />
      </div>
    </AdminPageWrapper>
  );
}
