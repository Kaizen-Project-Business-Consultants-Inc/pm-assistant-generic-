import { Link } from 'react-router-dom';
import { PublicNavbar } from '../components/layout/PublicNavbar';
import { PublicFooter } from '../components/layout/PublicFooter';
import { useSEO } from '../hooks/useSEO';

export function AboutPage() {
  useSEO({
    title: 'About — Kovarti PM | AI Project Management Platform',
    description: 'Kovarti PM is an AI project management platform built by project managers for project managers. Learn about our mission, team, and why we built Kovarti.',
  });

  return (
    <div className="min-h-screen bg-[#0a0f1a] text-white">
      <PublicNavbar />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-center mb-6">
          About{' '}
          <span className="bg-gradient-to-r from-primary-400 to-cyan-400 bg-clip-text text-transparent">
            Kovarti PM
          </span>
        </h1>
        <p className="text-lg text-slate-300 text-center max-w-2xl mx-auto mb-16">
          Built by project managers who got tired of tools that couldn't keep up.
        </p>

        <div className="space-y-12 text-slate-300 leading-relaxed text-[15px]">
          <section>
            <h2 className="text-xl sm:text-2xl font-bold text-white mb-4">Why We Built Kovarti</h2>
            <p className="mb-4">
              Project management software hasn't changed much in 20 years. You still manually build Gantt charts, chase people for status updates, and find out about problems after they've already derailed your timeline. We built Kovarti because we believe AI can do better.
            </p>
            <p className="mb-4">
              Kovarti is an AI project management platform that combines the scheduling depth of MS Project and Primavera P6 with modern AI capabilities — predictive scheduling, automatic task generation, intelligent risk detection, and a conversational AI PM assistant that actually understands your project data.
            </p>
            <p>
              The result is a platform where the AI does the heavy lifting — generating task breakdowns, mapping dependencies, forecasting timelines, and surfacing risks — so project managers can focus on decisions, not data entry.
            </p>
          </section>

          <section>
            <h2 className="text-xl sm:text-2xl font-bold text-white mb-4">Our Mission</h2>
            <p>
              Make enterprise-grade project management accessible to every team. Whether you're a solo consultant managing three client projects or a PMO running a portfolio of 50, Kovarti gives you the same AI-powered scheduling, dependency mapping, earned value management, and project timeline prediction that Fortune 500 companies rely on — without the six-figure license fees or month-long implementations.
            </p>
          </section>

          <section>
            <h2 className="text-xl sm:text-2xl font-bold text-white mb-4">Who We Serve</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-6">
              {[
                { role: 'Project Managers', desc: 'Replace spreadsheets and outdated tools with AI scheduling, predictive analytics, and earned value management.' },
                { role: 'Consultants', desc: 'Manage multiple client engagements with portfolio dashboards, branded status reports, and stakeholder portals.' },
                { role: 'Team Leads', desc: 'Run sprints, assign resources, approve timesheets, and keep your team on pace with real-time visibility.' },
                { role: 'Small & Mid-Size Businesses', desc: 'Get MS Project-grade scheduling with automatic task generation and dependency mapping — without the complexity.' },
                { role: 'PMOs & Enterprises', desc: 'Portfolio-level health monitoring, cross-project resource planning, and Monte Carlo forecasting across all programs.' },
                { role: 'Founders & Startups', desc: 'Plan product launches, coordinate cross-functional work, and forecast delivery dates with AI-powered confidence.' },
              ].map((item) => (
                <div key={item.role} className="rounded-xl p-5 border border-white/5" style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <h3 className="font-semibold text-white mb-2">{item.role}</h3>
                  <p className="text-sm text-slate-400">{item.desc}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-xl sm:text-2xl font-bold text-white mb-4">What Sets Us Apart</h2>
            <ul className="space-y-3">
              {[
                'AI that acts, not just reports — Mjuzi creates tasks, reschedules work, and scans for risks on your behalf.',
                'Predictive scheduling with Monte Carlo — know your real finish date, not the one in your optimistic plan.',
                'Full EVM built in — CPI, SPI, S-curves, TCPI, and variance analysis without a separate tool.',
                'Meeting intelligence — upload a transcript and get tasks, decisions, and risks extracted automatically.',
                'Multi-methodology — waterfall, agile, and hybrid all supported. Switch anytime.',
                'Dependency mapping at depth — 4 link types, lag days, up to 20 predecessors per task, with visual arrows and critical path.',
                'Affordable — starts at $19/month. No per-seat surprises on basic plans.',
              ].map((point, i) => (
                <li key={i} className="flex gap-3">
                  <svg className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <polyline points="20 6 9 17 4 12" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-xl sm:text-2xl font-bold text-white mb-4">Behind Kovarti</h2>
            <p className="mb-4">
              Kovarti is built by <strong className="text-white">Kovarti Project & Business Consulting</strong> — a team with decades of combined experience in project delivery, business consulting, and software engineering. We've managed infrastructure programs, IT transformations, and construction projects across the Caribbean and North America.
            </p>
            <p>
              We built the tool we wished we'd had on those projects. Every feature comes from real pain points — not a product roadmap designed in a vacuum.
            </p>
          </section>
        </div>

        <div className="text-center mt-16">
          <Link
            to="/register"
            className="inline-block text-[15px] font-bold text-white bg-gradient-to-br from-primary-500 to-cyan-400 hover:from-primary-600 hover:to-cyan-500 px-8 py-4 rounded-xl transition-all shadow-lg shadow-primary-500/35"
          >
            Start Your Free 14-Day Trial
          </Link>
          <p className="mt-4 text-sm text-slate-400">
            <Link to="/features" className="text-cyan-400 hover:text-cyan-300 transition-colors">Explore all features</Link>
            {' '}&middot;{' '}
            <Link to="/pricing" className="text-cyan-400 hover:text-cyan-300 transition-colors">See pricing</Link>
          </p>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}

export default AboutPage;
