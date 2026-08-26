import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { LOGO_SVG_PATH, SALES_EMAIL } from '../constants/branding';
import { PricingSection } from '../components/pricing/PricingCards';
import { useSEO } from '../hooks/useSEO';


const features = [
  {
    title: 'Interactive Gantt Charts',
    description: 'Drag-and-drop scheduling with dependencies, critical path, resource leveling, and PDF export.',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h10M4 14h12M4 18h8" />
      </svg>
    ),
    color: 'from-blue-400 to-indigo-500',
  },
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
    title: 'Earned Value Management',
    description: 'CPI, SPI, EAC, and S-Curve charts with what-if simulation. Know exactly where your budget stands.',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    color: 'from-emerald-400 to-teal-500',
  },
  {
    title: 'Monte Carlo Simulations',
    description: 'Probabilistic risk analysis that tells you exactly how confident to be in your timeline.',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
    color: 'from-lime-400 to-green-500',
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

const LAUNCH_DATE = new Date(import.meta.env.VITE_LAUNCH_DATE ?? '2026-09-07T00:00:00Z');

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

function Countdown({ target }: { target: Date }) {
  const countdown = useCountdown(target);
  const isZero = countdown.days === 0 && countdown.hours === 0 && countdown.minutes === 0 && countdown.seconds === 0;

  if (isZero) {
    return (
      <div className="mt-10">
        <p className="text-lg font-bold text-primary-300">We're live! <a href="/register" className="underline hover:text-white">Get started now →</a></p>
      </div>
    );
  }

  return (
    <div className="mt-10">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Launching in</p>
      <div className="flex justify-center lg:justify-start gap-3 sm:gap-4">
        <CountdownUnit value={countdown.days} label="Days" />
        <CountdownUnit value={countdown.hours} label="Hours" />
        <CountdownUnit value={countdown.minutes} label="Minutes" />
        <CountdownUnit value={countdown.seconds} label="Seconds" />
      </div>
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
            Preview
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

function MonteCarloMockup() {
  return (
    <svg viewBox="0 0 360 200" className="w-full h-full">
      <rect width="360" height="200" fill="#1e293b" />
      <text x="16" y="26" fill="#94a3b8" fontSize="12" fontFamily="system-ui">Delivery Confidence</text>
      {/* Bell curve */}
      <path d="M40 170 Q80 168 120 150 Q160 110 180 60 Q200 110 220 150 Q260 168 300 170" fill="none" stroke="#10b981" strokeWidth="2" opacity="0">
        <animate attributeName="opacity" from="0" to="1" dur="0.6s" begin="0.3s" fill="freeze" />
      </path>
      <path d="M40 170 Q80 168 120 150 Q160 110 180 60 Q200 110 220 150 Q260 168 300 170 L300 170 L40 170 Z" fill="#10b981" opacity="0">
        <animate attributeName="opacity" from="0" to="0.15" dur="0.6s" begin="0.3s" fill="freeze" />
      </path>
      {/* P50 line */}
      <line x1="180" y1="55" x2="180" y2="170" stroke="#22d3ee" strokeWidth="1" strokeDasharray="4,3" opacity="0">
        <animate attributeName="opacity" from="0" to="0.8" dur="0.3s" begin="0.8s" fill="freeze" />
      </line>
      <text x="168" y="48" fill="#22d3ee" fontSize="10" fontFamily="system-ui" opacity="0">P50
        <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="0.8s" fill="freeze" />
      </text>
      {/* P85 line */}
      <line x1="230" y1="140" x2="230" y2="170" stroke="#f97316" strokeWidth="1" strokeDasharray="4,3" opacity="0">
        <animate attributeName="opacity" from="0" to="0.8" dur="0.3s" begin="1.1s" fill="freeze" />
      </line>
      <text x="218" y="135" fill="#f97316" fontSize="10" fontFamily="system-ui" opacity="0">P85
        <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="1.1s" fill="freeze" />
      </text>
      {/* Confidence label */}
      <rect x="100" y="176" width="160" height="20" rx="4" fill="#334155" opacity="0">
        <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="1.4s" fill="freeze" />
      </rect>
      <text x="115" y="190" fill="#10b981" fontSize="10" fontWeight="bold" fontFamily="system-ui" opacity="0">85% confidence by Mar 15
        <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="1.4s" fill="freeze" />
      </text>
    </svg>
  );
}

function MeetingMockup() {
  return (
    <svg viewBox="0 0 360 200" className="w-full h-full">
      <rect width="360" height="200" fill="#1e293b" />
      <text x="16" y="26" fill="#94a3b8" fontSize="12" fontFamily="system-ui">Meeting Intelligence</text>
      {/* Transcript lines */}
      {[
        { y: 44, speaker: 'Sarah:', text: '"We need to push the deadline..."', color: '#60a5fa' },
        { y: 68, speaker: 'Mike:', text: '"Budget is approved for Phase 2"', color: '#a78bfa' },
        { y: 92, speaker: 'Lisa:', text: '"QA found 3 blockers yesterday"', color: '#f472b6' },
      ].map((line, i) => (
        <g key={i} opacity="0">
          <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin={`${0.3 + i * 0.4}s`} fill="freeze" />
          <text x="16" y={line.y} fill={line.color} fontSize="10" fontWeight="bold" fontFamily="system-ui">{line.speaker}</text>
          <text x="60" y={line.y} fill="#cbd5e1" fontSize="10" fontFamily="system-ui">{line.text}</text>
        </g>
      ))}
      {/* Divider */}
      <line x1="16" y1="112" x2="344" y2="112" stroke="#475569" strokeWidth="1" opacity="0">
        <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="1.4s" fill="freeze" />
      </line>
      <text x="16" y="128" fill="#22d3ee" fontSize="10" fontFamily="system-ui" opacity="0">✦ Extracted Action Items
        <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="1.5s" fill="freeze" />
      </text>
      {/* Action items */}
      {[
        { y: 144, text: 'Revise project timeline — assigned to Sarah' },
        { y: 162, text: 'Allocate Phase 2 budget — assigned to Mike' },
        { y: 180, text: 'Triage QA blockers by Friday — assigned to Lisa' },
      ].map((item, i) => (
        <g key={i} opacity="0">
          <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin={`${1.7 + i * 0.3}s`} fill="freeze" />
          <rect x="16" y={item.y - 8} width="8" height="8" rx="2" fill="none" stroke="#10b981" strokeWidth="1.5" />
          <text x="30" y={item.y} fill="#e2e8f0" fontSize="9" fontFamily="system-ui">{item.text}</text>
        </g>
      ))}
    </svg>
  );
}

function GanttMockup() {
  const tasks = [
    { name: 'Planning', x: 90, w: 60, color: '#3b82f6', y: 42 },
    { name: 'Design', x: 150, w: 80, color: '#8b5cf6', y: 62 },
    { name: 'Development', x: 180, w: 120, color: '#06b6d4', y: 82 },
    { name: 'Testing', x: 260, w: 50, color: '#10b981', y: 102 },
    { name: 'Launch', x: 310, w: 30, color: '#f59e0b', y: 122 },
  ];
  return (
    <svg viewBox="0 0 360 200" className="w-full h-full">
      <rect width="360" height="200" fill="#1e293b" />
      <text x="16" y="26" fill="#94a3b8" fontSize="12" fontFamily="system-ui">Gantt Chart</text>
      {/* Grid lines */}
      {[90, 150, 210, 270, 330].map((x, i) => (
        <line key={i} x1={x} y1="34" x2={x} y2="180" stroke="#334155" strokeWidth="1" />
      ))}
      {/* Month headers */}
      {[{ x: 100, t: 'Jan' }, { x: 160, t: 'Feb' }, { x: 220, t: 'Mar' }, { x: 280, t: 'Apr' }].map((m, i) => (
        <text key={i} x={m.x} y="34" fill="#64748b" fontSize="9" fontFamily="system-ui">{m.t}</text>
      ))}
      {/* Tasks */}
      {tasks.map((t, i) => (
        <g key={i} opacity="0">
          <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin={`${0.2 + i * 0.25}s`} fill="freeze" />
          <text x="16" y={t.y + 12} fill="#cbd5e1" fontSize="10" fontFamily="system-ui">{t.name}</text>
          <rect x={t.x} y={t.y} width="0" height="14" rx="3" fill={t.color} opacity="0.9">
            <animate attributeName="width" from="0" to={String(t.w)} dur="0.5s" begin={`${0.3 + i * 0.25}s`} fill="freeze" />
          </rect>
        </g>
      ))}
      {/* Dependencies */}
      <path d="M150 56 L150 62" stroke="#64748b" strokeWidth="1" strokeDasharray="3,2" opacity="0">
        <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="1.0s" fill="freeze" />
      </path>
      <path d="M230 76 L230 82" stroke="#64748b" strokeWidth="1" strokeDasharray="3,2" opacity="0">
        <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="1.2s" fill="freeze" />
      </path>
      {/* Critical path highlight */}
      <rect x="14" y="148" width="332" height="28" rx="6" fill="#334155" opacity="0">
        <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="1.6s" fill="freeze" />
      </rect>
      <text x="24" y="166" fill="#f97316" fontSize="10" fontWeight="bold" fontFamily="system-ui" opacity="0">Critical Path: Design → Development → Testing (152d)
        <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="1.7s" fill="freeze" />
      </text>
    </svg>
  );
}

function EVMMockup() {
  return (
    <svg viewBox="0 0 360 200" className="w-full h-full">
      <rect width="360" height="200" fill="#1e293b" />
      <text x="16" y="26" fill="#94a3b8" fontSize="12" fontFamily="system-ui">Earned Value Management</text>
      {/* Axes */}
      <line x1="40" y1="30" x2="40" y2="160" stroke="#475569" strokeWidth="1" />
      <line x1="40" y1="160" x2="340" y2="160" stroke="#475569" strokeWidth="1" />
      {/* PV (Planned Value) - dashed */}
      <path d="M40 150 Q120 130 180 100 Q240 70 340 40" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="5,3" opacity="0">
        <animate attributeName="opacity" from="0" to="0.8" dur="0.5s" begin="0.3s" fill="freeze" />
      </path>
      {/* EV (Earned Value) - solid green */}
      <path d="M40 150 Q100 138 150 118 Q200 95 240 80" fill="none" stroke="#10b981" strokeWidth="2" opacity="0" strokeDashoffset="300" strokeDasharray="300">
        <animate attributeName="opacity" from="0" to="1" dur="0.1s" begin="0.6s" fill="freeze" />
        <animate attributeName="strokeDashoffset" from="300" to="0" dur="1.2s" begin="0.6s" fill="freeze" />
      </path>
      {/* AC (Actual Cost) - solid red */}
      <path d="M40 150 Q100 132 150 108 Q200 82 240 60" fill="none" stroke="#ef4444" strokeWidth="2" opacity="0" strokeDashoffset="300" strokeDasharray="300">
        <animate attributeName="opacity" from="0" to="1" dur="0.1s" begin="0.8s" fill="freeze" />
        <animate attributeName="strokeDashoffset" from="300" to="0" dur="1.2s" begin="0.8s" fill="freeze" />
      </path>
      {/* Legend */}
      {[
        { x: 50, label: 'PV', color: '#94a3b8' },
        { x: 110, label: 'EV', color: '#10b981' },
        { x: 170, label: 'AC', color: '#ef4444' },
      ].map((l, i) => (
        <g key={i} opacity="0">
          <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin={`${1.8 + i * 0.15}s`} fill="freeze" />
          <line x1={l.x} y1="175" x2={l.x + 16} y2="175" stroke={l.color} strokeWidth="2" />
          <text x={l.x + 20} y="178" fill={l.color} fontSize="9" fontFamily="system-ui">{l.label}</text>
        </g>
      ))}
      {/* KPI badges */}
      <g opacity="0">
        <animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="2.2s" fill="freeze" />
        <rect x="250" y="168" width="100" height="26" rx="6" fill="#334155" />
        <text x="260" y="180" fill="#10b981" fontSize="9" fontWeight="bold" fontFamily="system-ui">CPI 0.92</text>
        <text x="300" y="180" fill="#f97316" fontSize="9" fontWeight="bold" fontFamily="system-ui">SPI 0.88</text>
      </g>
    </svg>
  );
}

function NLQueryMockup() {
  return (
    <svg viewBox="0 0 360 200" className="w-full h-full">
      <rect width="360" height="200" fill="#1e293b" />
      <text x="16" y="26" fill="#94a3b8" fontSize="12" fontFamily="system-ui">Mjuzi AI</text>
      {/* Query bubble */}
      <rect x="60" y="38" width="284" height="28" rx="14" fill="#334155" opacity="0">
        <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="0.2s" fill="freeze" />
      </rect>
      <text x="76" y="56" fill="#e2e8f0" fontSize="10" fontFamily="system-ui" opacity="0">"Which projects are at risk this quarter?"
        <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="0.2s" fill="freeze" />
      </text>
      {/* AI response */}
      <rect x="16" y="78" width="284" height="108" rx="12" fill="#0f172a" stroke="#3b82f6" strokeWidth="1" opacity="0">
        <animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="0.8s" fill="freeze" />
      </rect>
      <text x="28" y="96" fill="#22d3ee" fontSize="10" fontFamily="system-ui" opacity="0">✦ 2 projects flagged:
        <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="1.0s" fill="freeze" />
      </text>
      {[
        { y: 116, name: 'Mobile App v2', reason: '— 23% over budget, 2 weeks behind', color: '#ef4444' },
        { y: 140, name: 'API Platform', reason: '— 3 unresolved blockers', color: '#f97316' },
      ].map((p, i) => (
        <g key={i} opacity="0">
          <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin={`${1.3 + i * 0.4}s`} fill="freeze" />
          <circle cx="34" cy={p.y - 3} r="4" fill={p.color} />
          <text x="44" y={p.y} fill="#e2e8f0" fontSize="10" fontWeight="bold" fontFamily="system-ui">{p.name}</text>
          <text x="44" y={p.y + 14} fill="#94a3b8" fontSize="9" fontFamily="system-ui">{p.reason}</text>
        </g>
      ))}
      <text x="28" y="174" fill="#94a3b8" fontSize="9" fontFamily="system-ui" opacity="0">Recommendation: Escalate Mobile App to steering committee.
        <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="2.0s" fill="freeze" />
      </text>
    </svg>
  );
}

const featureMockups: Record<string, React.FC> = {
  'Interactive Gantt Charts': GanttMockup,
  'AI-Powered Scheduling': SchedulingMockup,
  'Earned Value Management': EVMMockup,
  'Monte Carlo Simulations': MonteCarloMockup,
  'Smart Risk Detection': RiskDetectionMockup,
  'Meeting Intelligence': MeetingMockup,
  'Portfolio Dashboard': PortfolioMockup,
  'Natural Language Queries': NLQueryMockup,
};

const faqItems = [
  {
    question: 'What does Kovarti do?',
    answer: 'Kovarti is an AI-powered project management platform. It combines Gantt scheduling, earned value management, risk detection, and Monte Carlo simulations — all with a built-in AI assistant called Mjuzi that gives you real-time project insights.',
  },
  {
    question: 'How is this different from Monday or Asana?',
    answer: 'Most PM tools are task trackers with AI bolted on. Kovarti was built AI-first — Mjuzi monitors your projects 24/7 for risks, generates schedules from natural language, and runs Monte Carlo simulations to predict delivery confidence. You also get full EVM dashboards (CPI, SPI, S-Curves) that none of those tools offer.',
  },
  {
    question: 'What does it cost?',
    answer: 'Free 14-day trial, no card required. Basic plan starts at $19/mo for core PM features. Pro plan at $29/mo adds AI scheduling, risk detection, and meeting intelligence. Annual plans get 20% off at launch.',
  },
  {
    question: 'When do you launch?',
    answer: 'We launch September 7, 2026. Join the waitlist to get early access and our launch-window discount on the Pro plan.',
  },
  {
    question: 'Can I see a demo?',
    answer: "We're finalizing the demo environment now. Join the waitlist and we'll send you an invite as soon as it's ready — waitlist members get first access.",
  },
  {
    question: 'Is my data secure?',
    answer: 'Yes. Each organization gets its own isolated database (multi-tenant architecture). We use SSL/TLS encryption, role-based access control, and never share your data with third parties. Your project data is never used to train AI models.',
  },
];

function MjuziFaqBot() {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedQ, setSelectedQ] = useState<number | null>(null);

  return (
    <>
      {/* Chat panel */}
      {isOpen && (
        <div className="fixed bottom-20 right-4 sm:right-6 z-50 w-[340px] sm:w-[380px] max-h-[70vh] bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl shadow-black/40 flex flex-col overflow-hidden animate-in">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700/50 bg-slate-900">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-purple-600 flex items-center justify-center text-white text-sm font-bold shrink-0">M</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white">Mjuzi</div>
              <div className="text-xs text-slate-400">Kovarti AI Assistant</div>
            </div>
            <button onClick={() => { setIsOpen(false); setSelectedQ(null); }} className="text-slate-400 hover:text-white transition-colors p-1" aria-label="Close chat">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {/* Greeting */}
            <div className="flex gap-2.5">
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary-500 to-purple-600 flex items-center justify-center text-white text-[10px] font-bold shrink-0 mt-0.5">M</div>
              <div className="bg-slate-800 rounded-xl rounded-tl-sm px-3.5 py-2.5 text-sm text-slate-200 leading-relaxed max-w-[85%]">
                Hi, I'm <span className="font-semibold text-primary-400">Mjuzi</span>! I can answer your questions about Kovarti PM. What would you like to know?
              </div>
            </div>

            {/* Answer display */}
            {selectedQ !== null && (
              <>
                <div className="flex justify-end">
                  <div className="bg-primary-600/20 border border-primary-500/30 rounded-xl rounded-tr-sm px-3.5 py-2.5 text-sm text-primary-200 max-w-[85%]">
                    {faqItems[selectedQ].question}
                  </div>
                </div>
                <div className="flex gap-2.5">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary-500 to-purple-600 flex items-center justify-center text-white text-[10px] font-bold shrink-0 mt-0.5">M</div>
                  <div className="bg-slate-800 rounded-xl rounded-tl-sm px-3.5 py-2.5 text-sm text-slate-200 leading-relaxed max-w-[85%]">
                    {faqItems[selectedQ].answer}
                  </div>
                </div>
              </>
            )}

            {/* Question buttons */}
            <div className="space-y-2 pt-1">
              <div className="text-xs text-slate-500 font-medium uppercase tracking-wide">{selectedQ !== null ? 'Ask another question' : 'Pick a question'}</div>
              {faqItems.map((item, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedQ(i)}
                  className={`w-full text-left text-sm px-3 py-2 rounded-lg border transition-all ${
                    selectedQ === i
                      ? 'border-primary-500/50 bg-primary-500/10 text-primary-300'
                      : 'border-slate-700/50 bg-slate-800/50 text-slate-300 hover:border-slate-600 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  {item.question}
                </button>
              ))}
            </div>

            {/* CTA */}
            <div className="pt-2">
              <a
                href="#waitlist"
                onClick={() => setIsOpen(false)}
                className="block w-full text-center text-sm font-semibold text-white bg-gradient-to-r from-primary-600 to-purple-600 hover:from-primary-500 hover:to-purple-500 px-4 py-2.5 rounded-xl transition-all"
              >
                Join the Waitlist
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Floating button */}
      <button
        onClick={() => setIsOpen(prev => !prev)}
        className="fixed bottom-4 right-4 sm:right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-primary-500 to-purple-600 hover:from-primary-400 hover:to-purple-500 text-white shadow-lg shadow-primary-900/50 hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center"
        aria-label={isOpen ? 'Close chat' : 'Chat with Mjuzi'}
      >
        {isOpen ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
        )}
      </button>
    </>
  );
}

export const PrelaunchLandingPage: React.FC = () => {
  useSEO({
    title: 'Kovarti PM — AI-Powered Project Management Software',
    description: 'Plan smarter, predict risks, and deliver on time. AI scheduling, Monte Carlo simulations, Earned Value Management, Gantt charts, and real-time collaboration.',
    canonical: '/',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Kovarti PM',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description: 'AI-powered project management software with intelligent scheduling, risk prediction, Monte Carlo simulations, and Earned Value Management.',
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'USD',
        lowPrice: '0',
        highPrice: '79',
        offerCount: '4',
      },
      creator: {
        '@type': 'Organization',
        name: 'Kovarti Project & Business Consulting',
        url: 'https://kovarti.com',
      },
    },
  });

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
        <span className="mr-2" aria-hidden="true">🎉</span>
        Join the waitlist — be the first to know when we launch.
        <span className="ml-2" aria-hidden="true">🚀</span>
      </div>

      {/* Nav */}
      <nav className="border-b border-white/5 backdrop-blur-md bg-slate-950/60 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-between items-center h-16">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-purple-600 rounded-lg flex items-center justify-center shadow-lg shadow-primary-900">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={LOGO_SVG_PATH} />
              </svg>
            </div>
            <span className="text-lg font-bold">Kovarti PM</span>
          </Link>
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

            {/* Countdown — isolated to avoid re-rendering the whole page every second */}
            <Countdown target={LAUNCH_DATE} />
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
            { label: 'Scheduling methods', value: '5' },
            { label: 'Report templates', value: '10+' },
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
            Join the waitlist and be the first to know when we launch — plus get access to our launch-window Pro discount.
          </p>
          {status === 'success' ? (
            <div className="max-w-md mx-auto bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-8 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-emerald-400 font-bold text-xl mb-2">{message || "You're on the list!"}</p>
              <p className="text-slate-400 text-sm">We'll email you the moment we go live. See you at launch.</p>
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
                  aria-label="Email address"
                  autoComplete="email"
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm transition-all"
                />
                <button
                  type="submit"
                  disabled={status === 'loading'}
                  className="px-6 py-3.5 bg-gradient-to-r from-primary-600 to-purple-600 hover:from-primary-500 hover:to-purple-500 disabled:opacity-60 text-white font-semibold rounded-xl transition-all shadow-lg shadow-primary-900 text-sm whitespace-nowrap"
                >
                  {status === 'loading' ? 'Joining...' : 'Reserve My Spot'}
                </button>
              </form>
              {status === 'error' && <p className="mt-3 text-rose-400 text-sm" role="alert">{message}</p>}
              <p className="mt-5 text-xs text-slate-400">No spam. Unsubscribe anytime.</p>
            </>
          )}
        </div>
      </section>

      {/* Pricing */}
      <section className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-white">Simple, transparent pricing</h2>
            <p className="mt-4 text-lg text-slate-400">Try free for 14 days. Upgrade anytime.</p>
            <p className="mt-3 inline-flex items-center gap-2 text-sm text-green-400 font-medium">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
              30-day prorated refund guarantee on annual plans
            </p>
          </div>
          <PricingSection mode="waitlist" forceDark />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-10 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-gradient-to-br from-primary-500 to-purple-600 rounded flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={LOGO_SVG_PATH} />
              </svg>
            </div>
            <span className="text-sm font-semibold text-white">Kovarti</span>
          </div>
          <div className="flex gap-6 text-sm text-slate-500">
            <a href={`mailto:${SALES_EMAIL}`} className="hover:text-white transition-colors">{SALES_EMAIL}</a>
            <Link to="/terms" className="hover:text-white transition-colors">Terms</Link>
            <Link to="/privacy" className="hover:text-white transition-colors">Privacy</Link>
          </div>
          <div className="text-xs text-slate-500">&copy; {new Date().getFullYear()} Kovarti. All rights reserved.</div>
        </div>
      </footer>

      {/* FAQ Bot */}
      <MjuziFaqBot />
    </div>
  );
};
