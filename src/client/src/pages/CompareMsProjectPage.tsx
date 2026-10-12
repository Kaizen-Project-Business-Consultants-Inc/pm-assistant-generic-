import { Link } from 'react-router-dom';
import { PublicNavbar } from '../components/layout/PublicNavbar';
import { PublicFooter } from '../components/layout/PublicFooter';
import { useSEO } from '../hooks/useSEO';
import { useFromPrice, formatFromPrice } from '../hooks/useFromPrice';
import { ROUTES } from '../routes';

/**
 * "Kovarti vs Microsoft Project vs Asana" (user OK 2026-10-12, mock
 * https://claude.ai/artifact/JTTxTPhkPhCC7hEL85xfMX). Honest and dated: facts about the other products
 * come only from their own public pages, checked on the date below — re-check every quarter, and drop
 * any row that can no longer be confirmed. Our own prices come from the pricing settings.
 */
const CHECKED_ON = 'October 2026';

interface Row { need: string; kovarti: string; msProject: string; asana: string }

/** A claim about another product that isn't on its own pricing or plan page is said exactly so — never "not built in" */
const NOT_LISTED = 'Not listed on its plan page';

const ROWS: Row[] = [
  { need: 'Free trial', kovarti: '7 days, every Pro feature, no card', msProject: '1 month, card required', asana: 'Free plan for 2 users; trial of paid plans, no card' },
  { need: 'Critical path, with finish-to-start, start-to-start, finish-to-finish and start-to-finish links and lags', kovarti: 'Yes', msProject: 'Yes', asana: 'Highlights the longest chain of linked tasks on its Timeline' },
  { need: 'Working-day calendars and holidays', kovarti: 'Yes', msProject: 'Yes (desktop app)', asana: NOT_LISTED },
  { need: 'Baselines and variance', kovarti: 'Yes', msProject: 'Yes (desktop app)', asana: NOT_LISTED },
  { need: 'Schedule quality check (a score, with DCMA-style rules)', kovarti: 'Yes — Schedule Review', msProject: NOT_LISTED, asana: NOT_LISTED },
  { need: 'RAID log (risks, actions, issues, decisions)', kovarti: 'Built in', msProject: NOT_LISTED, asana: NOT_LISTED },
  { need: 'Client status reports and a client portal', kovarti: 'Built in', msProject: NOT_LISTED, asana: 'Unlimited free guests' },
  { need: 'Earned value (CPI, SPI)', kovarti: 'Yes', msProject: 'Yes (desktop app)', asana: NOT_LISTED },
  { need: 'Resource levelling and workload', kovarti: 'Workload view and simple levelling', msProject: 'Full, mature resource engine', asana: 'Resource management (Advanced and up)' },
  { need: 'AI assistant', kovarti: 'Included on Pro (Mjuzi)', msProject: 'Copilot needs a separate Microsoft 365 Copilot licence', asana: 'Asana AI included, with monthly limits' },
  { need: 'Works in the browser, on Mac and Windows', kovarti: 'Yes', msProject: 'Web app; the desktop app is Windows only', asana: 'Yes' },
  { need: 'Opens MS Project (.mpp) files', kovarti: 'No .mpp — imports MS Project XML (Save As XML), Excel or CSV; exports MS Project XML', msProject: 'Yes', asana: NOT_LISTED },
  { need: 'Integrations', kovarti: 'Few so far; more coming', msProject: 'Deep Microsoft 365 integration', asana: 'Hundreds of apps' },
];

