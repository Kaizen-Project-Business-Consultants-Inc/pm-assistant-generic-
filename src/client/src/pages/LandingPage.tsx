import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Check, X, Zap } from 'lucide-react';
import { PricingCards, COMPARISON } from '../components/pricing/PricingCards';
import { useAuthStore } from '../stores/authStore';
import { apiService } from '../services/api';

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.documentElement.classList.contains('reduce-motion')
    );
  });
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches || document.documentElement.classList.contains('reduce-motion'));
    mq.addEventListener('change', onChange);
    const observer = new MutationObserver(() => onChange());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => { mq.removeEventListener('change', onChange); observer.disconnect(); };
  }, []);
  return reduced;
}

const features = [
  {
    title: 'AI-Powered Scheduling',
    description: 'Automatically generate task breakdowns, dependencies, and optimized timelines using AI.',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    accent: 'from-primary-500 to-cyan-400',
    iconBg: 'bg-primary-500/10 text-primary-400',
    cardBg: 'bg-[#111827]/70 border-primary-500/10 backdrop-blur-sm',
  },
  {
    title: 'Monte Carlo Simulations',
    description: 'Run probabilistic analysis on your project timelines to understand completion confidence levels.',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
    accent: 'from-primary-500 to-cyan-400',
    iconBg: 'bg-primary-500/10 text-primary-400',
    cardBg: 'bg-[#111827]/70 border-primary-500/10 backdrop-blur-sm',
  },
  {
    title: 'Smart Risk Detection',
    description: 'AI continuously monitors your projects and alerts you to potential delays, budget overruns, and risks.',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
      </svg>
    ),
    accent: 'from-primary-500 to-cyan-400',
    iconBg: 'bg-primary-500/10 text-primary-400',
    cardBg: 'bg-[#111827]/70 border-primary-500/10 backdrop-blur-sm',
  },
  {
    title: 'Meeting Intelligence',
    description: 'Extract action items and project updates from meeting transcripts automatically.',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
      </svg>
    ),
    accent: 'from-primary-500 to-cyan-400',
    iconBg: 'bg-primary-500/10 text-primary-400',
    cardBg: 'bg-[#111827]/70 border-primary-500/10 backdrop-blur-sm',
  },
  {
    title: 'Portfolio Dashboard',
    description: 'Manage multiple projects with a bird\'s-eye view of health, budget, and timeline status.',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
      </svg>
    ),
    accent: 'from-primary-500 to-cyan-400',
    iconBg: 'bg-primary-500/10 text-primary-400',
    cardBg: 'bg-[#111827]/70 border-primary-500/10 backdrop-blur-sm',
  },
  {
    title: 'Natural Language Queries',
    description: 'Ask questions about your projects in plain English and get instant, data-driven answers.',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
      </svg>
    ),
    accent: 'from-primary-500 to-cyan-400',
    iconBg: 'bg-primary-500/10 text-primary-400',
    cardBg: 'bg-[#111827]/70 border-primary-500/10 backdrop-blur-sm',
  },
];



