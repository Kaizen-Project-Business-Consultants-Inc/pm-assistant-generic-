import { Building2 } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * Shown to an account that isn't part of a company (other than the platform admin, who is
 * sent to the admin pages). Company data never lives in the shared database, so there is
 * nothing to show until someone invites them.
 */
export function NoCompanyPage() {
  return (
    <div className="max-w-lg mx-auto mt-16 p-6 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-center space-y-3" role="status">
      <Building2 className="w-10 h-10 mx-auto text-primary-600 dark:text-primary-400" aria-hidden="true" />
      <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">You're not part of a company yet</h1>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Projects, plans and reports belong to a company. Ask your company's admin to invite you, or contact support if you think this is wrong.
      </p>
      <p className="text-sm">
        <Link to="/settings" className="text-primary-600 dark:text-primary-400 underline">Your settings</Link>
        {' · '}
        <Link to="/help" className="text-primary-600 dark:text-primary-400 underline">Help</Link>
      </p>
    </div>
  );
}
