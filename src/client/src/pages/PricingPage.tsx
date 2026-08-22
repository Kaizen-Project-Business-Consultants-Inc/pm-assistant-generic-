import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { apiService } from '../services/api';
import { Check, Zap, X } from 'lucide-react';
import { PricingCards, COMPARISON } from '../components/pricing/PricingCards';

export const PricingPage: React.FC = () => {
  const { isAuthenticated } = useAuthStore();
  const [loading, setLoading] = useState<string | null>(null);

  const handleBuyTokens = async () => {
    if (!isAuthenticated) {
      window.location.href = '/register';
      return;
    }
    setLoading('topup');
    try {
      const { url } = await apiService.createTopUpSession(1);
      window.location.href = url;
    } catch {
      setLoading(null);
    }
  };

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
                  <a href="#pricing" className="text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 px-4 py-2 rounded-lg transition-colors">
                    Choose a Plan
                  </a>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Pricing */}
      <section id="pricing" className="py-20 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h1 className="text-4xl font-bold text-white">Simple, transparent pricing</h1>
            <p className="mt-4 text-lg text-slate-300">
              Start free, upgrade when you need more power
            </p>
          </div>

          <PricingCards mode="checkout" />

          {/* Token top-up */}
          <div className="max-w-xl mx-auto mt-16">
            <div className="bg-amber-900/20 border border-amber-700 rounded-2xl p-6 text-center">
              <div className="flex items-center justify-center gap-2 mb-3">
                <Zap className="w-5 h-5 text-amber-400" />
                <h3 className="text-lg font-bold text-white">Need more AI tokens?</h3>
              </div>
              <p className="text-sm text-gray-300 mb-4">
                Top up anytime. <strong className="text-white">500K tokens for $5</strong> — added instantly to your balance.
              </p>
              <button
                onClick={handleBuyTokens}
                disabled={loading === 'topup'}
                className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
              >
                {loading === 'topup' ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Loading…
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    Buy Token Pack — $5
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Feature Comparison Matrix */}
          <div className="mt-20 mb-16">
            <h2 className="text-2xl font-bold text-white text-center mb-8">
              Compare plans
            </h2>
            <div className="overflow-x-auto flex justify-center">
              <table className="text-sm" style={{ maxWidth: '900px', width: '100%' }}>
                <thead>
                  <tr className="border-b-2 border-gray-700">
                    <th className="text-left py-3 pr-6 font-semibold text-white">Feature</th>
                    <th className="text-center py-3 px-3 font-semibold text-gray-400 w-20">Trial</th>
                    <th className="text-center py-3 px-3 font-semibold text-white w-20">Basic</th>
                    <th className="text-center py-3 px-3 font-semibold text-primary-400 w-20">Pro</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map((row, i) => (
                    <tr key={row.feature} className={`border-b border-gray-700/50 ${i % 2 === 0 ? 'bg-gray-800/50' : ''}`}>
                      <td className="py-2.5 pr-4 text-gray-300">{row.feature}</td>
                      {(['trial', 'consultant_basic', 'consultant_pro'] as const).map((tier) => {
                        const val = row[tier];
                        return (
                          <td key={tier} className="py-2.5 px-3 text-center">
                            {val === true ? (
                              <Check className="w-4 h-4 text-primary-500 mx-auto" />
                            ) : val === false ? (
                              <X className="w-4 h-4 text-gray-600 mx-auto" />
                            ) : (
                              <span className="text-gray-300 font-medium">{val}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Refund policy */}
          <details className="mt-12 text-center text-xs text-gray-500">
            <summary className="cursor-pointer hover:text-gray-300 transition-colors">Refund &amp; cancellation policy</summary>
            <div className="mt-2 space-y-1">
              <p>Monthly subscriptions are non-refundable. Cancel anytime.</p>
              <p>Annual subscriptions: pro-rated refund within 30 days, non-refundable after.</p>
              <p>Token top-ups are non-refundable and do not expire.</p>
              <p>Questions? <a href="mailto:support@kpbc.ca" className="text-primary-400 hover:underline">support@kpbc.ca</a></p>
            </div>
          </details>
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