/* Animated mockup previews for feature cards */
function SchedulingMockup({ static: isStatic }: { static?: boolean }) {
  return (
    <svg viewBox="0 0 360 200" className="w-full h-full">
      <rect width="360" height="200" fill="#1e293b" />
      <text x="16" y="26" fill="#94a3b8" fontSize="12" fontFamily="system-ui">Project Timeline</text>
      <text x="16" y="54" fill="#cbd5e1" fontSize="11" fontFamily="system-ui">Design</text>
      <text x="16" y="82" fill="#cbd5e1" fontSize="11" fontFamily="system-ui">Backend</text>
      <text x="16" y="110" fill="#cbd5e1" fontSize="11" fontFamily="system-ui">Frontend</text>
      <text x="16" y="138" fill="#cbd5e1" fontSize="11" fontFamily="system-ui">Testing</text>
      <text x="16" y="166" fill="#cbd5e1" fontSize="11" fontFamily="system-ui">Deploy</text>
      <rect x="90" y="42" width={isStatic ? "90" : "0"} height="16" rx="3" fill="#3b82f6" opacity="0.9">
        {!isStatic && <animate attributeName="width" from="0" to="90" dur="0.6s" begin="0.2s" fill="freeze" />}
      </rect>
      <rect x="130" y="70" width={isStatic ? "130" : "0"} height="16" rx="3" fill="#60a5fa" opacity="0.9">
        {!isStatic && <animate attributeName="width" from="0" to="130" dur="0.7s" begin="0.5s" fill="freeze" />}
      </rect>
      <rect x="175" y="98" width={isStatic ? "110" : "0"} height="16" rx="3" fill="#06b6d4" opacity="0.9">
        {!isStatic && <animate attributeName="width" from="0" to="110" dur="0.6s" begin="0.9s" fill="freeze" />}
      </rect>
      <rect x="240" y="126" width={isStatic ? "70" : "0"} height="16" rx="3" fill="#22d3ee" opacity="0.9">
        {!isStatic && <animate attributeName="width" from="0" to="70" dur="0.5s" begin="1.3s" fill="freeze" />}
      </rect>
      <rect x="295" y="154" width={isStatic ? "40" : "0"} height="16" rx="3" fill="#67e8f9" opacity="0.9">
        {!isStatic && <animate attributeName="width" from="0" to="40" dur="0.4s" begin="1.6s" fill="freeze" />}
      </rect>
      <path d="M180 58 L180 70" stroke="#64748b" strokeWidth="1" fill="none" strokeDasharray="3,2" opacity={isStatic ? "1" : "0"}>
        {!isStatic && <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="0.8s" fill="freeze" />}
      </path>
      <path d="M260 86 L260 98" stroke="#64748b" strokeWidth="1" fill="none" strokeDasharray="3,2" opacity={isStatic ? "1" : "0"}>
        {!isStatic && <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="1.2s" fill="freeze" />}
      </path>
      <text x="310" y="26" fill="#22d3ee" fontSize="12" opacity={isStatic ? "1" : "0"}>✦ AI
        {!isStatic && <animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="0.1s" fill="freeze" />}
        {!isStatic && <animateTransform attributeName="transform" type="scale" values="0.8;1.1;1" dur="0.5s" begin="0.1s" fill="freeze" />}
      </text>
    </svg>
  );
}

function MonteCarloMockup({ static: isStatic }: { static?: boolean }) {
  const bars = [8, 15, 28, 45, 60, 80, 95, 78, 55, 35, 20, 10, 5];
  return (
    <svg viewBox="0 0 360 200" className="w-full h-full">
      <rect width="360" height="200" fill="#1e293b" />
      <text x="16" y="26" fill="#94a3b8" fontSize="12" fontFamily="system-ui">Completion Probability</text>
      {bars.map((h, i) => (
        <rect key={i} x={35 + i * 24} y={isStatic ? 180 - h : 180} width="18" rx="2" fill="#06b6d4" opacity="0.8" height={isStatic ? h : 0}>
          {!isStatic && <animate attributeName="height" from="0" to={String(h)} dur="0.4s" begin={`${0.1 + i * 0.08}s`} fill="freeze" />}
          {!isStatic && <animate attributeName="y" from="180" to={String(180 - h)} dur="0.4s" begin={`${0.1 + i * 0.08}s`} fill="freeze" />}
        </rect>
      ))}
      <line x1="155" y1="34" x2="155" y2="180" stroke="#fbbf24" strokeWidth="1" strokeDasharray="4,3" opacity={isStatic ? "0.8" : "0"}>
        {!isStatic && <animate attributeName="opacity" from="0" to="0.8" dur="0.3s" begin="1.2s" fill="freeze" />}
      </line>
      <text x="158" y="44" fill="#fbbf24" fontSize="10" fontFamily="system-ui" opacity={isStatic ? "1" : "0"}>P50
        {!isStatic && <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="1.2s" fill="freeze" />}
      </text>
      <line x1="225" y1="34" x2="225" y2="180" stroke="#f97316" strokeWidth="1" strokeDasharray="4,3" opacity={isStatic ? "0.8" : "0"}>
        {!isStatic && <animate attributeName="opacity" from="0" to="0.8" dur="0.3s" begin="1.5s" fill="freeze" />}
      </line>
      <text x="228" y="44" fill="#f97316" fontSize="10" fontFamily="system-ui" opacity={isStatic ? "1" : "0"}>P80
        {!isStatic && <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="1.5s" fill="freeze" />}
      </text>
      <line x1="275" y1="34" x2="275" y2="180" stroke="#ef4444" strokeWidth="1" strokeDasharray="4,3" opacity={isStatic ? "0.8" : "0"}>
        {!isStatic && <animate attributeName="opacity" from="0" to="0.8" dur="0.3s" begin="1.8s" fill="freeze" />}
      </line>
      <text x="278" y="44" fill="#ef4444" fontSize="10" fontFamily="system-ui" opacity={isStatic ? "1" : "0"}>P95
        {!isStatic && <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="1.8s" fill="freeze" />}
      </text>
    </svg>
  );
}

