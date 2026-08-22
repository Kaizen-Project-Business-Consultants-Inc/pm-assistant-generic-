import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';


const features = [
  {
    title: 'AI-Powered Scheduling',
    description: 'Generate task breakdowns, dependencies, and optimized timelines in seconds.',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    color: 'from-amber-400 to-orange-500',
  },
  {
    title: 'Monte Carlo Simulations',
    description: 'Probabilistic risk analysis that tells you exactly how confident to be in your timeline.',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
    color: 'from-emerald-400 to-teal-500',
  },
  {
    title: 'Smart Risk Detection',
    description: 'AI monitors your projects 24/7 and alerts you before delays become disasters.',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
      </svg>
    ),
    color: 'from-rose-400 to-pink-500',
  },
  {
    title: 'Meeting Intelligence',
    description: 'Paste a transcript, get action items and project updates extracted instantly.',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
      </svg>
    ),
    color: 'from-violet-400 to-purple-500',
  },
  {
    title: 'Portfolio Dashboard',
    description: 'One view. Every project. Health scores, budgets, and timelines at a glance.',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
      </svg>
    ),
    color: 'from-sky-400 to-blue-500',
  },
  {
    title: 'Natural Language Queries',
    description: 'Ask "Which projects are at risk this quarter?" and get answers — not a dashboard.',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
      </svg>
    ),
    color: 'from-cyan-400 to-primary-500',
  },
];

const LAUNCH_DATE = new Date('2026-09-01T00:00:00Z');

