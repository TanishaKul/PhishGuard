'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ShieldCheck,
  Zap,
  Activity,
  Search,
  ScanLine,
  Clock,
  Sparkles,
  Sliders,
} from 'lucide-react';

const ROUTE_NAMES: Record<string, { title: string; subtitle: string }> = {
  '/dashboard': {
    title: 'Security Operations Dashboard',
    subtitle: 'Real-time SMS triage, risk monitoring & detection metrics',
  },
  '/analyze': {
    title: 'Threat Intelligence Scanner',
    subtitle: 'Deep heuristic & calibrated ML analysis for inbound SMS messages',
  },
  '/history': {
    title: 'Scan Audit History',
    subtitle: 'Searchable log of verified messages, risk scores & signals',
  },
  '/analytics': {
    title: 'Threat Telemetry & Trends',
    subtitle: 'Aggregated smishing attack patterns, signal frequencies & distributions',
  },
  '/indicators': {
    title: 'Fraud Indicators & Dictionary',
    subtitle: 'Top TF-IDF feature weights & suspicious keyword categorization',
  },
  '/model-performance': {
    title: 'Model Evaluation & Error Analysis',
    subtitle: 'Confusion matrix, PR-AUC, ROC-AUC, cost curves & misclassification reviews',
  },
  '/settings': {
    title: 'Platform Settings & Threshold Simulator',
    subtitle: 'Adjust cost ratios, simulate operating thresholds & configure API bridges',
  },
};

export function Header() {
  const pathname = usePathname();
  const [time, setTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toUTCString().slice(17, 25) + ' UTC');
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const currentRoute = ROUTE_NAMES[pathname] || {
    title: 'Security Operations Dashboard',
    subtitle: 'Real-time SMS triage, risk monitoring & detection metrics',
  };

  return (
    <header className="h-16 bg-[#090d16]/80 backdrop-blur-md border-b border-slate-800/80 px-6 flex items-center justify-between sticky top-0 z-20">
      {/* Title & Breadcrumb */}
      <div>
        <h1 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <span>{currentRoute.title}</span>
        </h1>
        <p className="text-[11px] text-slate-400 font-medium">{currentRoute.subtitle}</p>
      </div>

      {/* Right Action Bar */}
      <div className="flex items-center gap-3">
        {/* UTC Clock */}
        <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900/60 border border-slate-800 text-[11px] font-mono text-slate-400">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          <span>{time || '00:00:00 UTC'}</span>
        </div>

        {/* Engine Mode Pill */}
        <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-cyan-950/40 border border-cyan-500/30 text-cyan-300 text-xs font-medium">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
          </span>
          <span className="text-[11px] font-mono font-semibold">MOCK ENGINE</span>
        </div>

        {/* Quick Analyze Button */}
        {pathname !== '/analyze' && (
          <Link
            href="/analyze"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 text-slate-950 text-xs font-bold shadow-[0_0_15px_rgba(6,182,212,0.3)] transition-all"
          >
            <ScanLine className="w-3.5 h-3.5" />
            <span>Scan SMS</span>
          </Link>
        )}
      </div>
    </header>
  );
}
