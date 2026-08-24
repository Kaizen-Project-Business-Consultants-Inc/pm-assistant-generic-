import React from 'react';
import { PublicNavbar } from '../components/layout/PublicNavbar';
import { PublicFooter } from '../components/layout/PublicFooter';
import { PRIVACY_EMAIL } from '../constants/branding';

export const PrivacyPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-800">
      <PublicNavbar />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-8">Privacy Policy</h1>
        <div className="prose max-w-none text-sm text-gray-600 dark:text-gray-300 space-y-6">
          <p><strong>Last updated:</strong> July 2026</p>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mt-8">1. Information We Collect</h2>
          <p><strong>Account information:</strong> Name, email address, username, and password (hashed) when you register.</p>
          <p><strong>Project data:</strong> Projects, tasks, schedules, and other content you create within the Service.</p>
          <p><strong>Payment information:</strong> Billing details are processed by Stripe. We do not store your credit card numbers.</p>
          <p><strong>Waitlist information:</strong> If you join our pre-launch waitlist, we collect your email address. Waitlist emails are stored securely and used solely to notify you when the Service launches. Waitlist data is deleted within 30 days of launch. To request removal from the waitlist before launch, contact {PRIVACY_EMAIL}.</p>
          <p><strong>Usage data:</strong> We collect information about how you use the Service, including pages visited, features used, session duration, device type, browser type, IP address, and referring URL. This data is collected via Google Analytics only if you consent (see Section 8).</p>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mt-8">2. How We Use Your Information</h2>
          <p>We use your information to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Provide and maintain the Service</li>
            <li>Process payments and manage subscriptions</li>
            <li>Send transactional emails (verification, password reset, billing, trial reminders)</li>
            <li>Analyze usage patterns to improve the Service</li>
            <li>Respond to support requests</li>
          </ul>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mt-8">3. AI Data Processing</h2>
          <p>When you use AI features, your project data may be sent to Anthropic for processing. AI conversations and generated content may be stored to improve response quality. You can disable AI features via your account settings.</p>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mt-8">4. Data Sharing</h2>
          <p>We do not sell your personal data. We share data only with the following third-party service providers, all of which are based in the United States:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Stripe</strong> (San Francisco, CA): Payment processing and subscription management</li>
            <li><strong>Resend</strong> (San Francisco, CA): Transactional email delivery</li>
            <li><strong>Anthropic</strong> (San Francisco, CA): AI feature processing</li>
            <li><strong>Google Analytics</strong> (Mountain View, CA): Website usage analytics</li>
          </ul>
          <p>By using the Service, you consent to the transfer of data to these US-based providers. Each provider is bound by their own privacy policies and data processing agreements.</p>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mt-8">5. Data Security</h2>
          <p>We implement industry-standard security measures including encrypted connections (HTTPS/TLS), hashed passwords (bcrypt), secure HTTP-only cookies for authentication, rate limiting, and regular security updates.</p>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mt-8">6. Data Retention</h2>
          <p>Your data is retained as long as your account is active. Upon account deletion, your personal data and project data will be permanently deleted within 30 days. Anonymized, aggregated analytics data may be retained indefinitely.</p>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mt-8">7. Your Rights</h2>
          <p>You have the right to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Access your personal data</li>
            <li>Correct inaccurate data</li>
            <li>Export your data (via Settings &gt; Data Export)</li>
            <li>Delete your account and data (via Settings &gt; Account)</li>
            <li>Opt out of non-essential communications</li>
            <li>Opt out of analytics tracking (see Section 8)</li>
          </ul>
          <p>To exercise these rights, contact us at {PRIVACY_EMAIL} or use the self-service options in your account settings.</p>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mt-8">8. Cookies and Analytics</h2>
          <p><strong>Essential cookies:</strong> We use secure, HTTP-only cookies for authentication and session management. These are strictly necessary for the Service to function.</p>
          <p><strong>Analytics cookies (consent required):</strong> We use Google Analytics 4 (GA4) to understand how visitors use our website. <strong>GA4 is only loaded after you explicitly consent</strong> via the cookie consent banner shown on your first visit. If you decline, no analytics cookies are set and no usage data is collected.</p>
          <p>If you consent, GA4 sets the following cookies:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><code>_ga</code> — Distinguishes unique visitors (expires: 2 years)</li>
            <li><code>_ga_*</code> — Maintains session state (expires: 2 years)</li>
          </ul>
          <p>Google Analytics collects anonymized usage data including pages visited, session duration, device type, browser, approximate location (country/city level from IP address), and referring website. This data is processed by Google in the United States.</p>
          <p><strong>Changing your preference:</strong> You can change your analytics consent at any time by clearing your browser's local storage for this site (which resets the consent banner), or by installing the <a href="https://tools.google.com/dlpage/gaoptout" className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:text-primary-300" target="_blank" rel="noopener noreferrer">Google Analytics Opt-out Browser Add-on</a>.</p>
          <p>We do not use advertising cookies or sell data to advertisers.</p>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mt-8">9. International Data Transfers</h2>
          <p>The Service is hosted in Canada (Oracle Cloud, Toronto region). Your data may be transferred to the United States for processing by our third-party providers (Stripe, Resend, Anthropic, Google). We rely on the service providers' standard contractual clauses and privacy frameworks to protect your data during transfer.</p>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mt-8">10. Canadian Privacy Law (PIPEDA)</h2>
          <p>We comply with the Personal Information Protection and Electronic Documents Act (PIPEDA). We collect, use, and disclose personal information only for the purposes identified in this policy. You may withdraw consent at any time by deleting your account. For privacy inquiries or complaints, contact our Privacy Officer at {PRIVACY_EMAIL}.</p>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mt-8">11. Changes to This Policy</h2>
          <p>We may update this Privacy Policy from time to time. Material changes will be communicated via email or in-app notification at least 14 days before taking effect.</p>

          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mt-8">12. Contact</h2>
          <p>For privacy-related questions, contact our Privacy Officer at {PRIVACY_EMAIL}.</p>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
};
