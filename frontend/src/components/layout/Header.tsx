'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { logout } from '@/lib/api';
import { markSignedOut, useApiHealth, useSession } from '@/lib/hooks';
import { ThemeToggle } from './ThemeToggle';
import {
  ScanLine,
  Clock,
  LogOut,
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
  '/admin': {
    title: 'Admin',
    subtitle: 'Usage across accounts and user corrections',
  },
  '/settings': {
    title: 'Platform Settings & Threshold Simulator',
    subtitle: 'Adjust cost ratios, simulate operating thresholds & configure API bridges',
  },
};

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();
  const { health, error: healthError } = useApiHealth();
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const handleSignOut = async () => {
    setSignOutError(null);
    try {
      await logout();
      markSignedOut();
      router.replace('/login');
    } catch (err) {
      setSignOutError(err instanceof Error ? err.message : String(err));
    }
  };
  const [time, setTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }) + ' IST'
      );
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
    <header className="h-16 bg-surface/80 backdrop-blur-md border-b border-slate-800/80 px-6 flex items-center justify-between sticky top-0 z-20">
      {/* Title & Breadcrumb */}
      <div>
        <h1 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <span>{currentRoute.title}</span>
        </h1>
        <p className="text-[13px] text-slate-400 font-medium">{currentRoute.subtitle}</p>
      </div>

      {/* Right Action Bar */}
      <div className="flex items-center gap-3">
        {/* IST Clock */}
        <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900/60 border border-slate-800 text-[13px] font-mono text-slate-400">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          <span>{time || '00:00:00 IST'}</span>
        </div>

        {/* Engine Mode Pill */}
        <div
          title={healthError ? `${healthError.message} ${healthError.hint ?? ''}` : health?.model}
          className={`flex items-center gap-2 px-2.5 py-1 rounded-md border text-xs font-medium ${
            health
              ? 'bg-cyan-950/40 border-cyan-500/30 text-cyan-300'
              : 'bg-rose-950/40 border-rose-500/30 text-rose-300'
          }`}
        >
          <span className="relative flex h-2 w-2">
            <span className={`relative inline-flex rounded-full h-2 w-2 ${health ? 'bg-cyan-500' : 'bg-rose-500'}`}></span>
          </span>
          <span className="text-[13px] font-mono font-semibold">
            {health ? 'MODEL API ONLINE' : healthError ? 'MODEL API OFFLINE' : 'CHECKING API'}
          </span>
        </div>

        <ThemeToggle />

        {session.status === 'signed-in' && (
          <div className="flex items-center gap-2">
            <span className="hidden md:inline text-[13px] font-mono text-slate-400" title={signOutError ?? undefined}>
              {session.user.email}
            </span>
            <button
              onClick={handleSignOut}
              title={signOutError ? `Sign out failed: ${signOutError}` : 'Sign out'}
              className={`p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border ${
                signOutError ? 'border-rose-500/60 text-rose-400' : 'border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

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
