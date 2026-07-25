import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { apiService } from '../services/api';

export const OnboardingPage: React.FC = () => {
  const { user, setUser } = useAuthStore();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [organizationName, setOrganizationName] = useState('');

  // Pre-fill username once user data loads
  useEffect(() => {
    if (user?.username && !username) {
      setUsername(user.username);
    }
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If profile is already complete, redirect to dashboard
  useEffect(() => {
    if (user?.fullName) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      await apiService.updateProfile({
        fullName,
        username: username !== user?.username ? username : undefined,
        organizationName: organizationName || undefined,
      });

      // Refresh user data from server
      const data = await apiService.getMe();
      if (data.user) {
        setUser(data.user);
      }

      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      setError(axiosError.response?.data?.message || 'Failed to save profile. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8">
          <div className="text-center mb-8">
            <div className="mx-auto w-12 h-12 bg-primary-100 dark:bg-primary-900/40 rounded-xl flex items-center justify-center mb-4">
              <span className="text-xl font-bold text-primary-600 dark:text-primary-400">K</span>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Welcome! Let's set up your profile</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Just a few details to get started</p>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              </div>
            )}

            <div>
              <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Full Name</label>
              <input id="fullName" type="text" required autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)}
                className="input" placeholder="John Doe" minLength={2} />
            </div>

            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Username</label>
              <input id="username" type="text" required autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                className="input" placeholder="johndoe" minLength={3} pattern="[a-zA-Z0-9_]+" />
              <p className="text-xs text-gray-400 mt-1">Letters, numbers, and underscores only</p>
            </div>

            <div>
              <label htmlFor="organizationName" className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                Organization Name <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input id="organizationName" type="text" autoComplete="organization" value={organizationName} onChange={(e) => setOrganizationName(e.target.value)}
                className="input" placeholder="Your company name" />
            </div>

            <button type="submit" disabled={isLoading}
              className="w-full flex justify-center py-2.5 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {isLoading ? (
                <div className="flex items-center">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  Saving...
                </div>
              ) : (
                'Complete Setup'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
