import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Crown, X } from 'lucide-react';

export function UpgradePrompt() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = () => setVisible(true);
    window.addEventListener('subscription-required', handler);
    return () => window.removeEventListener('subscription-required', handler);
  }, []);

  if (!visible) return null;

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
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Subscription Required</h3>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-6">
            Your trial has ended. Subscribe to the Consultant plan to continue creating and editing.
          </p>
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
              View Plans
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
