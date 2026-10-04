import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore, isPlatformAdmin } from '../../stores/authStore';
import { ShieldCheck } from 'lucide-react';

interface AdminPageWrapperProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}

export function AdminPageWrapper({ title, subtitle, children }: AdminPageWrapperProps) {
  const { user } = useAuthStore();

  if (!isPlatformAdmin(user)) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
          <ShieldCheck className="w-5 h-5 text-purple-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{title}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
        </div>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900/30 border border-gray-200 dark:border-gray-700 p-6">
        {children}
      </div>
    </div>
  );
}
