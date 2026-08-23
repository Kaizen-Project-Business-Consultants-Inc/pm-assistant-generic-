import { Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { Crown, Clock } from 'lucide-react';
import { isPaidTier } from '../../constants/branding';

export function TrialBanner() {
  const { user } = useAuthStore();

  if (!user) return null;

  const tier = user.subscriptionTier || 'trial';
  const status = user.subscriptionStatus || 'none';

  // Don't show for paid users, admins, or viewers
  if (isPaidTier(tier)) return null;
  if (user.role === 'admin') return null;
  if (user.role === 'viewer') return null;

  const trialEnd = user.trialEndsAt ? new Date(user.trialEndsAt) : null;
  const now = new Date();
  const trialActive = trialEnd && trialEnd > now;
  const daysLeft = trialEnd ? Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))) : 0;

  // Active trial — show friendly countdown
  if ((status === 'trialing' || status === 'active') && trialActive) {
    return (
      <div className="bg-primary-600 text-white text-center py-2 px-4 text-sm font-medium flex items-center justify-center gap-3">
        <Clock className="w-4 h-4 flex-shrink-0" />
        <span>
          {daysLeft > 7
            ? `You have ${daysLeft} days left on your free trial — explore all features!`
            : daysLeft > 1
              ? `${daysLeft} days left on your trial — upgrade to keep access.`
              : daysLeft === 1
                ? 'Last day of your trial — upgrade now to avoid interruption.'
                : 'Your trial ends today!'}
        </span>
        <Link
          to="/pricing"
          className="inline-flex items-center gap-1.5 px-3 py-1 bg-white text-primary-700 text-xs font-semibold rounded-full hover:bg-primary-50 transition-colors flex-shrink-0"
        >
          <Crown className="w-3 h-3" />
          View Plans
        </Link>
      </div>
    );
  }

  // Trial expired or no subscription
  return (
    <div className="bg-amber-500 text-white text-center py-2.5 px-4 text-sm font-medium flex items-center justify-center gap-3">
      <span>Your trial has ended. Subscribe to a plan to continue using Kovarti PM.</span>
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