export function CompareMsProjectPage() {
  useSEO({
    title: 'Kovarti vs Microsoft Project vs Asana — an honest comparison | Kovarti PM',
    description: 'A Microsoft Project alternative for consultants and small PM teams: critical path, baselines, RAID and client reporting in the browser, with AI. Where Microsoft Project and Asana are the better choice, too.',
    canonical: ROUTES.compareMsProject,
  });
  const fromPrice = useFromPrice('yearly'); // compared with their "billed yearly" prices

  const headCell = 'px-4 sm:px-5 py-3 text-left text-sm font-semibold';
  const cell = 'px-4 sm:px-5 py-3 text-sm align-top';

  return (
    <div className="min-h-screen bg-white text-gray-900 dark:bg-[#0a0f1a] dark:text-white">
      <PublicNavbar />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-20 space-y-14">
        <header className="max-w-3xl space-y-4">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary-700 dark:text-primary-300">
            Kovarti vs Microsoft Project vs Asana · as of {CHECKED_ON}
          </p>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight">
            Microsoft Project depth, without the weight. Not another task board.
          </h1>
          <p className="text-lg text-gray-700 dark:text-slate-300">
            If you run client projects with real dates, dependencies and risks, you've probably used Microsoft Project — or tried
            to make Asana do it. Here's an honest look at where each fits, including where the others are the better choice.
          </p>
        </header>

        <section aria-labelledby="who-for" className="space-y-4">
          <h2 id="who-for" className="sr-only">Who each one is for</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl border-2 border-primary-600 p-5 space-y-2">
              <h3 className="text-lg font-bold">Kovarti</h3>
              <p className="text-sm text-gray-700 dark:text-slate-300">Consultants and small PM teams who need real schedules, RAID and client reporting — in the browser, with a schedule check built in and an AI assistant on Pro.</p>
            </div>
            <div className="rounded-xl border border-gray-300 dark:border-slate-700 p-5 space-y-2">
              <h3 className="text-lg font-bold">Microsoft Project</h3>
              <p className="text-sm text-gray-700 dark:text-slate-300">Large or complex programmes in Microsoft 365 companies, and schedulers who need the full desktop engine and .mpp files.</p>
            </div>
            <div className="rounded-xl border border-gray-300 dark:border-slate-700 p-5 space-y-2">
              <h3 className="text-lg font-bold">Asana</h3>
              <p className="text-sm text-gray-700 dark:text-slate-300">Teams coordinating everyday work and requests, where simplicity and integrations matter more than a critical path.</p>
            </div>
          </div>
        </section>

        <section aria-labelledby="price" className="space-y-3">
          <h2 id="price" className="text-xl sm:text-2xl font-bold">Price per person, per month (billed yearly)</h2>
          <ul className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <li className="rounded-xl bg-gray-100 dark:bg-slate-800/60 p-4">
              <span className="font-semibold">Kovarti:</span>{' '}
              {fromPrice !== null ? <>from {formatFromPrice(fromPrice)} — see <Link to={ROUTES.pricing} className="underline text-primary-700 dark:text-primary-300">pricing</Link></> : <Link to={ROUTES.pricing} className="underline text-primary-700 dark:text-primary-300">see pricing</Link>}
            </li>
            <li className="rounded-xl bg-gray-100 dark:bg-slate-800/60 p-4">
              <span className="font-semibold">Microsoft Project (Planner and Project Plan 3):</span> $30
            </li>
            <li className="rounded-xl bg-gray-100 dark:bg-slate-800/60 p-4">
              <span className="font-semibold">Asana:</span> Starter $10.99 · Advanced $24.99
            </li>
          </ul>
        </section>

        <section aria-labelledby="compare-table">
          <h2 id="compare-table" className="text-xl sm:text-2xl font-bold mb-4">What a project manager needs, side by side</h2>
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be focusable (WCAG 2.1.1): a keyboard user scrolls the table on a phone */}
          <div tabIndex={0} role="region" aria-labelledby="compare-table" className="overflow-x-auto rounded-xl border border-gray-300 dark:border-slate-700">
            <table className="w-full min-w-[720px] border-collapse">
              <caption className="sr-only">Kovarti, Microsoft Project (Plan 3) and Asana (Advanced) compared, as of {CHECKED_ON}</caption>
              <thead className="bg-gray-100 dark:bg-slate-800">
                <tr>
                  <th scope="col" className={`${headCell} w-[31%]`}><span className="sr-only">What you need</span></th>
                  <th scope="col" className={`${headCell} text-primary-800 dark:text-primary-300`}>Kovarti</th>
                  <th scope="col" className={headCell}>Microsoft Project (Plan 3)</th>
                  <th scope="col" className={headCell}>Asana (Advanced)</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.need} className="border-t border-gray-200 dark:border-slate-700">
                    <th scope="row" className={`${cell} text-left font-medium`}>{r.need}</th>
                    <td className={cell}>{r.kovarti}</td>
                    <td className={`${cell} text-gray-700 dark:text-slate-300`}>{r.msProject}</td>
                    <td className={`${cell} text-gray-700 dark:text-slate-300`}>{r.asana}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="choose-them" className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <h2 id="choose-them" className="sr-only">When the others are the better choice</h2>
          <div className="rounded-xl bg-gray-100 dark:bg-slate-800/60 p-6 space-y-3">
            <h3 className="text-lg font-bold">Choose Microsoft Project if…</h3>
            <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 dark:text-slate-300">
              <li>you run large programmes with hundreds of shared resources and need full levelling;</li>
              <li>clients send you .mpp files and expect them back;</li>
              <li>your company is all-in on Microsoft 365 and Teams.</li>
            </ul>
          </div>
          <div className="rounded-xl bg-gray-100 dark:bg-slate-800/60 p-6 space-y-3">
            <h3 className="text-lg font-bold">Choose Asana if…</h3>
            <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 dark:text-slate-300">
              <li>your work is mostly to-dos and requests, not dated plans;</li>
              <li>you need many integrations out of the box;</li>
              <li>a free plan for a very small team is the priority.</li>
            </ul>
          </div>
        </section>

        <section aria-labelledby="choose-kovarti" className="rounded-2xl bg-gray-900 text-white dark:bg-slate-800 p-8 space-y-4">
          <h2 id="choose-kovarti" className="text-2xl font-bold">Choose Kovarti if you need a real schedule, RAID and client reporting — and want to start today.</h2>
          <p className="text-slate-300 max-w-3xl">Bring your plan in from Excel, see the critical path, get a Schedule Review score in seconds, and send your client a status report this afternoon.</p>
          <div className="flex flex-wrap gap-3">
            <Link to={ROUTES.register} className="inline-flex items-center min-h-[44px] px-6 rounded-xl bg-primary-600 hover:bg-primary-700 font-semibold">
              Start your free 7-day trial
            </Link>
            <Link to={ROUTES.features} className="inline-flex items-center min-h-[44px] px-5 rounded-xl border border-slate-500 hover:bg-white/10 font-medium">
              See all features
            </Link>
          </div>
        </section>

        <p className="text-xs text-gray-600 dark:text-slate-400">
          Prices are list prices in US dollars per person per month, billed yearly. Facts about Microsoft Project and Asana come from
          microsoft.com and asana.com, checked in {CHECKED_ON}; &ldquo;{NOT_LISTED}&rdquo; means we couldn&rsquo;t find it there, not that it
          doesn&rsquo;t exist. Features change, so we re-check this page every quarter. Microsoft Project and Asana are trademarks of their
          owners; Kovarti isn&rsquo;t affiliated with them. Spotted something out of date?{' '}
          <a href="mailto:support@kovarti.com" className="underline">Tell us</a>.
        </p>
      </main>

      <PublicFooter />
    </div>
  );
}
