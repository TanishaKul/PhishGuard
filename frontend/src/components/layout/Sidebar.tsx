'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ShieldAlert,
  LayoutDashboard,
  ScanLine,
  History,
  BarChart3,
  Tag,
  Cpu,
  Settings,
  ShieldCheck,
  ChevronRight,
  Radio,
} from 'lucide-react';

const NAV_ITEMS = [
  {
    name: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
    badge: null,
  },
  {
    name: 'Analyze',
    href: '/analyze',
    icon: ScanLine,
    badge: 'Live',
    badgeColor: 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30',
  },
  {
    name: 'Scan History',
    href: '/history',
    icon: History,
    badge: null,
  },
  {
    name: 'Threat Analytics',
    href: '/analytics',
    icon: BarChart3,
    badge: null,
  },
  {
    name: 'Fraud Indicators',
    href: '/indicators',
    icon: Tag,
    badge: 'Top 30',
    badgeColor: 'bg-rose-500/20 text-rose-400 border border-rose-500/30',
  },
  {
    name: 'Model Performance',
    href: '/model-performance',
    icon: Cpu,
    badge: '99.1% PR',
    badgeColor: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
  },
  {
    name: 'Settings',
    href: '/settings',
    icon: Settings,
    badge: null,
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-[#090d16]/95 border-r border-slate-800/80 flex flex-col shrink-0 h-screen sticky top-0 z-30 select-none">
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
            <span className="text-[10px] uppercase font-semibold tracking-wider px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800/60">
              v3.0
            </span>
          </div>
          <p className="text-[11px] text-slate-400 font-medium tracking-tight">AI Smishing Detection</p>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Core Platform
        </div>
        {NAV_ITEMS.map((item) => {
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
                {item.badge && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-medium ${item.badgeColor}`}>
                    {item.badge}
                  </span>
                )}
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
            <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span className="text-[11px] font-semibold text-slate-200">Model Engine</span>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
            Active
          </span>
        </div>
        <div className="space-y-1 text-[11px] text-slate-400 font-mono">
          <div className="flex justify-between">
            <span className="text-slate-400">Pipeline:</span>
            <span className="text-slate-300 font-sans truncate max-w-[100px]" title="LinearSVC (calibrated)">
              LinearSVC
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Threshold:</span>
            <span className="text-cyan-400 font-semibold">0.0417</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">PR-AUC:</span>
            <span className="text-emerald-400 font-semibold">0.9912</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
