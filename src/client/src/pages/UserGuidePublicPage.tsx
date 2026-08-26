import React from 'react';
import { PublicNavbar } from '../components/layout/PublicNavbar';
import { UserGuideContent } from './UserGuidePage';
import { useSEO } from '../hooks/useSEO';

export const UserGuidePublicPage: React.FC = () => {
  useSEO({
    title: 'User Guide — Kovarti PM',
    description: 'Complete user guide for Kovarti PM. Learn how to manage projects, schedules, tasks, sprints, reports, and AI features.',
    canonical: '/guide',
  });

  return (
    <div className="min-h-screen bg-white dark:bg-gray-800">
      <PublicNavbar />

      <div className="px-4 sm:px-6 lg:px-8 py-16">
        <UserGuideContent />
      </div>
    </div>
  );
};
