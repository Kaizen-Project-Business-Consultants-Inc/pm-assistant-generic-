import React from 'react';
import { Link } from 'react-router-dom';

export const PublicFooter: React.FC = () => (
  <footer className="bg-gray-50 dark:bg-gray-900 border-t border-gray-100 dark:border-gray-700">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-center space-x-6 text-sm text-gray-500 dark:text-gray-400">
        <Link to="/terms" className="hover:text-gray-900 dark:hover:text-white">Terms of Service</Link>
        <Link to="/privacy" className="hover:text-gray-900 dark:hover:text-white">Privacy Policy</Link>
        <Link to="/roadmap" className="hover:text-gray-900 dark:hover:text-white">Roadmap</Link>
      </div>
    </div>
  </footer>
);
