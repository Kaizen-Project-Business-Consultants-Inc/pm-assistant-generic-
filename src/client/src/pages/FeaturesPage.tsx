import { Link } from 'react-router-dom';
import { PublicNavbar } from '../components/layout/PublicNavbar';
import { PublicFooter } from '../components/layout/PublicFooter';
import { useSEO } from '../hooks/useSEO';

const features = [
  {
    title: 'AI Scheduling & Predictive Planning',
    description: 'Describe your project scope and Kovarti generates a complete work breakdown structure with tasks, durations, and predecessor links in seconds. The AI scheduling engine builds optimized timelines using predictive scheduling — not static Gantt charts that go stale the moment something changes. Drag to adjust, and the engine recalculates the critical path and flags conflicts automatically.',
    keywords: ['AI scheduling', 'predictive scheduling', 'automatic task generation'],
  },
  {
    title: 'Project Timeline Prediction with Monte Carlo',
    description: 'Stop guessing when your project will finish. Kovarti runs Monte Carlo simulations — thousands of randomized scenarios — to forecast your real completion date at P50, P80, and P95 confidence levels. Project timeline prediction backed by data, not optimism. See the probability distribution, identify which tasks carry the most schedule risk, and make informed commitments to stakeholders.',
    keywords: ['project timeline prediction', 'Monte Carlo simulations'],
  },
  {
    title: 'Dependency Mapping & Critical Path',
    description: 'Define finish-to-start, start-to-start, finish-to-finish, or start-to-finish relationships with lag days. Dependency mapping is built into every view — Gantt chart, network diagram, and table. The engine validates every link (no circular dependencies, no orphans) and calculates the critical path so you know exactly which tasks drive your end date. Up to 20 predecessors per task with per-link type and lag.',
    keywords: ['dependency mapping', 'critical path analysis'],
  },
  {
    title: 'Mjuzi — Your AI PM Assistant',
    description: 'Mjuzi is the AI PM assistant built into every page. Ask it to create tasks, scan for risks, generate status reports, or explain what\'s driving your schedule variance — and it takes action using your real project data. Mjuzi remembers your preferences, learns from corrections, and integrates findings from autonomous risk and resource scanners that run in the background. Voice input and spoken replies supported.',
    keywords: ['AI PM assistant', 'natural language queries'],
  },
  {
    title: 'Earned Value Management (EVM)',
    description: 'Full EVM dashboard with CPI, SPI, EAC, TCPI, and Estimate at Completion forecasting. S-curve charts show planned vs earned vs actual cost over time. Variance Pareto identifies the biggest cost and schedule offenders. What-if simulator lets you model recovery scenarios. Management reserve tracking and schedule-aware AI corrective actions round out the toolkit.',
    keywords: ['earned value management', 'EVM', 'S-curve'],
  },
  {
    title: 'Meeting Intelligence & Automatic Task Generation',
    description: 'Upload a meeting transcript (Otter.ai, Teams, Zoom) and Kovarti extracts action items, decisions, risks, and dependencies. Automatic task generation turns those items into tracked tasks with assignees and due dates — no manual data entry. Send formatted meeting minutes by email. Import action items into your RAID log with duplicate detection.',
    keywords: ['automatic task generation', 'meeting intelligence'],
  },
  {
    title: 'Portfolio Dashboard & Health Monitoring',
    description: 'See every project\'s health, CPI, and SPI on one dashboard. Morning briefing surfaces overdue tasks, budget alerts, high risks, and upcoming milestones. Drill into any project for detailed analytics. Project grouping and folders keep large portfolios organized. Smart risk detection runs daily and flags issues before they escalate.',
    keywords: ['portfolio dashboard', 'project health'],
  },
  {
    title: 'Resource Management & Leveling',
    description: 'Assign resources to tasks with allocation percentages. Workload heatmaps show who is over-allocated across projects. One-click resource leveling resolves conflicts by shifting task dates. Capacity planning by role shows 12-week demand vs supply. Overtime rate tracking, calendar templates, and cross-project workload views give you full control.',
    keywords: ['resource management', 'resource leveling'],
  },
  {
    title: 'Agile, Waterfall & Hybrid',
    description: 'Choose your methodology and the entire interface adapts. Waterfall projects get Gantt charts, baselines, and EVM. Agile projects get sprint boards, backlogs, velocity charts, burnup/burndown, retrospective boards, and standup logging. Hybrid projects get both. Switch methodologies at any time — your data carries over.',
    keywords: ['agile', 'waterfall', 'hybrid'],
  },
  {
    title: 'Import from MS Project & Excel',
    description: 'Import Excel (.xlsx/.xls), CSV, or MS Project XML (MSPDI) files. The smart column mapper uses Microsoft Project conventions — recognizing Task Name, Finish, Resource Names, % Complete, Duration, and more. Three-layer auto-mapping (exact alias, fuzzy match, AI suggestion) means your columns are mapped correctly on the first try. Skip columns you don\'t need.',
    keywords: ['MS Project import', 'Excel import'],
  },
];

export function FeaturesPage() {
  useSEO({
    title: 'Features — Kovarti PM | AI Project Management Platform',
    description: 'Explore Kovarti PM features: AI scheduling, predictive scheduling, dependency mapping, automatic task generation, Monte Carlo simulations, EVM, and an AI PM assistant.',
    canonical: '/features',
  });

  return (
    <div className="min-h-screen bg-[#0a0f1a] text-white">
      <PublicNavbar />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        <div className="text-center mb-16">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight">
            Features of the{' '}
            <span className="bg-gradient-to-r from-primary-400 to-cyan-400 bg-clip-text text-transparent">
              AI Project Management Platform
            </span>
          </h1>
          <p className="mt-5 text-lg text-slate-300 max-w-2xl mx-auto">
            Everything you need to plan, track, and deliver — powered by AI scheduling, predictive analytics, and intelligent automation.
          </p>
        </div>

        <div className="space-y-12">
          {features.map((feature, i) => (
            <section key={i} className="rounded-2xl p-6 sm:p-8 border border-white/5" style={{ background: 'rgba(255,255,255,0.02)' }}>
              <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">{feature.title}</h2>
              <p className="text-slate-300 leading-relaxed text-[15px]">{feature.description}</p>
              <div className="flex flex-wrap gap-2 mt-4">
                {feature.keywords.map((kw) => (
                  <span key={kw} className="text-xs font-medium text-cyan-400 bg-cyan-400/10 px-2.5 py-1 rounded-full">{kw}</span>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="text-center mt-16">
          <Link
            to="/register"
            className="inline-block text-[15px] font-bold text-white bg-gradient-to-br from-primary-500 to-cyan-400 hover:from-primary-600 hover:to-cyan-500 px-8 py-4 rounded-xl transition-all shadow-lg shadow-primary-500/35"
          >
            Start Your Free 14-Day Trial
          </Link>
          <p className="mt-4 text-sm text-slate-400">No credit card required</p>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}

export default FeaturesPage;
