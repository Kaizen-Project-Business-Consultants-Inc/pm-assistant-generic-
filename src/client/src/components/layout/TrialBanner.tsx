import { Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { Crown } from 'lucide-react';

export function TrialBanner() {
  const { user } = useAuthStore();

  if (!user) return null;

  const tier = user.subscriptionTier || 'trial';
  const status = user.subscriptionStatus || 'none';

  // Don't show for paid users, admins, or viewers
  if (tier === 'consultant_basic' || tier === 'consultant_pro' || tier === 'sme' || tier === 'enterprise') return null;
  if (user.role === 'admin') return null;
  if (user.role === 'viewer') return null;

  // Don't show for active trials (check trialEndsAt for app-managed trials)
  if (status === 'trialing' || status === 'active') return null;
  if (user.trialEndsAt && new Date(user.trialEndsAt) > new Date()) return null;

  return (
    <div className="bg-amber-500 text-white text-center py-2.5 px-4 text-sm font-medium flex items-center justify-center gap-3">
      <span>Subscribe to a plan to unlock all features.</span>
      <Link
        to="/pricing"
        className="inline-flex items-center gap-1.5 px-3 py-1 bg-white text-amber-700 text-xs font-semibold rounded-full hover:bg-amber-50 transition-colors"
      >
        <Crown className="w-3 h-3" />
        Upgrade
      </Link>
    </div>
  );
}