function RiskDetectionMockup({ static: isStatic }: { static?: boolean }) {
  return (
    <svg viewBox="0 0 360 200" className="w-full h-full">
      <rect width="360" height="200" fill="#1e293b" />
      <text x="16" y="26" fill="#94a3b8" fontSize="12" fontFamily="system-ui">Risk Scanner</text>
      {!isStatic && (
        <rect x="0" y="34" width="360" height="2" fill="#3b82f6" opacity="0">
          <animate attributeName="opacity" values="0;0.6;0" dur="1.5s" begin="0.2s" />
          <animate attributeName="y" from="34" to="190" dur="1.5s" begin="0.2s" fill="freeze" />
        </rect>
      )}
      {[
        { y: 46, text1: 'Budget overrun — Phase 2 at 23% over', severity: '#ef4444', tag: 'HIGH' },
        { y: 86, text1: 'Resource conflict — 3 devs double-booked', severity: '#f97316', tag: 'MED' },
        { y: 126, text1: 'Dependency delay — API blocked by vendor', severity: '#ef4444', tag: 'HIGH' },
        { y: 166, text1: 'Scope creep — 12 unplanned tasks added', severity: '#eab308', tag: 'LOW' },
      ].map((risk, i) => (
        <g key={i} opacity={isStatic ? "1" : "0"}>
          {!isStatic && <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin={`${0.6 + i * 0.5}s`} fill="freeze" />}
          <rect x="14" y={risk.y} width="6" height="24" rx="2" fill={risk.severity} />
          <text x="28" y={risk.y + 15} fill="#e2e8f0" fontSize="10" fontFamily="system-ui">{risk.text1}</text>
          <rect x="300" y={risk.y + 3} width="40" height="18" rx="9" fill={risk.severity} opacity="0.2" />
          <text x="310" y={risk.y + 15} fill={risk.severity} fontSize="9" fontWeight="bold" fontFamily="system-ui">{risk.tag}</text>
        </g>
      ))}
    </svg>
  );
}

function MeetingMockup({ static: isStatic }: { static?: boolean }) {
  const lines = [
    { text: 'Sarah: Finalize API spec by Friday', type: 'transcript' },
    { text: '→ Action: API spec — Sarah — due Fri', type: 'action' },
    { text: 'Tom: Client approved new design', type: 'transcript' },
    { text: '→ Decision: Design direction approved', type: 'decision' },
    { text: 'Lisa: QA starts Monday, 3 engineers', type: 'transcript' },
    { text: '→ Action: QA testing — Lisa — due Mon', type: 'action' },
  ];
  return (
    <svg viewBox="0 0 360 200" className="w-full h-full">
      <rect width="360" height="200" fill="#1e293b" />
      <text x="16" y="26" fill="#94a3b8" fontSize="12" fontFamily="system-ui">Meeting Analysis</text>
      {lines.map((line, i) => (
        <g key={i} opacity={isStatic ? "1" : "0"}>
          {!isStatic && <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin={`${0.3 + i * 0.4}s`} fill="freeze" />}
          {line.type === 'action' ? (
            <>
              <rect x="14" y={38 + i * 26} width="332" height="22" rx="4" fill="#3b82f6" opacity="0.15" />
              <text x="22" y={53 + i * 26} fill="#60a5fa" fontSize="10" fontFamily="system-ui">{line.text}</text>
            </>
          ) : line.type === 'decision' ? (
            <>
              <rect x="14" y={38 + i * 26} width="332" height="22" rx="4" fill="#a855f7" opacity="0.15" />
              <text x="22" y={53 + i * 26} fill="#c084fc" fontSize="10" fontFamily="system-ui">{line.text}</text>
            </>
          ) : (
            <text x="22" y={53 + i * 26} fill="#94a3b8" fontSize="10" fontFamily="system-ui">{line.text}</text>
          )}
        </g>
      ))}
    </svg>
  );
}

