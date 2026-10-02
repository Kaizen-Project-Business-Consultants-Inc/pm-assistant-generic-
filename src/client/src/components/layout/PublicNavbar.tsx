import React from 'react';
import { Link } from 'react-router-dom';
import { KovartiMark } from '../ui/KovartiMark';

export const PublicNavbar: React.FC = () => (
  <nav className="border-b border-gray-100 dark:border-gray-700">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="flex justify-between items-center h-16">
        <Link to="/" className="flex items-center">
          <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
            <KovartiMark className="w-5 h-5 text-white" />
          </div>
          <span className="ml-2 text-xl font-bold text-gray-900 dark:text-white">Kovarti PM</span>
        </Link>
        <div className="flex items-center space-x-4">
          <Link to="/features" className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white">Features</Link>
          <Link to="/about" className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white">About</Link>
          <Link to="/roadmap" className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white">Roadmap</Link>
        </div>
      </div>
    </div>
  </nav>
);
