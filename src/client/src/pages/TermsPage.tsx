import React from 'react';
import { Link } from 'react-router-dom';

export const TermsPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-800">
      <nav className="border-b border-gray-100 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link to="/" className="flex items-center">
              <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <span className="ml-2 text-xl font-bold text-gray-900 dark:text-white">Kovarti PM</span>
            </Link>
          </div>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-8">Terms of Service</h1>
        <div className="prose max-w-none text-sm text-gray-600 dark:text-gray-300 space-y-6">
          <p><strong>Last updated:</strong> July 2026</p>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mt-8">1. Acceptance of Terms</h2>
          <p>By accessing or using Kovarti PM ("the Service"), operated by Kovarti Project & Business Consulting ("Kovarti," "we," "us"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.</p>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mt-8">2. Description of Service</h2>
          <p>Kovarti PM is an AI-powered project management application that provides scheduling, risk analysis, reporting, and collaboration tools. The Service is provided on a subscription basis with a free trial and paid tiers.</p>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mt-8">3. Account Registration</h2>
          <p>You must provide accurate, complete information when creating an account. You are responsible for maintaining the security of your account credentials. You must be at least 18 years old to use the Service.</p>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mt-8">4. Free Trial</h2>
          <p>New accounts receive a 14-day free trial with access to all features. No credit card is required to start a trial. When the trial ends, your account will be restricted to read-only access. Your data is preserved and full access is restored when you subscribe to a paid plan.</p>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mt-8">5. Subscription and Billing</h2>
          <p>Paid subscriptions are available on monthly and annual billing cycles. Payments are processed by Stripe. All prices are in USD.</p>
          <p><strong>Cancellation:</strong> You may cancel at any time from your account settings. Access continues until the end of your current billing period. No further charges will be made after cancellation.</p>
          <p><strong>Refunds:</strong> Monthly subscriptions are non-refundable. Annual subscriptions may be refunded on a pro-rated basis if requested within 30 days of the billing date. After 30 days, annual subscriptions are non-refundable. To request a refund, contact support@kpbc.ca.</p>
          <p><strong>Price changes:</strong> We may adjust pricing with at least 30 days' written notice. Price changes take effect at the start of your next billing period.</p>

          <div className="mt-8 rounded-lg border-2 border-amber-400 dark:border-amber-500 bg-amber-50 dark:bg-amber-900/20 p-5">
            <h2 className="text-lg font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              5A. AI Usage Limits and Token Budgets
            </h2>
            <div className="mt-3 space-y-3 text-sm text-amber-900 dark:text-amber-200">
              <p><strong>Monthly Token Allowances.</strong> Each subscription tier includes a monthly AI token budget: <strong>Pro</strong> — 500,000 tokens; <strong>Business</strong> — 1,500,000 tokens; <strong>Consultant</strong> — 3,000,000 tokens. Free trial accounts receive 25,000 tokens per month. Token budgets reset on the first day of each calendar month (UTC).</p>
              <p><strong>Budget Exhaustion.</strong> When your monthly AI token budget is fully consumed, all AI-powered features (including the Mjuzi assistant, AI risk scanning, AI forecasting, and AI-generated reports) will be temporarily unavailable until your budget resets or you purchase additional tokens. <strong>All non-AI features of the Service remain fully operational</strong> — scheduling, task management, reporting, collaboration, and data access are unaffected.</p>
              <p><strong>Token Top-Ups.</strong> You may purchase additional token packs at any time. Top-up tokens are added instantly to your available balance and <strong>do not expire</strong>. Top-up purchases are one-time payments, non-refundable, and are consumed only after your monthly tier allowance is exhausted. Current pricing: 500,000 tokens for $5 USD per pack.</p>
              <p><strong>Per-User Overrides.</strong> Kovarti may, at its discretion, adjust individual token budgets (higher or lower) based on usage patterns, enterprise agreements, or promotional offers. Any per-user override takes precedence over the tier default.</p>
              <p><strong>No Carry-Over.</strong> Unused monthly tier tokens do not carry over to the following month. Purchased top-up tokens are the only tokens that persist across billing cycles.</p>
              <p><strong>Fair Use.</strong> Token budgets are designed for normal project management workflows. Automated or programmatic consumption of AI tokens beyond reasonable use may result in temporary throttling or account review.</p>
            </div>
          </div>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mt-8">6. Acceptable Use</h2>
          <p>You agree not to misuse the Service, including but not limited to: reverse engineering, unauthorized access attempts, distributing malware, or using the Service for illegal purposes.</p>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mt-8">7. Data and Privacy</h2>
          <p>Your use of the Service is also governed by our <Link to="/privacy" className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:text-primary-300">Privacy Policy</Link>. You retain ownership of your data. We may use anonymized, aggregated data to improve the Service.</p>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mt-8">8. AI-Generated Content</h2>
          <p>The Service uses AI to generate suggestions, schedules, and analyses. AI outputs are provided as recommendations only and should not be relied upon as the sole basis for critical decisions. We do not guarantee the accuracy of AI-generated content.</p>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mt-8">9. Service Availability</h2>
          <p>We strive to maintain high availability but do not guarantee uninterrupted service. The Service is provided "as is" without uptime guarantees. Scheduled maintenance will be communicated in advance when possible.</p>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mt-8">10. Limitation of Liability</h2>
          <p>The Service is provided "as is" without warranties of any kind, express or implied. We are not liable for any indirect, incidental, or consequential damages arising from your use of the Service. Our total liability shall not exceed the amount you paid in the 12 months preceding the claim.</p>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mt-8">11. Termination</h2>
          <p>We may suspend or terminate your account for violations of these Terms. Upon termination, your right to use the Service ceases. You may export your data before termination. We will make reasonable efforts to provide notice before involuntary termination.</p>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mt-8">12. Governing Law</h2>
          <p>These Terms are governed by and construed in accordance with the laws of the Province of British Columbia, Canada. Any disputes arising from these Terms or your use of the Service shall be subject to the exclusive jurisdiction of the courts of British Columbia.</p>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mt-8">13. Dispute Resolution</h2>
          <p>Before pursuing formal legal action, you agree to first contact us at support@kpbc.ca to attempt to resolve the dispute informally. If the dispute cannot be resolved within 30 days, either party may pursue resolution through the courts of British Columbia.</p>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mt-8">14. Changes to Terms</h2>
          <p>We may update these Terms from time to time. Material changes will be communicated via email or in-app notification at least 14 days before taking effect. Continued use of the Service after changes constitutes acceptance of the new Terms.</p>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mt-8">15. Contact</h2>
          <p>For questions about these Terms, contact us at support@kpbc.ca.</p>
        </div>
      </div>

      <footer className="bg-gray-50 dark:bg-gray-900 border-t border-gray-100 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-center space-x-6 text-sm text-gray-500 dark:text-gray-400">
            <Link to="/terms" className="hover:text-gray-900 dark:text-white">Terms of Service</Link>
            <Link to="/privacy" className="hover:text-gray-900 dark:text-white">Privacy Policy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};
