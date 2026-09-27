'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  ShieldAlert,
  ShieldCheck,
  ScanLine,
  Activity,
  TrendingUp,
  AlertTriangle,
  ArrowRight,
  Zap,
  Radio,
  ExternalLink,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { AppShell } from '@/components/layout/AppShell';
import { ScanResultCard } from '@/components/ui/ScanResultCard';
import { DetailDrawer } from '@/components/ui/DetailDrawer';
import { ApiErrorPanel } from '@/components/ui/ApiErrorPanel';
import { ApiError, formatTimestamp, getAnalyticsData, getScanHistory, scanMessage } from '@/lib/api';
import { useModelReport } from '@/lib/hooks';
import { AnalyticsData, FeedbackLabel, ScanHistoryItem, ScanResult } from '@/lib/types';

export default function DashboardPage() {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [history, setHistory] = useState<ScanHistoryItem[]>([]);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<ScanHistoryItem | null>(null);

  // Quick Analyze State
  const [quickInput, setQuickInput] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [quickResult, setQuickResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState<ApiError | null>(null);
  const { report, error: reportError, retry: retryReport } = useModelReport();

  const [historyError, setHistoryError] = useState<ApiError | null>(null);
  const historyRequest = useRef(0);
  const scanRequest = useRef(0);

  const loadHistory = () => {
    const current = ++historyRequest.current;
    return getScanHistory()
      .then((items) => {
        if (historyRequest.current !== current) return;
        setHistory(items);
        setAnalytics(getAnalyticsData(items));
        setHistoryError(null);
      })
      .catch((err) => {
        if (historyRequest.current === current) {
          setHistoryError(err instanceof ApiError ? err : new ApiError(String(err), 0));
        }
      });
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleQuickScan = async () => {
    if (!quickInput.trim()) return;
    const current = ++scanRequest.current;
    setIsScanning(true);
    setQuickResult(null);
    setScanError(null);
    try {
      const res = await scanMessage(quickInput);
      if (scanRequest.current !== current) return;
      setQuickResult(res);
      await loadHistory();
    } catch (err) {
      if (scanRequest.current === current) {
        setScanError(err instanceof ApiError ? err : new ApiError(String(err), 0));
      }
    } finally {
      if (scanRequest.current === current) setIsScanning(false);
    }
  };

  const handleQuickFeedback = (feedback: FeedbackLabel | null) => {
    setQuickResult((item) => item ? { ...item, feedback } : item);
  };

  const handleHistoryFeedback = (feedback: ScanHistoryItem['feedback']) => {
    if (!selectedHistoryItem) return;
    setSelectedHistoryItem((item) => item
      ? { ...item, feedback, result: { ...item.result, feedback } }
      : item
    );
    setHistory((items) => items.map((item) =>
      item.id === selectedHistoryItem.id
        ? { ...item, feedback, result: { ...item.result, feedback } }
        : item
    ));
  };

  const totalScans = analytics?.totalScans ?? 0;
  const threatShare = totalScans ? Math.round(((analytics?.fraudCount ?? 0) / totalScans) * 100) : 0;
  const highShare = totalScans ? Math.round(((analytics?.highRiskCount ?? 0) / totalScans) * 100) : 0;
  const metrics = report?.metrics;

  return (
    <AppShell>
      {/* Top Welcome / Status Hero Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-slate-900/90 via-hero/80 to-slate-900/90 border border-slate-800 shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-400">
              SecOps Threat Triage Active
            </span>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
            </span>
          </div>
          <h2 className="text-xl font-bold text-slate-100">
            SMS Fraud & Smishing Intelligence Feed
          </h2>
          <p className="text-xs text-slate-400">
            {metrics ? (
              <>
                {metrics.modelName} operating at{' '}
                <span className="text-cyan-300 font-mono">{metrics.threshold.toFixed(4)}</span> decision
                threshold ({(metrics.recall * 100).toFixed(1)}% recall on the held-out test split).
              </>
            ) : (
              'Model details load from the fraud-detection API.'
            )}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Link
            href="/analyze"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 text-slate-950 text-xs font-bold shadow-[0_0_20px_rgba(6,182,212,0.3)] transition-all"
          >
            <ScanLine className="w-4 h-4" />
            <span>Launch Deep Scanner</span>
          </Link>
        </div>
      </div>

      {historyError && <ApiErrorPanel error={historyError} onRetry={loadHistory} />}
      {reportError && <ApiErrorPanel error={reportError} onRetry={retryReport} />}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Scans */}
        <div className="p-4 rounded-xl glass-panel border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium uppercase tracking-wider font-mono">Total Scanned</span>
            <Activity className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="my-2">
            <div className="text-2xl font-black font-mono text-slate-100">
              {totalScans.toLocaleString()}
            </div>
            <span className="text-[13px] text-slate-400 flex items-center gap-1 font-medium">
              <TrendingUp className="w-3 h-3" /> Your scans
            </span>
          </div>
          <div className="w-full bg-slate-800/80 h-1.5 rounded-full overflow-hidden">
            <div className="bg-cyan-500 h-full rounded-full w-full" />
          </div>
        </div>

        {/* Card 2: Confirmed Fraud */}
        <div className="p-4 rounded-xl glass-panel border border-rose-900/40 bg-gradient-to-b from-rose-950/10 to-transparent flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium uppercase tracking-wider font-mono">Fraud Interceptions</span>
            <ShieldAlert className="w-4 h-4 text-rose-400" />
          </div>
          <div className="my-2">
            <div className="text-2xl font-black font-mono text-rose-400">
              {(analytics?.fraudCount ?? 0).toLocaleString()}
            </div>
            <span className="text-[13px] text-rose-400/80 font-mono">
              {threatShare}% of scans flagged
            </span>
          </div>
          <div className="w-full bg-slate-800/80 h-1.5 rounded-full overflow-hidden">
            <div className="bg-rose-500 h-full rounded-full" style={{ width: `${threatShare}%` }} />
          </div>
        </div>

        {/* Card 3: Legitimate Messages */}
        <div className="p-4 rounded-xl glass-panel border border-emerald-900/40 bg-gradient-to-b from-emerald-950/10 to-transparent flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium uppercase tracking-wider font-mono">Legitimate Passed</span>
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="my-2">
            <div className="text-2xl font-black font-mono text-emerald-400">
              {(analytics?.legitCount ?? 0).toLocaleString()}
            </div>
            <span className="text-[13px] text-emerald-400/80 font-mono">
              {totalScans ? 100 - threatShare : 0}% below threshold
            </span>
          </div>
          <div className="w-full bg-slate-800/80 h-1.5 rounded-full overflow-hidden">
            <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${totalScans ? 100 - threatShare : 0}%` }} />
          </div>
        </div>

        {/* Card 4: High-Risk Threats */}
        <div className="p-4 rounded-xl glass-panel border border-amber-900/40 bg-gradient-to-b from-amber-950/10 to-transparent flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium uppercase tracking-wider font-mono">Critical Severity</span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="my-2">
            <div className="text-2xl font-black font-mono text-amber-400">
              {(analytics?.highRiskCount ?? 0).toLocaleString()}
            </div>
            <span className="text-[13px] text-amber-400/80 font-mono">
              &gt;70% risk confidence
            </span>
          </div>
          <div className="w-full bg-slate-800/80 h-1.5 rounded-full overflow-hidden">
            <div className="bg-amber-500 h-full rounded-full" style={{ width: `${highShare}%` }} />
          </div>
        </div>
      </div>

      {/* Hero Component: Large "Analyze a Threat" Card */}
      <div className="rounded-2xl glass-panel border border-cyan-500/30 p-6 relative overflow-hidden shadow-[0_0_30px_rgba(6,182,212,0.1)]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-500/40">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100">Analyze a Threat (Quick Triage)</h3>
              <p className="text-xs text-slate-400">
                Paste any SMS payload to extract entities, test linguistic coercion, and calculate risk score.
              </p>
            </div>
          </div>
          <Link
            href="/analyze"
            className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-mono"
          >
            <span>Full Analysis Console</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {/* Input & Scan Controls */}
        <div className="space-y-3">
          <div className="relative">
            <textarea
              rows={3}
              value={quickInput}
              onChange={(e) => setQuickInput(e.target.value)}
              disabled={isScanning}
              placeholder="Paste suspicious SMS text here (e.g. 'URGENT! Your account has been blocked. Click here to verify...')"
              className="w-full rounded-xl bg-slate-950/80 border border-slate-800 p-3.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/40 transition-all font-sans"
            />
            {isScanning && <div className="animate-scanline" />}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Quick Presets */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[13px] text-slate-400 font-mono">Try Example:</span>
              <button
                type="button"
                disabled={isScanning}
                onClick={() =>
                  setQuickInput(
                    'URGENT! Your account has been blocked. Click here to verify immediately: https://secure-bank-auth.cc'
                  )
                }
                className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 text-[13px] border border-slate-800 font-medium transition-colors"
              >
                ⚠️ Account Threat
              </button>
              <button
                type="button"
                disabled={isScanning}
                onClick={() =>
                  setQuickInput(
                    'Congratulations! You won a free £1,000 Walmart prize. Click http://giftcard-claim.com to redeem.'
                  )
                }
                className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 text-[13px] border border-slate-800 font-medium transition-colors"
              >
                🎁 Prize Scam
              </button>
              <button
                type="button"
                disabled={isScanning}
                onClick={() =>
                  setQuickInput('Hey, are we still meeting at 6 pm today? Let me know!')
                }
                className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 text-[13px] border border-slate-800 font-medium transition-colors"
              >
                💬 Legitimate
              </button>
            </div>

            {/* Submit Scan Button */}
            <button
              onClick={handleQuickScan}
              disabled={isScanning || !quickInput.trim()}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 disabled:opacity-50 text-slate-950 text-xs font-bold shadow-[0_0_15px_rgba(6,182,212,0.3)] transition-all flex items-center gap-2 cursor-pointer"
            >
              {isScanning ? (
                <>
                  <Radio className="w-4 h-4 animate-spin" />
                  <span>Scanning Features...</span>
                </>
              ) : (
                <>
                  <ScanLine className="w-4 h-4" />
                  <span>Run Immediate Triage</span>
                </>
              )}
            </button>
          </div>
        </div>

        {scanError && (
          <div className="mt-6">
            <ApiErrorPanel error={scanError} onRetry={handleQuickScan} />
          </div>
        )}

        {/* Quick Result Output Display */}
        {quickResult && (
          <div className="mt-6 pt-6 border-t border-slate-800">
            <ScanResultCard
              result={quickResult}
              onReset={() => setQuickResult(null)}
              onFeedbackChange={handleQuickFeedback}
            />
          </div>
        )}
      </div>

      {/* Charts Grid: Threat Distribution & Activity Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Timeline Chart (2 cols) */}
        <div className="lg:col-span-2 p-5 rounded-2xl glass-panel border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-200">7-Day Detection Activity</h3>
              <p className="text-xs text-slate-400">Total inbound scans vs. identified smishing threats</p>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="flex items-center gap-1.5 text-cyan-400">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" /> Total Scans
              </span>
              <span className="flex items-center gap-1.5 text-rose-400">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-400" /> Fraud Detected
              </span>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={analytics?.timeline || []}>
                <defs>
                  <linearGradient id="scanGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="fraudGrad" x1="0" y1="0" x2="0" y2="1">
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
                  fill="url(#scanGrad)"
                  name="Total Scans"
                />
                <Area
                  type="monotone"
                  dataKey="fraud"
                  stroke="#ef4444"
                  strokeWidth={2}
                  fill="url(#fraudGrad)"
                  name="Fraud Intercepted"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Threat Distribution Donut (1 col) */}
        <div className="p-5 rounded-2xl glass-panel border border-slate-800 flex flex-col justify-between">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-slate-200">Threat Attack Vectors</h3>
            <p className="text-xs text-slate-400">Distribution of smishing categories</p>
          </div>

          <div className="h-44 w-full relative flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={analytics?.categoryBreakdown || []}
                  dataKey="count"
                  nameKey="name"
                  innerRadius={45}
                  outerRadius={70}
                  paddingAngle={3}
                >
                  {(analytics?.categoryBreakdown || []).map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
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
              <span className="text-lg font-bold font-mono text-slate-100">
                {analytics?.fraudCount ?? 0}
              </span>
              <span className="text-[12px] block text-slate-400 uppercase">Threats</span>
            </div>
          </div>

          <div className="space-y-1.5 text-xs mt-3">
            {(analytics?.categoryBreakdown || []).slice(0, 3).map((item, idx) => (
              <div key={idx} className="flex items-center justify-between text-slate-300">
                <span className="flex items-center gap-1.5 truncate max-w-[170px]">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                  <span className="truncate">{item.name}</span>
                </span>
                <span className="font-mono text-slate-400 font-medium">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Scan Activity Table */}
      <div className="rounded-2xl glass-panel border border-slate-800 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-200">Recent Scan Feed</h3>
            <p className="text-xs text-slate-400">Latest evaluated SMS messages and risk levels</p>
          </div>
          <Link
            href="/history"
            className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-mono"
          >
            <span>View Full Audit History</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[13px] uppercase tracking-wider text-slate-400 bg-slate-900/60 border-b border-slate-800 font-mono">
              <tr>
                <th className="py-2.5 px-3">Timestamp</th>
                <th className="py-2.5 px-3">Message Snippet</th>
                <th className="py-2.5 px-3">Verdict</th>
                <th className="py-2.5 px-3">Risk Score</th>
                <th className="py-2.5 px-3">Confidence</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {history.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-400">
                    No scans yet. Scan a message above to populate this dashboard.
                  </td>
                </tr>
              )}
              {history.slice(0, 5).map((item) => (
                <tr
                  key={item.id}
                  onClick={() => setSelectedHistoryItem(item)}
                  className="hover:bg-slate-800/40 transition-colors cursor-pointer"
                >
                  <td className="py-3 px-3 font-mono text-slate-400 whitespace-nowrap">
                    {formatTimestamp(item.timestamp, 'time')}
                  </td>
                  <td className="py-3 px-3 text-slate-200 max-w-xs truncate">
                    {item.message}
                  </td>
                  <td className="py-3 px-3">
                    <span
                      className={`text-[12px] font-bold px-2 py-0.5 rounded uppercase font-mono ${
                        item.prediction === 'FRAUD'
                          ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                          : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      }`}
                    >
                      {item.prediction}
                    </span>
                  </td>
                  <td className="py-3 px-3 font-mono font-semibold">
                    <span
                      className={
                        item.riskLevel === 'HIGH'
                          ? 'text-rose-400'
                          : item.riskLevel === 'MEDIUM'
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                      }
                    >
                      {item.riskScore.toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-3 px-3 font-mono text-slate-300">
                    {item.confidence.toFixed(1)}%
                  </td>
                  <td className="py-3 px-3 text-right">
                    <button className="text-cyan-400 hover:text-cyan-300 font-mono text-[13px] inline-flex items-center gap-1">
                      <span>Inspect</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Slide-over Inspection Drawer */}
      <DetailDrawer
        item={selectedHistoryItem}
        isOpen={Boolean(selectedHistoryItem)}
        onClose={() => setSelectedHistoryItem(null)}
        onFeedbackChange={handleHistoryFeedback}
      />
    </AppShell>
  );
}
