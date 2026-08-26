import React from 'react';
import { PublicNavbar } from '../components/layout/PublicNavbar';
import { PublicFooter } from '../components/layout/PublicFooter';

interface RoadmapItem {
  name: string;
  description: string;
  status: 'Shipped' | 'In Progress' | 'Planned';
}

interface Quarter {
  label: string;
  period: string;
  items: RoadmapItem[];
}

const quarters: Quarter[] = [
  {
    label: 'Q3 2026',
    period: 'September — Launch',
    items: [
      { name: 'Launch on kovarti.com', description: 'Full production release on September 1, 2026.', status: 'In Progress' },
      { name: 'Stripe live billing', description: 'Credit card payments, subscription management, and invoicing.', status: 'In Progress' },
      { name: 'Founders 20% discount', description: 'Early adopters lock in 20% off annual Pro plans for life.', status: 'In Progress' },
    ],
  },
  {
    label: 'Q4 2026',
    period: 'October — December',
    items: [
      { name: 'Slack integration', description: 'Real-time project notifications and a /kovarti slash command for quick updates.', status: 'Planned' },
      { name: 'Google Calendar sync', description: 'Automatically sync milestones and deadlines to your Google Calendar.', status: 'Planned' },
      { name: 'Automation gallery', description: '15+ pre-built workflow templates to automate repetitive project tasks.', status: 'Planned' },
      { name: 'Push notifications', description: 'Browser push notifications so you never miss a task update.', status: 'Planned' },
      { name: 'Gantt dependency drag-to-create', description: 'Visually link tasks by dragging between bars on the Gantt chart.', status: 'Planned' },
    ],
  },
  {
    label: 'Q1 2027',
    period: 'January — March',
    items: [
      { name: 'Microsoft Teams integration', description: 'Notifications and a Teams bot for project updates without leaving chat.', status: 'Planned' },
      { name: 'Outlook calendar sync', description: 'Sync milestones and deadlines to Outlook via Microsoft Graph API.', status: 'Planned' },
      { name: 'Guest collaborator role', description: 'Invite external stakeholders with limited, read-only access to specific projects.', status: 'Planned' },
      { name: 'Mobile PWA improvements', description: 'Offline support and camera-based attachments for field teams.', status: 'Planned' },
      { name: 'Time-in-status metrics', description: 'Cycle time and lead time charts to identify bottlenecks.', status: 'Planned' },
    ],
  },
  {
    label: 'Q2 2027',
    period: 'April — June',
    items: [
      { name: 'Native mobile app', description: 'Dedicated iOS and Android apps for on-the-go project management.', status: 'Planned' },
      { name: 'Voice interface for Mjuzi AI', description: 'Talk to your AI assistant — speech-to-text input and text-to-speech responses.', status: 'Planned' },
      { name: 'Zoom/Teams transcript auto-pull', description: 'Automatically import meeting transcripts via OAuth integrations.', status: 'Planned' },
      { name: 'Advanced resource management', description: 'Skills matrix, cost rates, and capacity forecasting.', status: 'Planned' },
      { name: 'Public API & developer docs', description: 'RESTful API with full documentation for custom integrations.', status: 'Planned' },
      { name: 'Community template marketplace', description: 'Share and discover workflow templates built by the community.', status: 'Planned' },
    ],
  },
];

const statusColors: Record<RoadmapItem['status'], string> = {
  'Shipped': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  'In Progress': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  'Planned': 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
};

const timelineColors = [
  'border-blue-500',
  'border-indigo-500',
  'border-purple-500',
  'border-pink-500',
];

export const RoadmapPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-800 flex flex-col">
      <PublicNavbar />

      <main className="flex-1">
        {/* Hero */}
        <div className="bg-gradient-to-br from-primary-600 to-primary-800 text-white py-16">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h1 className="text-4xl font-bold mb-4">Product Roadmap</h1>
            <p className="text-lg text-primary-100 max-w-2xl mx-auto">
              See what we're building next. Our roadmap is shaped by customer feedback — the features you need most get built first.
            </p>
          </div>
        </div>

        {/* Legend */}
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-wrap gap-4 justify-center">
            {(['Shipped', 'In Progress', 'Planned'] as const).map((status) => (
              <span key={status} className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${statusColors[status]}`}>
                {status}
              </span>
            ))}
          </div>
        </div>

        {/* Timeline */}
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
          <div className="space-y-12">
            {quarters.map((quarter, qi) => (
              <div key={quarter.label} className={`border-l-4 ${timelineColors[qi % timelineColors.length]} pl-6 sm:pl-8`}>
                <div className="mb-4">
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{quarter.label}</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{quarter.period}</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {quarter.items.map((item) => (
                    <div key={item.name} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{item.name}</h3>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${statusColors[item.status]}`}>
                          {item.status}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-300">{item.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="bg-gray-50 dark:bg-gray-900 py-12">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">Have a feature request?</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">We'd love to hear what matters most to you.</p>
            <a href="mailto:support@kovarti.com" className="inline-flex items-center px-6 py-3 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 transition-colors">
              Email Us
            </a>
          </div>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
};
