import React from 'react';
import { PublicNavbar } from '../components/layout/PublicNavbar';
import { UserGuideContent } from './UserGuidePage';

export const UserGuidePublicPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-800">
      <PublicNavbar />

      <div className="px-4 sm:px-6 lg:px-8 py-16">
        <UserGuideContent />
      </div>
    </div>
  );
};