function useCountdown(target: Date) {
  const calc = () => {
    const diff = Math.max(0, target.getTime() - Date.now());
    return {
      days: Math.floor(diff / (1000 * 60 * 60 * 24)),
      hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
      minutes: Math.floor((diff / (1000 * 60)) % 60),
      seconds: Math.floor((diff / 1000) % 60),
    };
  };
  const [time, setTime] = useState(calc);
  useEffect(() => {
    const id = setInterval(() => setTime(calc()), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

function CountdownUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="w-20 h-20 sm:w-24 sm:h-24 bg-slate-800/80 border border-white/10 rounded-2xl flex items-center justify-center backdrop-blur-sm">
        <span className="text-3xl sm:text-4xl font-bold text-white tabular-nums">
          {String(value).padStart(2, '0')}
        </span>
      </div>
      <span className="mt-2 text-xs font-medium text-primary-300 uppercase tracking-widest">{label}</span>
    </div>
  );
}

function HeroMockup() {
  const [health, setHealth] = useState(0);
  const [bars, setBars] = useState<number[]>([42, 58, 70, 84, 95, 88, 72, 54, 60, 46, 34, 24]);

  useEffect(() => {
    const target = 82;
    let v = 0;
    const ct = setInterval(() => {
      v = Math.min(target, v + 3);
      setHealth(v);
      if (v >= target) clearInterval(ct);
    }, 28);
    return () => clearInterval(ct);
  }, []);

  useEffect(() => {
    const bt = setInterval(() => {
      setBars(
        Array.from({ length: 12 }, (_, i) => {
          const base = 95 * Math.exp(-Math.pow((i - 5.2) / 3.4, 2));
          const jitter = Math.random() * 20 - 10;
          return Math.max(22, Math.min(98, Math.round(base + jitter)));
        })
      );
    }, 3500);
    return () => clearInterval(bt);
  }, []);

  return (
    <div className="relative" style={{ animation: 'hfloat 6s ease-in-out infinite' }}>
      <div className="absolute -inset-8 blur-xl" style={{ background: 'radial-gradient(circle at 60% 40%, rgba(34,211,238,0.18), transparent 60%)' }} />
      <div className="relative rounded-2xl overflow-hidden shadow-2xl" style={{ background: 'linear-gradient(160deg, #111a2e, #0f1626)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 30px 70px rgba(0,0,0,0.5)', padding: 18 }}>
        <div className="flex items-center gap-1.5 pb-3.5 px-1">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
          <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
          <span className="ml-2.5 text-xs text-slate-500" style={{ fontFamily: "'JetBrains Mono', monospace" }}>portfolio · health</span>
          <span className="ml-auto inline-flex items-center gap-1.5 text-[10.5px] font-semibold text-green-400 px-2 py-0.5 rounded-full" style={{ background: 'rgba(74,222,128,0.12)' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" style={{ animation: 'hpulse 1.6s ease-in-out infinite' }} />
            Live
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {[
            { label: 'Health', value: `${health}%`, color: '#4ade80' },
            { label: 'On track', value: '7/10', color: '#f8fafc' },
            { label: 'CPI', value: '0.94', color: '#fbbf24' },
          ].map((kpi) => (
            <div key={kpi.label} className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-[11px] text-slate-500 m-0">{kpi.label}</p>
              <p className="text-[22px] font-extrabold mt-1 m-0 tabular-nums" style={{ color: kpi.color }}>{kpi.value}</p>
            </div>
          ))}
        </div>
        <div className="mt-2.5 rounded-xl p-3.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-slate-300 m-0">Delivery confidence</p>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-cyan-400" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              Monte Carlo
              <span className="w-1 h-1 rounded-full bg-cyan-400" style={{ animation: 'hpulse 1.6s ease-in-out infinite' }} />
            </span>
          </div>
          <div className="flex items-end gap-1.5 h-[88px]">
            {bars.map((h, i) => (
              <span
                key={i}
                className="flex-1 rounded-t"
                style={{
                  background: 'linear-gradient(180deg, #3b82f6, #22d3ee)',
                  height: `${h}%`,
                  opacity: 0.4 + 0.6 * (h / 100),
                  transition: 'height 1s cubic-bezier(0.34,1.2,0.64,1), opacity 1s ease',
                }}
              />
            ))}
          </div>
        </div>
        <div className="flex gap-2.5 mt-2.5 rounded-xl p-3" style={{ background: 'rgba(59,130,246,0.14)', border: '1px solid rgba(59,130,246,0.25)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5">
            <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1h6c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" />
            <path d="M9 18h6M10 22h4" />
          </svg>
          <p className="text-[12.5px] text-blue-100 m-0 leading-snug">
            <strong className="text-white">AI insight:</strong> City Fiber Rollout is trending 6 days late — reforecast recommended.
          </p>
        </div>
      </div>
    </div>
  );
}

function SchedulingMockup() {
  return (
    <svg viewBox="0 0 360 200" className="w-full h-full">
      <rect width="360" height="200" fill="#1e293b" />
      <text x="16" y="26" fill="#94a3b8" fontSize="12" fontFamily="system-ui">Project Timeline</text>
      <text x="16" y="54" fill="#cbd5e1" fontSize="11" fontFamily="system-ui">Design</text>
      <text x="16" y="82" fill="#cbd5e1" fontSize="11" fontFamily="system-ui">Backend</text>
      <text x="16" y="110" fill="#cbd5e1" fontSize="11" fontFamily="system-ui">Frontend</text>
      <text x="16" y="138" fill="#cbd5e1" fontSize="11" fontFamily="system-ui">Testing</text>
      <text x="16" y="166" fill="#cbd5e1" fontSize="11" fontFamily="system-ui">Deploy</text>
      <rect x="90" y="42" width="0" height="16" rx="3" fill="#3b82f6" opacity="0.9"><animate attributeName="width" from="0" to="90" dur="0.6s" begin="0.2s" fill="freeze" /></rect>
      <rect x="130" y="70" width="0" height="16" rx="3" fill="#60a5fa" opacity="0.9"><animate attributeName="width" from="0" to="130" dur="0.7s" begin="0.5s" fill="freeze" /></rect>
      <rect x="175" y="98" width="0" height="16" rx="3" fill="#06b6d4" opacity="0.9"><animate attributeName="width" from="0" to="110" dur="0.6s" begin="0.9s" fill="freeze" /></rect>
      <rect x="240" y="126" width="0" height="16" rx="3" fill="#22d3ee" opacity="0.9"><animate attributeName="width" from="0" to="70" dur="0.5s" begin="1.3s" fill="freeze" /></rect>
      <rect x="295" y="154" width="0" height="16" rx="3" fill="#67e8f9" opacity="0.9"><animate attributeName="width" from="0" to="40" dur="0.4s" begin="1.6s" fill="freeze" /></rect>
      <path d="M180 58 L180 70" stroke="#64748b" strokeWidth="1" fill="none" strokeDasharray="3,2" opacity="0"><animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="0.8s" fill="freeze" /></path>
      <path d="M260 86 L260 98" stroke="#64748b" strokeWidth="1" fill="none" strokeDasharray="3,2" opacity="0"><animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="1.2s" fill="freeze" /></path>
      <text x="310" y="26" fill="#22d3ee" fontSize="12" opacity="0">✦ AI<animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="0.1s" fill="freeze" /></text>
    </svg>
  );
}

function RiskDetectionMockup() {
  return (
    <svg viewBox="0 0 360 200" className="w-full h-full">
      <rect width="360" height="200" fill="#1e293b" />
      <text x="16" y="26" fill="#94a3b8" fontSize="12" fontFamily="system-ui">Risk Scanner</text>
      <rect x="0" y="34" width="360" height="2" fill="#3b82f6" opacity="0">
        <animate attributeName="opacity" values="0;0.6;0" dur="1.5s" begin="0.2s" />
        <animate attributeName="y" from="34" to="190" dur="1.5s" begin="0.2s" fill="freeze" />
      </rect>
      {[
        { y: 46, text1: 'Budget overrun — Phase 2 at 23% over', severity: '#ef4444', tag: 'HIGH' },
        { y: 86, text1: 'Resource conflict — 3 devs double-booked', severity: '#f97316', tag: 'MED' },
        { y: 126, text1: 'Dependency delay — API blocked by vendor', severity: '#ef4444', tag: 'HIGH' },
        { y: 166, text1: 'Scope creep — 12 unplanned tasks added', severity: '#eab308', tag: 'LOW' },
      ].map((risk, i) => (
        <g key={i} opacity="0">
          <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin={`${0.6 + i * 0.5}s`} fill="freeze" />
          <rect x="14" y={risk.y} width="6" height="24" rx="2" fill={risk.severity} />
          <text x="28" y={risk.y + 15} fill="#e2e8f0" fontSize="10" fontFamily="system-ui">{risk.text1}</text>
          <rect x="300" y={risk.y + 3} width="40" height="18" rx="9" fill={risk.severity} opacity="0.2" />
          <text x="310" y={risk.y + 15} fill={risk.severity} fontSize="9" fontWeight="bold" fontFamily="system-ui">{risk.tag}</text>
        </g>
      ))}
    </svg>
  );
}

function PortfolioMockup() {
  const projects = [
    { name: 'Website Redesign', health: 92, color: '#10b981', w: 250 },
    { name: 'Mobile App v2', health: 67, color: '#f97316', w: 182 },
    { name: 'Data Migration', health: 85, color: '#10b981', w: 232 },
    { name: 'API Platform', health: 45, color: '#ef4444', w: 122 },
  ];
  return (
    <svg viewBox="0 0 360 200" className="w-full h-full">
      <rect width="360" height="200" fill="#1e293b" />
      <text x="16" y="26" fill="#94a3b8" fontSize="12" fontFamily="system-ui">Portfolio Health</text>
      {projects.map((p, i) => (
        <g key={i} opacity="0">
          <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin={`${0.2 + i * 0.3}s`} fill="freeze" />
          <text x="16" y={56 + i * 42} fill="#e2e8f0" fontSize="11" fontFamily="system-ui">{p.name}</text>
          <rect x="16" y={62 + i * 42} width="280" height="10" rx="5" fill="#334155" />
          <rect x="16" y={62 + i * 42} width="0" height="10" rx="5" fill={p.color}>
            <animate attributeName="width" from="0" to={String(p.w)} dur="0.8s" begin={`${0.4 + i * 0.3}s`} fill="freeze" />
          </rect>
          <text x="304" y={72 + i * 42} fill={p.color} fontSize="11" fontWeight="bold" fontFamily="system-ui" opacity="0">
            {p.health}%
            <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin={`${0.8 + i * 0.3}s`} fill="freeze" />
          </text>
        </g>
      ))}
    </svg>
  );
}

const featureMockups: Record<string, React.FC> = {
  'AI-Powered Scheduling': SchedulingMockup,
  'Smart Risk Detection': RiskDetectionMockup,
  'Portfolio Dashboard': PortfolioMockup,
};

export const PrelaunchLandingPage: React.FC = () => {
  const countdown = useCountdown(LAUNCH_DATE);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setStatus('loading');
    try {
      const res = await fetch('/api/v1/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus('error');
        setMessage(data.error || 'Something went wrong. Please try again.');
      } else {
        setStatus('success');
        setMessage(data.message || "You're on the list!");
        setEmail('');
      }
    } catch {
      setStatus('error');
      setMessage('Could not connect. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white overflow-x-hidden">
      <style>{`
        @keyframes hfloat { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-7px) } }
        @keyframes hpulse { 0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(74,222,128,0.6) } 50% { opacity: .5; box-shadow: 0 0 0 5px rgba(74,222,128,0) } }
      `}</style>
      {/* Ambient background */}
      <div className="fixed inset-0 -z-10 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[700px] bg-primary-600/20 rounded-full blur-[120px]" />
        <div className="absolute top-1/3 left-0 w-[500px] h-[500px] bg-purple-600/10 rounded-full blur-[100px]" />
        <div className="absolute top-1/3 right-0 w-[400px] h-[400px] bg-cyan-600/10 rounded-full blur-[100px]" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-violet-600/10 rounded-full blur-[100px]" />
      </div>

      {/* Announcement bar */}
      <div className="bg-gradient-to-r from-primary-600 via-violet-600 to-purple-600 py-2.5 px-4 text-center text-sm font-medium text-white">
        <span className="mr-2">🎉</span>
        Join the waitlist now and get <span className="font-bold underline underline-offset-2">20% off</span> when we launch — limited spots available.
        <span className="ml-2">🚀</span>
      </div>

      {/* Nav */}
      <nav className="border-b border-white/5 backdrop-blur-md bg-slate-950/60 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-between items-center h-16">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-purple-600 rounded-lg flex items-center justify-center shadow-lg shadow-primary-900">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <span className="text-lg font-bold">Kovarti</span>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-16 sm:pt-20 pb-20 px-4 sm:px-6 lg:px-8" style={{ background: 'radial-gradient(1200px 600px at 50% -8%, rgba(59,130,246,0.12), transparent 60%)' }}>
        <div className="max-w-[1200px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-14 items-center">
          {/* Left: Copy */}
          <div className="text-center lg:text-left">
            <div className="mb-8 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary-500/15 border border-primary-500/40">
              <span className="w-2.5 h-2.5 rounded-full bg-primary-400 animate-pulse" />
              <span className="text-lg font-bold text-primary-300 tracking-wide uppercase">Coming Soon</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-[60px] font-extrabold tracking-tight leading-tight">
              <span className="text-white">Project Management</span>
              <br />
              <span className="bg-gradient-to-r from-primary-400 via-violet-400 to-purple-400 bg-clip-text text-transparent">
                Finally Gets AI
              </span>
            </h1>

            <p className="mt-6 text-lg text-slate-400 max-w-[520px] mx-auto lg:mx-0 leading-relaxed">
              Intelligent scheduling. Risk prediction. Monte Carlo simulations. Meeting intelligence.
              <br className="hidden sm:block" />
              <span className="text-slate-300 font-medium">The PM tool that thinks before you ask.</span>
            </p>

            <div className="flex items-center gap-3.5 mt-8 justify-center lg:justify-start">
              <a
                href="#waitlist"
                className="text-[15px] font-bold text-white bg-gradient-to-br from-primary-500 to-purple-600 hover:from-primary-600 hover:to-purple-700 px-7 py-3.5 rounded-xl transition-all shadow-lg shadow-primary-900 hover:shadow-xl hover:-translate-y-0.5"
              >
                Join the Waitlist
              </a>
            </div>

            {/* Countdown */}
            <div className="mt-10">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Launching in</p>
              <div className="flex justify-center lg:justify-start gap-3 sm:gap-4">
                <CountdownUnit value={countdown.days} label="Days" />
                <CountdownUnit value={countdown.hours} label="Hours" />
                <CountdownUnit value={countdown.minutes} label="Minutes" />
                <CountdownUnit value={countdown.seconds} label="Seconds" />
              </div>
            </div>
          </div>

          {/* Right: Product Mockup */}
          <div className="w-full max-w-md mx-auto lg:max-w-none">
            <HeroMockup />
          </div>
        </div>
      </section>

      {/* Social proof strip */}
      <section className="py-10 border-y border-white/5">
        <div className="max-w-4xl mx-auto px-4 flex flex-wrap justify-center gap-8 sm:gap-16 text-center">
          {[
            { label: 'AI features built-in', value: '15+' },
            { label: 'Risk detection models', value: '3' },
            { label: 'Avg. time saved per PM', value: '6 hrs/wk' },
            { label: 'Accuracy on delay forecasts', value: '94%' },
          ].map(stat => (
            <div key={stat.label}>
              <div className="text-2xl sm:text-3xl font-extrabold bg-gradient-to-r from-primary-400 to-purple-400 bg-clip-text text-transparent">{stat.value}</div>
              <div className="text-xs text-slate-500 mt-1 uppercase tracking-wide">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white">What's inside</h2>
            <p className="mt-4 text-lg text-slate-300">Every feature you've wished your PM tool had.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map(feature => {
              const Mockup = featureMockups[feature.title];
              return (
                <div
                  key={feature.title}
                  className="group relative bg-slate-900 hover:bg-slate-800 border border-slate-700/50 hover:border-slate-600 rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1"
                >
                  <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${feature.color} p-0.5 mb-4`}>
                    <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center text-white">
                      {feature.icon}
                    </div>
                  </div>
                  <h3 className="text-base font-semibold text-white mb-2">{feature.title}</h3>
                  <p className="text-sm text-slate-300 leading-relaxed">{feature.description}</p>
                  {Mockup && (
                    <div className="mt-4 rounded-xl overflow-hidden ring-1 ring-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500">
                      <Mockup />
                    </div>
                  )}
                  <div className={`absolute bottom-0 left-6 right-6 h-0.5 rounded-t-full bg-gradient-to-r ${feature.color} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section id="waitlist" className="py-20 px-4 sm:px-6 lg:px-8 scroll-mt-16">
        <div className="max-w-2xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 mb-6">
            <span className="text-sm font-medium text-purple-300">Limited early access spots</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            Don't manage projects the old way.
          </h2>
          <p className="text-slate-400 mb-8 text-lg">
            Join the waitlist and get 20% off your first year — exclusively for early supporters.
          </p>
          {status === 'success' ? (
            <div className="max-w-md mx-auto bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-8 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-emerald-400 font-bold text-xl mb-2">You're on the list!</p>
              <p className="text-slate-400 text-sm">We'll email you the moment we go live with your exclusive 20% discount. See you at launch.</p>
            </div>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  className="flex-1 bg-white dark:bg-gray-800/5 border border-white/10 rounded-xl px-4 py-3.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm transition-all"
                />
                <button
                  type="submit"
                  disabled={status === 'loading'}
                  className="px-6 py-3.5 bg-gradient-to-r from-primary-600 to-purple-600 hover:from-primary-500 hover:to-purple-500 disabled:opacity-60 text-white font-semibold rounded-xl transition-all shadow-lg shadow-primary-900 text-sm whitespace-nowrap"
                >
                  {status === 'loading' ? 'Joining...' : 'Reserve My Spot'}
                </button>
              </form>
              {status === 'error' && <p className="mt-3 text-rose-400 text-xs">{message}</p>}
              <p className="mt-5 text-xs text-slate-600">No spam. Unsubscribe anytime. Your discount is held for 7 days after launch.</p>
            </>
          )}
        </div>
      </section>

      {/* Pricing Preview */}
      <section className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-white">Simple, transparent pricing</h2>
            <p className="mt-4 text-lg text-slate-400">Start free. Upgrade when you're ready.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                name: 'Consultant Basic',
                price: '$19',
                period: '/mo',
                desc: 'Core PM — no AI',
                features: ['Unlimited projects', 'Gantt, Kanban, Sprints', 'RAID management', 'Exports (CSV, PDF, XML)', 'API access', '5 viewer invites'],
              },
              {
                name: 'Consultant Pro',
                price: '$29',
                period: '/mo',
                desc: 'Everything + AI',
                highlight: true,
                features: ['Everything in Basic', 'Mjuzi AI assistant (500K/mo)', 'AI risk scans & forecasting', 'EVM & Monte Carlo', 'Meeting intelligence', 'NL query engine'],
              },
              {
                name: 'SME',
                price: '$33',
                period: '/seat/mo',
                desc: 'Teams of 3+',
                features: ['Everything in Pro', '500K AI tokens/seat', '5GB storage', 'Unlimited viewers', 'Resource heatmaps', 'Cross-project intelligence'],
              },
            ].map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-2xl p-6 transition-all ${
                  plan.highlight
                    ? 'bg-slate-800 border-2 border-primary-500 shadow-xl shadow-primary-500/10'
                    : 'bg-slate-900 border border-slate-700/50'
                }`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="bg-primary-600 text-white text-xs font-bold px-3 py-1 rounded-full">Recommended</span>
                  </div>
                )}
                <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                <p className="text-xs text-slate-500 mt-1">{plan.desc}</p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-3xl font-extrabold text-white">{plan.price}</span>
                  <span className="text-sm text-slate-400">{plan.period}</span>
                </div>
                <ul className="mt-5 space-y-2">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                      <svg className="w-4 h-4 text-primary-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-slate-600 mt-8">
            14-day free trial with Pro features. No credit card required.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-10 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-gradient-to-br from-primary-500 to-purple-600 rounded flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-white">Kovarti</span>
          </div>
          <div className="flex gap-6 text-sm text-slate-500">
            <a href="mailto:sales@kovarti.com" className="hover:text-white transition-colors">sales@kovarti.com</a>
            <Link to="/terms" className="hover:text-white transition-colors">Terms</Link>
            <Link to="/privacy" className="hover:text-white transition-colors">Privacy</Link>
          </div>
          <div className="text-xs text-slate-600">&copy; {new Date().getFullYear()} Kovarti. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};
