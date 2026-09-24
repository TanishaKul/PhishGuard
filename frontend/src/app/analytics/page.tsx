'use client';

import React, { useState, useEffect } from 'react';
import {
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { AppShell } from '@/components/layout/AppShell';
import { ApiError, getAnalyticsData, getScanHistory } from '@/lib/api';
import { ApiErrorPanel, LoadingPanel } from '@/components/ui/ApiErrorPanel';
import { AnalyticsData } from '@/lib/types';

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);

  const [error, setError] = useState<ApiError | null>(null);

  const load = () => {
    setError(null);
    getScanHistory()
      .then((items) => setData(getAnalyticsData(items)))
      .catch((err) => setError(err instanceof ApiError ? err : new ApiError(String(err), 0)));
  };

  useEffect(load, []);

  if (!data) {
    return (
      <AppShell>
        {error ? <ApiErrorPanel error={error} onRetry={load} /> : <LoadingPanel label="Loading your scan history..." />}
      </AppShell>
    );
  }

  return (
    <AppShell>
      {/* Top Banner */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900/90 via-hero/80 to-slate-900/90 border border-slate-800 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-400">
              Aggregated Threat Telemetry
            </span>
            <span className="text-[12px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800">
              {data.totalScans} Total Scans
            </span>
          </div>
          <h2 className="text-xl font-bold text-slate-100">Threat Analytics & Longitudinal Trends</h2>
          <p className="text-xs text-slate-400">
            Trends, severity distribution and signal frequencies computed from your scan history.
          </p>
        </div>
      </div>

      {data.totalScans === 0 && (
        <div className="p-5 rounded-2xl glass-panel border border-slate-800 text-xs text-slate-400">
          No scans recorded yet. Charts fill in as you scan messages on the Analyze or Dashboard pages.
        </div>
      )}

      {/* Primary Visualizations Grid: Timeline & Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Detection Timeline (2 cols) */}
        <div className="lg:col-span-2 p-5 rounded-2xl glass-panel border border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-200">Detection Volume & Threat Surge</h3>
              <p className="text-xs text-slate-400">Daily triage count vs. confirmed smishing payloads</p>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="flex items-center gap-1.5 text-cyan-400">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" /> Total Inbound
              </span>
              <span className="flex items-center gap-1.5 text-rose-400">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-400" /> Intercepted Fraud
              </span>
            </div>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.timeline}>
                <defs>
                  <linearGradient id="anScanGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="anFraudGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" stroke="#64748b" fontSize={11} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-surface)',
                    borderColor: 'var(--color-slate-700)',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="scans"
                  stroke="#06b6d4"
                  strokeWidth={2}
                  fill="url(#anScanGrad)"
                  name="Total Inbound"
                />
                <Area
                  type="monotone"
                  dataKey="fraud"
                  stroke="#ef4444"
                  strokeWidth={2}
                  fill="url(#anFraudGrad)"
                  name="Fraud Intercepted"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Severity Breakdown Pie (1 col) */}
        <div className="p-5 rounded-2xl glass-panel border border-slate-800 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-200">Severity Classification</h3>
            <p className="text-xs text-slate-400">High vs. Medium vs. Low risk distribution</p>
          </div>

          <div className="h-48 w-full relative flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                    { name: 'High Risk (Fraud)', count: data.highRiskCount, color: '#ef4444' },
                    { name: 'Medium Risk (Fraud, lower confidence)', count: data.mediumRiskCount, color: '#f59e0b' },
                    { name: 'Low Risk (Below threshold)', count: data.lowRiskCount, color: '#10b981' },
                  ]}
                  dataKey="count"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={75}
                  paddingAngle={4}
                >
                  <Cell fill="#ef4444" />
                  <Cell fill="#f59e0b" />
                  <Cell fill="#10b981" />
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-surface)',
                    borderColor: 'var(--color-slate-700)',
                    borderRadius: '8px',
                    fontSize: '11px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute text-center pointer-events-none">
              <span className="text-lg font-bold font-mono text-slate-100">{data.totalScans}</span>
              <span className="text-[12px] block text-slate-400 uppercase">Messages</span>
            </div>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-slate-300">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> High Severity (Fraud)
              </span>
              <span className="font-mono text-rose-400 font-bold">{data.highRiskCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-slate-300">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Medium (Fraud, lower confidence)
              </span>
              <span className="font-mono text-amber-400 font-bold">{data.mediumRiskCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-slate-300">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Low (Below threshold)
              </span>
              <span className="font-mono text-emerald-400 font-bold">{data.lowRiskCount}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Secondary Visualizations: Risk Score Histogram & Hourly Traffic */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Risk Score Histogram */}
        <div className="p-5 rounded-2xl glass-panel border border-slate-800">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-slate-200">Risk Score Histogram</h3>
            <p className="text-xs text-slate-400">Fraud probability of each scanned message</p>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.riskDistribution}>
                <XAxis dataKey="range" stroke="#64748b" fontSize={10} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-surface)',
                    borderColor: 'var(--color-slate-700)',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {data.riskDistribution.map((entry, index) => (
                    <Cell
                      key={`bar-${index}`}
                      fill={entry.isHighRisk ? '#ef4444' : entry.range === '40-70%' ? '#f59e0b' : '#06b6d4'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top Triggered Signals Bar */}
        <div className="p-5 rounded-2xl glass-panel border border-slate-800">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-slate-200">Signal Presence & Fraud Correlation</h3>
            <p className="text-xs text-slate-400">Share of scans with each signal that the model flagged as fraud</p>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.signalDistribution} layout="vertical">
                <XAxis type="number" stroke="#64748b" fontSize={10} domain={[0, 100]} unit="%" />
                <YAxis dataKey="signal" type="category" stroke="#64748b" fontSize={10} width={130} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-surface)',
                    borderColor: 'var(--color-slate-700)',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  formatter={(val) => [`${val}% flagged as fraud`, 'Fraud Rate']}
                />
                <Bar dataKey="fraudRate" fill="#06b6d4" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
