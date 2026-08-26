import React from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { PricingSection } from '../components/pricing/PricingCards';
import { useSEO } from '../hooks/useSEO';

export const PricingPage: React.FC = () => {
  const { isAuthenticated } = useAuthStore();

  useSEO({
    title: 'Pricing — Kovarti PM',
    description: 'Simple, transparent pricing. Free 14-day trial, Consultant Basic at $19/mo, Consultant Pro at $29/mo with AI features. No credit card required.',
    canonical: '/pricing',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Kovarti PM Pricing',
      description: 'Simple, transparent pricing for AI-powered project management.',
      mainEntity: {
        '@type': 'SoftwareApplication',
        name: 'Kovarti PM',
        offers: [
          { '@type': 'Offer', name: 'Free Trial', price: '0', priceCurrency: 'USD', description: '14-day free trial with all features' },
          { '@type': 'Offer', name: 'Consultant Basic', price: '19', priceCurrency: 'USD', billingIncrement: 'P1M' },
          { '@type': 'Offer', name: 'Consultant Pro', price: '29', priceCurrency: 'USD', billingIncrement: 'P1M' },
        ],
      },
    },
  });

  return (
    <div className="min-h-screen bg-[#0a0a0f] dark">
      {/* Navbar */}
      <nav className="border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link to="/" className="flex items-center">
              <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <span className="ml-2 text-xl font-bold text-white">Kovarti PM</span>
            </Link>
            <div className="flex items-center space-x-4">
              {isAuthenticated ? (
                <Link to="/dashboard" className="text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 px-4 py-2 rounded-lg transition-colors">
                  Dashboard
                </Link>
              ) : (
                <>
                  <Link to="/login" className="text-sm text-gray-300 hover:text-white">Sign In</Link>
                  <Link to="/register" className="text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 px-4 py-2 rounded-lg transition-colors">
                    Start Free Trial
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Pricing */}
      <section className="py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h1 className="text-4xl font-bold text-white">Simple, transparent pricing</h1>
            <p className="mt-4 text-lg text-slate-300">
              Try free for 14 days. Upgrade anytime.
            </p>
            <p className="mt-3 inline-flex items-center gap-2 text-sm text-green-400 font-medium">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
              30-day prorated refund guarantee on annual plans
            </p>
          </div>

          <PricingSection mode="checkout" forceDark />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-center space-x-6 text-sm text-gray-500">
            <Link to="/terms" className="hover:text-white transition-colors">Terms of Service</Link>
            <Link to="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};
