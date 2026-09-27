'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { THRESHOLD_CHANGED_EVENT, getThresholdOverride } from '@/lib/api';
import { useApiHealth, useSession } from '@/lib/hooks';
import {
  ShieldAlert,
  LayoutDashboard,
  ScanLine,
  History,
  BarChart3,
  Tag,
  Cpu,
  Settings,
  ChevronRight,
  ShieldCheck,
  Radio,
} from 'lucide-react';

const NAV_ITEMS = [
  {
    name: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    name: 'Analyze',
    href: '/analyze',
    icon: ScanLine,
  },
  {
    name: 'Scan History',
    href: '/history',
    icon: History,
  },
  {
    name: 'Threat Analytics',
    href: '/analytics',
    icon: BarChart3,
  },
  {
    name: 'Fraud Indicators',
    href: '/indicators',
    icon: Tag,
  },
  {
    name: 'Model Performance',
    href: '/model-performance',
    icon: Cpu,
  },
  {
    name: 'Settings',
    href: '/settings',
    icon: Settings,
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { health, error: healthError } = useApiHealth();
  const session = useSession();
  const [thresholdOverride, setThresholdOverride] = useState(getThresholdOverride());
  const effectiveThreshold = thresholdOverride ?? health?.threshold;

  useEffect(() => {
    const update = () => setThresholdOverride(getThresholdOverride());
    window.addEventListener(THRESHOLD_CHANGED_EVENT, update);
    return () => window.removeEventListener(THRESHOLD_CHANGED_EVENT, update);
  }, []);
  const navItems =
    session.status === 'signed-in' && session.user.isAdmin
      ? [...NAV_ITEMS, { name: 'Admin', href: '/admin', icon: ShieldCheck }]
      : NAV_ITEMS;

  return (
    <aside className="w-64 bg-surface/95 border-r border-slate-800/80 flex flex-col shrink-0 h-screen sticky top-0 z-30 select-none">
      {/* Brand Header */}
      <div className="p-5 border-b border-slate-800/80 flex items-center gap-3">
        <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 via-slate-900 to-teal-500/20 border border-cyan-500/40 shadow-[0_0_15px_rgba(6,182,212,0.25)]">
          <ShieldAlert className="w-5 h-5 text-cyan-400" />
          <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500"></span>
          </span>
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-base font-bold tracking-wider text-slate-100">PHISHGUARD</span>
            <span className="text-[12px] uppercase font-semibold tracking-wider px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800/60">
              v3.0
            </span>
          </div>
          <p className="text-[13px] text-slate-400 font-medium tracking-tight">AI Smishing Detection</p>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        <div className="px-3 pb-2 text-[12px] font-semibold uppercase tracking-wider text-slate-400">
          Core Platform
        </div>
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href === '/dashboard' && pathname === '/');
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-gradient-to-r from-cyan-950/80 to-slate-900/80 text-cyan-300 border border-cyan-500/40 shadow-[0_0_12px_rgba(6,182,212,0.15)] font-semibold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon
                  className={`w-4 h-4 transition-colors ${
                    isActive ? 'text-cyan-400' : 'text-slate-400 group-hover:text-cyan-300'
                  }`}
                />
                <span>{item.name}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {isActive && <ChevronRight className="w-3.5 h-3.5 text-cyan-400" />}
              </div>
            </Link>
          );
        })}
      </div>

      {/* Engine Status Bottom Card */}
      <div className="p-3 m-3 rounded-xl bg-slate-900/80 border border-slate-800/90 shadow-inner">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Radio className={`w-3.5 h-3.5 ${health ? 'text-emerald-400 animate-pulse' : 'text-rose-400'}`} />
            <span className="text-[13px] font-semibold text-slate-200">Model API</span>
          </div>
          <span
            className={`text-[12px] px-1.5 py-0.5 rounded font-mono border ${
              health
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
            }`}
          >
            {health ? 'Online' : healthError ? 'Offline' : 'Checking'}
          </span>
        </div>
        {health ? (
          <div className="space-y-1 text-[13px] text-slate-400 font-mono">
            <div className="flex justify-between">
              <span className="text-slate-400">Pipeline:</span>
              <span className="text-slate-300 font-sans truncate max-w-[120px]" title={health.model}>
                {health.model}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">{thresholdOverride === null ? 'Model threshold:' : 'Effective:'}</span>
              <span className="text-cyan-400 font-semibold">{effectiveThreshold?.toFixed(4) ?? '—'}</span>
            </div>
          </div>
        ) : (
          healthError && (
            <p className="text-[13px] text-slate-400 leading-snug break-words">{healthError.message}</p>
          )
        )}
      </div>
    </aside>
  );
}
