import React from 'react';
import { Link } from 'react-router-dom';
import { LOGO_SVG_PATH } from '../../constants/branding';

export const PublicNavbar: React.FC = () => (
  <nav className="border-b border-gray-100 dark:border-gray-700">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="flex justify-between items-center h-16">
        <Link to="/" className="flex items-center">
          <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={LOGO_SVG_PATH} />
            </svg>
          </div>
          <span className="ml-2 text-xl font-bold text-gray-900 dark:text-white">Kovarti PM</span>
        </Link>
      </div>
    </div>
  </nav>
);
