import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Crown, X } from 'lucide-react';

interface BlockDetail {
  message?: string;
  awaitingPayment?: boolean;
}

const TIER_ONLY_FALLBACK = 'Your trial has ended. Subscribe to continue creating and editing.';

export function UpgradePrompt() {
  const [visible, setVisible] = useState(false);
  const [detail, setDetail] = useState<BlockDetail | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      setDetail((e as CustomEvent).detail ?? null);
      setVisible(true);
    };
    window.addEventListener('subscription-required', handler);
    return () => window.removeEventListener('subscription-required', handler);
  }, []);

  if (!visible) return null;

  // Awaiting payment is a different situation from an ended trial: nothing has
  // expired, they simply never finished checkout. Saying "your trial has ended" to
  // someone who never had a trial is both confusing and wrong.
  const awaitingPayment = !!detail?.awaitingPayment;
  const heading = awaitingPayment ? 'Payment Required' : 'Subscription Required';
  const body = detail?.message || TIER_ONLY_FALLBACK;
  const ctaLabel = awaitingPayment ? 'Complete Checkout' : 'View Plans';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 max-w-md mx-4 relative">
        <button
          onClick={() => setVisible(false)}
          className="absolute top-3 right-3 p-1 text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center mx-auto mb-4">
            <Crown className="w-6 h-6 text-amber-600 dark:text-amber-400" />
          </div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">{heading}</h3>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-6">{body}</p>
          <div className="flex gap-3">
            <button
              onClick={() => setVisible(false)}
              className="flex-1 py-2.5 px-4 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              Dismiss
            </button>
            <Link
              to="/pricing"
              onClick={() => setVisible(false)}
              className="flex-1 py-2.5 px-4 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors text-center"
            >
              {ctaLabel}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
