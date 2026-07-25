import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, FolderPlus, Upload, ArrowRight } from 'lucide-react';
import { useModal } from '../../hooks/useModal';

const ONBOARDING_KEY = 'pm-generic-onboarding-seen';

export function WelcomeModal() {
  const [visible, setVisible] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Show if first login and hasn't been dismissed
    const seen = localStorage.getItem(ONBOARDING_KEY);
    if (seen) return;

    // Check if this was a first login (set by LoginPage)
    const isFirst = sessionStorage.getItem('pm-first-login');
    if (isFirst) {
      setVisible(true);
      sessionStorage.removeItem('pm-first-login');
    }
  }, []);

  const dismiss = () => {
    setVisible(false);
    localStorage.setItem(ONBOARDING_KEY, 'true');
  };

  const goToProjects = () => {
    dismiss();
    navigate('/projects');
  };

  const { dialogRef, handleKeyDown } = useModal(visible, dismiss);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Welcome to Kovarti PM" onKeyDown={handleKeyDown} tabIndex={-1} className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8 max-w-lg mx-4 w-full">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/20">
            <Sparkles className="w-7 h-7 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Welcome to Kovarti PM!</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            Your 14-day free trial is active. Let's get you started.
          </p>
        </div>

        <div className="space-y-3 mb-6">
          <button
            onClick={goToProjects}
            className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-900/20 hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors text-left group"
          >
            <div className="w-10 h-10 rounded-lg bg-primary-100 dark:bg-primary-800 flex items-center justify-center flex-shrink-0">
              <FolderPlus className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">Create a Project</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Start from a template or build from scratch</p>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-primary-600 transition-colors flex-shrink-0" />
          </button>

          <button
            onClick={goToProjects}
            className="w-full flex items-center gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left group"
          >
            <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
              <Upload className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">Import a Schedule</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Upload CSV or Excel from MS Project or other tools</p>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors flex-shrink-0" />
          </button>
        </div>

        <button
          onClick={dismiss}
          className="w-full py-2.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          I'll explore on my own
        </button>
      </div>
    </div>
  );
}