function PortfolioMockup({ static: isStatic }: { static?: boolean }) {
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
        <g key={i} opacity={isStatic ? "1" : "0"}>
          {!isStatic && <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin={`${0.2 + i * 0.3}s`} fill="freeze" />}
          <text x="16" y={56 + i * 42} fill="#e2e8f0" fontSize="11" fontFamily="system-ui">{p.name}</text>
          <rect x="16" y={62 + i * 42} width="280" height="10" rx="5" fill="#334155" />
          <rect x="16" y={62 + i * 42} width={isStatic ? String(p.w) : "0"} height="10" rx="5" fill={p.color}>
            {!isStatic && <animate attributeName="width" from="0" to={String(p.w)} dur="0.8s" begin={`${0.4 + i * 0.3}s`} fill="freeze" />}
          </rect>
          <text x="304" y={72 + i * 42} fill={p.color} fontSize="11" fontWeight="bold" fontFamily="system-ui" opacity={isStatic ? "1" : "0"}>
            {p.health}%
            {!isStatic && <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin={`${0.8 + i * 0.3}s`} fill="freeze" />}
          </text>
        </g>
      ))}
    </svg>
  );
}

function NLQueryMockup({ static: isStatic }: { static?: boolean }) {
  return (
    <svg viewBox="0 0 360 200" className="w-full h-full">
      <rect width="360" height="200" fill="#1e293b" />
      <g opacity={isStatic ? "1" : "0"}>
        {!isStatic && <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="0.3s" fill="freeze" />}
        <rect x="90" y="14" width="254" height="30" rx="15" fill="#3b82f6" />
        <text x="106" y="34" fill="white" fontSize="11" fontFamily="system-ui">Which tasks are overdue this sprint?</text>
      </g>
      {!isStatic && (
        <g opacity="0">
          <animate attributeName="opacity" values="0;1;1;0" dur="1s" begin="0.8s" fill="freeze" />
          <circle cx="28" cy="68" r="3.5" fill="#64748b"><animate attributeName="opacity" values="0.3;1;0.3" dur="0.6s" repeatCount="2" begin="0.8s" /></circle>
          <circle cx="40" cy="68" r="3.5" fill="#64748b"><animate attributeName="opacity" values="0.3;1;0.3" dur="0.6s" repeatCount="2" begin="0.9s" /></circle>
          <circle cx="52" cy="68" r="3.5" fill="#64748b"><animate attributeName="opacity" values="0.3;1;0.3" dur="0.6s" repeatCount="2" begin="1.0s" /></circle>
        </g>
      )}
      <g opacity={isStatic ? "1" : "0"}>
        {!isStatic && <animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="1.8s" fill="freeze" />}
        <rect x="16" y="56" width="270" height="130" rx="14" fill="#334155" />
        <text x="30" y="78" fill="#e2e8f0" fontSize="11" fontFamily="system-ui">Found 3 overdue tasks:</text>
        <text x="30" y="100" fill="#f87171" fontSize="10" fontFamily="system-ui">• API auth module — 3 days overdue</text>
        <text x="30" y="120" fill="#f87171" fontSize="10" fontFamily="system-ui">• DB schema review — 1 day overdue</text>
        <text x="30" y="140" fill="#fbbf24" fontSize="10" fontFamily="system-ui">• UI wireframes — due today</text>
        <text x="30" y="162" fill="#94a3b8" fontSize="10" fontFamily="system-ui">Suggest auto-reschedule?</text>
        <rect x="30" y="170" width="60" height="18" rx="9" fill="#3b82f6" opacity={isStatic ? "1" : "0"}>
          {!isStatic && <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="2.4s" fill="freeze" />}
        </rect>
        <text x="40" y="183" fill="white" fontSize="9" fontFamily="system-ui" opacity={isStatic ? "1" : "0"}>Yes, do it
          {!isStatic && <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="2.4s" fill="freeze" />}
        </text>
      </g>
      <circle cx="30" cy="88" r="12" fill="#3b82f6" opacity={isStatic ? "1" : "0"}>
        {!isStatic && <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="1.8s" fill="freeze" />}
      </circle>
      <text x="24" y="92" fill="white" fontSize="10" fontWeight="bold" fontFamily="system-ui" opacity={isStatic ? "1" : "0"}>M
        {!isStatic && <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="1.8s" fill="freeze" />}
      </text>
    </svg>
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
      {/* Glow behind card */}
      <div className="absolute -inset-8 blur-xl" style={{ background: 'radial-gradient(circle at 60% 40%, rgba(34,211,238,0.18), transparent 60%)' }} />

      <div className="relative rounded-2xl overflow-hidden shadow-2xl" style={{ background: 'linear-gradient(160deg, #111a2e, #0f1626)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 30px 70px rgba(0,0,0,0.5)', padding: 18 }}>
        {/* Window chrome */}
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

        {/* KPI row */}
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

        {/* Monte Carlo chart */}
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

        {/* AI insight */}
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

const featureMockups: Record<string, React.FC<{ static?: boolean }>> = {
  'AI-Powered Scheduling': SchedulingMockup,
  'Monte Carlo Simulations': MonteCarloMockup,
  'Smart Risk Detection': RiskDetectionMockup,
  'Meeting Intelligence': MeetingMockup,
  'Portfolio Dashboard': PortfolioMockup,
  'Natural Language Queries': NLQueryMockup,
};

function FeatureCard({ feature }: { feature: typeof features[number] }) {
  const [showPreview, setShowPreview] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const Mockup = featureMockups[feature.title] as React.FC<{ static?: boolean }> | undefined;
  const reducedMotion = useReducedMotion();

  const show = useCallback(() => {
    if (!Mockup) return;
    timeoutRef.current = setTimeout(() => setShowPreview(true), 400);
  }, [Mockup]);

  const hide = useCallback(() => {
    clearTimeout(timeoutRef.current);
    setShowPreview(false);
  }, []);

  const handleClick = useCallback(() => {
    if (!Mockup) return;
    setShowPreview((prev) => !prev);
  }, [Mockup]);

  return (
    <div
      tabIndex={0}
      role="button"
      aria-expanded={Mockup ? showPreview : undefined}
      className={`group relative rounded-2xl p-6 border hover:shadow-lg hover:shadow-primary-500/10 hover:-translate-y-1 hover:z-40 transition-all duration-300 cursor-pointer ${feature.cardBg}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onClick={handleClick}
    >
      <div className={`absolute top-0 left-6 right-6 h-1 rounded-b-full bg-gradient-to-r ${feature.accent} opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-300`} />
      <div className={`w-12 h-12 ${feature.iconBg} rounded-xl flex items-center justify-center mb-4`}>
        {feature.icon}
      </div>
      <h3 className="text-xl font-semibold text-white mb-2">{feature.title}</h3>
      <p className="text-slate-300 text-sm leading-relaxed">{feature.description}</p>

      {Mockup && showPreview && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-3 z-50 w-[360px] max-w-[calc(100vw-2rem)] rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10">
          <div className="absolute left-1/2 -translate-x-1/2 top-full w-3 h-3 bg-[#1e293b] rotate-45 -mt-1.5" />
          <Mockup static={reducedMotion} />
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-3 py-2">
            <p className="text-white text-xs font-medium">{feature.title}</p>
          </div>
        </div>
      )}
    </div>
  );
}


export const LandingPage: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [topUpLoading, setTopUpLoading] = useState(false);
  const { isAuthenticated } = useAuthStore();

  const handleBuyTokens = async () => {
    if (!isAuthenticated) {
      window.location.href = '/pricing';
      return;
    }
    setTopUpLoading(true);
    try {
      const { url } = await apiService.createTopUpSession(1);
      window.location.href = url;
    } catch {
      setTopUpLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0f1a] overflow-x-hidden">
      <style>{`
        @keyframes hfloat { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-7px) } }
        @keyframes hpulse { 0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(74,222,128,0.6) } 50% { opacity: .5; box-shadow: 0 0 0 5px rgba(74,222,128,0) } }
      `}</style>
      {/* Navbar */}
      <nav className="bg-[#0a0f1a]/80 backdrop-blur-md border-b border-white/5 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-cyan-400 rounded-lg flex items-center justify-center shadow-lg shadow-primary-500/20">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <span className="ml-2 text-xl font-bold text-white">Kovarti PM</span>
            </div>
            {/* Desktop nav */}
            <div className="hidden md:flex items-center space-x-4">
              <Link to="/pricing" className="text-sm text-slate-400 hover:text-white transition-colors">Pricing</Link>
              <Link to="/login" className="text-sm text-slate-400 hover:text-white transition-colors">Sign In</Link>
              <Link
                to="/pricing"
                className="text-sm font-medium text-white bg-gradient-to-r from-primary-500 to-cyan-400 hover:from-primary-600 hover:to-cyan-500 px-4 py-2 rounded-lg transition-all shadow-md shadow-primary-500/20"
              >
                Get Started
              </Link>
            </div>

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 text-slate-400 hover:text-white transition-colors"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>

          {/* Mobile menu dropdown */}
          {mobileMenuOpen && (
            <div className="md:hidden border-t border-white/5 py-3 space-y-1">
              <Link to="/pricing" onClick={() => setMobileMenuOpen(false)} className="block px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors">Pricing</Link>
              <Link to="/login" onClick={() => setMobileMenuOpen(false)} className="block px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors">Sign In</Link>
              <Link to="/pricing" onClick={() => setMobileMenuOpen(false)} className="block px-3 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-primary-500 to-cyan-400 rounded-lg text-center mt-2">Get Started</Link>
            </div>
          )}
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden" style={{ background: 'radial-gradient(1200px 600px at 50% -8%, rgba(59,130,246,0.12), transparent 60%)' }}>
        <div className="max-w-[1200px] mx-auto px-4 sm:px-8 pt-16 sm:pt-[72px] pb-16 sm:pb-[90px] grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-14 items-center" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
          {/* Left: Copy */}
          <div>
            <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-blue-200 px-3.5 py-1.5 rounded-full" style={{ background: 'rgba(59,130,246,0.14)', border: '1px solid rgba(59,130,246,0.3)' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_theme(colors.cyan.400)]" />
              MS Project-grade scheduling — powered by AI
            </span>
            <h1 className="text-4xl sm:text-5xl lg:text-[60px] font-extrabold text-white mt-5 leading-[1.04] tracking-tight">
              Manage projects<br />
              <span className="bg-gradient-to-r from-primary-400 to-cyan-400 bg-clip-text text-transparent">
                smarter with AI
              </span>
            </h1>
            <p className="text-lg text-slate-300 mt-5 leading-relaxed max-w-[520px]">
              Plan smarter, predict risks, and deliver on time with intelligent scheduling,
              Monte Carlo simulations, and natural-language project insights.
            </p>
            <div className="flex items-center gap-3.5 mt-8">
              <Link
                to="/pricing"
                className="text-[15px] font-bold text-white bg-gradient-to-br from-primary-500 to-cyan-400 hover:from-primary-600 hover:to-cyan-500 px-7 py-3.5 rounded-xl transition-all shadow-lg shadow-primary-500/35 hover:shadow-xl hover:shadow-primary-500/40 hover:-translate-y-0.5"
              >
                Get Started Free
              </Link>
              <a
                href="#see-it-work"
                className="text-[15px] font-semibold text-white px-6 py-3.5 rounded-xl transition-all hover:-translate-y-0.5"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                See how it works
              </a>
            </div>
            <div className="flex items-center gap-5 mt-7 flex-wrap">
              {['No credit card', '14-day trial', 'Setup in minutes'].map((label) => (
                <span key={label} className="flex items-center gap-2 text-[13px] text-slate-300">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {label}
                </span>
              ))}
            </div>
          </div>

          {/* Right: Product Mockup */}
          <div className="w-full max-w-md mx-auto lg:max-w-none">
            <HeroMockup />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="pt-28 pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-2xl sm:text-3xl font-bold text-white">Everything you need to manage projects</h2>
            <p className="mt-3 text-base text-slate-300">
              Powerful AI features built for modern project managers
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature) => (
              <FeatureCard key={feature.title} feature={feature} />
            ))}
          </div>
        </div>
      </section>

      {/* See it in action */}
      <section id="see-it-work" className="pt-28 pb-20 border-t border-white/5 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-2xl sm:text-3xl font-bold text-white">See it in action</h2>
            <p className="mt-3 text-base text-slate-300">
              Real workflows, real results — here's how Kovarti PM works day to day
            </p>
          </div>
          <div className="space-y-20">
            {[
              { title: 'Plan with AI-powered scheduling', description: 'Import a scope document or describe your project — Mjuzi generates a full Gantt chart with tasks, dependencies, and critical path in seconds. Drag to adjust, then baseline and track.', Mockup: SchedulingMockup, reverse: false },
              { title: 'Catch risks before they escalate', description: 'The autonomous risk scanner runs daily, flagging budget overruns, resource conflicts, and dependency delays. Each finding comes with a confidence score and suggested mitigation from historical lessons.', Mockup: RiskDetectionMockup, reverse: true },
              { title: 'Monitor portfolio health at a glance', description: 'See every project\'s health, CPI, and SPI on one dashboard. Drill into any project for EVM metrics, Monte Carlo forecasts, and AI-generated next-best-actions.', Mockup: PortfolioMockup, reverse: false },
            ].map((row, i) => (
              <div key={i} className={`flex flex-col ${row.reverse ? 'lg:flex-row-reverse' : 'lg:flex-row'} gap-8 lg:gap-14 items-center`}>
                <div className="flex-1 min-w-0">
                  <h3 className="text-xl font-semibold text-white mb-3">{row.title}</h3>
                  <p className="text-slate-300 leading-relaxed">{row.description}</p>
                </div>
                <div className="flex-1 min-w-0 w-full max-w-md lg:max-w-none rounded-xl overflow-hidden ring-1 ring-white/10">
                  <row.Mockup static />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Preview */}
      <section id="pricing" className="pt-28 pb-20 border-t border-white/5 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-2xl sm:text-3xl font-bold text-white">Simple, transparent pricing</h2>
            <p className="mt-3 text-base text-slate-300">
              Start free, upgrade when you need more power
            </p>
          </div>
          <div className="dark">
            <PricingCards mode="link" />

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
                  disabled={topUpLoading}
                  className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
                >
                  {topUpLoading ? (
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
                <table className="text-sm" style={{ maxWidth: '700px', width: '100%' }}>
                  <thead>
                    <tr className="border-b-2 border-gray-700">
                      <th className="text-left py-3 pr-6 font-semibold text-white">Feature</th>
                      <th className="text-center py-3 px-4 font-semibold text-gray-400 w-24">Trial <span className="font-normal">(Free)</span></th>
                      <th className="text-center py-3 px-4 font-semibold text-white w-28">Consultant <span className="font-normal">(Solo)</span></th>
                      <th className="text-center py-3 px-4 font-semibold text-primary-400 w-24">SME <span className="font-normal">(Team)</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARISON.map((row, i) => (
                      <tr key={row.feature} className={`border-b border-gray-700/50 ${i % 2 === 0 ? 'bg-gray-800/50' : ''}`}>
                        <td className="py-2.5 pr-4 text-gray-300">{row.feature}</td>
                        {(['trial', 'consultant', 'sme'] as const).map((tier) => {
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
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="flex items-center mb-4 md:mb-0">
              <div className="w-6 h-6 bg-gradient-to-br from-primary-500 to-cyan-400 rounded flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <span className="ml-2 text-sm font-semibold text-white">Kovarti PM</span>
            </div>
            <div className="flex space-x-6 text-sm">
              <Link to="/terms" className="hover:text-white transition-colors">Terms of Service</Link>
              <Link to="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link>
              <Link to="/pricing" className="hover:text-white transition-colors">Pricing</Link>
            </div>
          </div>
          <div className="mt-8 text-center text-xs text-slate-400">
            &copy; {new Date().getFullYear()} Kovarti PM. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};
