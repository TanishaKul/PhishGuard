'use client';

import React, { useState } from 'react';
import {
  Search,
  ShieldAlert,
  ShieldCheck,
  Check,
  Copy,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { ApiErrorPanel, LoadingPanel } from '@/components/ui/ApiErrorPanel';
import { useModelReport } from '@/lib/hooks';

// Display copy for the rule categories; the keywords themselves come from the API.
const CATEGORY_COPY: Record<string, { displayName: string; description: string }> = {
  urgency: {
    displayName: 'Urgency & Coercion',
    description: 'Artificial time pressure pushing the reader to act before thinking.',
  },
  account_threat: {
    displayName: 'Account & Security Threats',
    description: 'Warnings about locked, suspended or unverified accounts.',
  },
  financial: {
    displayName: 'Financial & Banking',
    description: 'Money, payments, refunds, prizes and bank references.',
  },
  action_request: {
    displayName: 'Action Directives',
    description: 'Calls to click, verify, confirm, claim or log in.',
  },
  reward_scam: {
    displayName: 'Lottery & Reward Baits',
    description: 'Claims of winnings, free items or guaranteed rewards.',
  },
};

export default function IndicatorsPage() {
  const { report, error, retry } = useModelReport();
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'ALL' | 'FRAUD' | 'LEGITIMATE' | 'DICTIONARY'>('ALL');
  const [copiedTerm, setCopiedTerm] = useState<string | null>(null);

  if (!report) {
    return (
      <AppShell>
        {error ? <ApiErrorPanel error={error} onRetry={retry} /> : <LoadingPanel label="Loading model indicators..." />}
      </AppShell>
    );
  }

  const indicators = report.topIndicators;
  const categories = Object.entries(report.keywordCategories).map(([category, keywords]) => ({
    category,
    keywords,
    displayName: CATEGORY_COPY[category]?.displayName || category,
    description: CATEGORY_COPY[category]?.description || '',
  }));
  const filteredCategories = categories
    .map((item) => ({
      ...item,
      keywords: item.keywords.filter((keyword) => keyword.toLowerCase().includes(search.toLowerCase())),
    }))
    .filter((item) =>
      item.keywords.length > 0 ||
      item.category.toLowerCase().includes(search.toLowerCase()) ||
      item.displayName.toLowerCase().includes(search.toLowerCase())
    );
  const maxAbsWeight = Math.max(...indicators.map((i) => Math.abs(i.weight)), 1e-9);

  const fraudIndicators = indicators.filter((i) => i.type === 'fraud');
  const legitIndicators = indicators.filter((i) => i.type === 'legitimate');

  const filteredIndicators = indicators.filter((i) => {
    const matchesSearch = i.term.toLowerCase().includes(search.toLowerCase());
    const matchesTab =
      tab === 'ALL' ||
      (tab === 'FRAUD' && i.type === 'fraud') ||
      (tab === 'LEGITIMATE' && i.type === 'legitimate');
    return matchesSearch && matchesTab;
  });

  const handleCopy = async (term: string) => {
    try {
      await navigator.clipboard.writeText(term);
      setCopiedTerm(term);
      setTimeout(() => setCopiedTerm(null), 1500);
    } catch {
      setCopiedTerm(null);
    }
  };

  return (
    <AppShell>
      {/* Top Banner */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900/90 via-hero/80 to-slate-900/90 border border-slate-800 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-400">
              Model Feature Explainability
            </span>
            <span className="text-[12px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800">
              {report.metrics.modelName} {report.indicatorMethod === 'average_local_probability_effect' ? 'Local Effects' : 'Legacy Coefficients'}
            </span>
          </div>
          <h2 className="text-xl font-bold text-slate-100">Top Fraud & Benign Indicators</h2>
          <p className="text-xs text-slate-400">
            {report.indicatorMethod === 'average_local_probability_effect'
              ? 'Average local probability effects across training messages, with term frequencies and the rule dictionary.'
              : 'Legacy average fold coefficients from the saved training report. Retrain to regenerate local-effect indicators.'}
          </p>
        </div>
      </div>

      {/* Tabs & Search */}
      <div className="p-4 rounded-xl glass-panel border border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1.5 bg-slate-950/80 p-1 rounded-lg border border-slate-800 text-xs font-mono">
          {(
            [
              { id: 'ALL', label: 'All Indicators' },
              { id: 'FRAUD', label: `🔴 Top Fraud (${fraudIndicators.length})` },
              { id: 'LEGITIMATE', label: `🟢 Top Legitimate (${legitIndicators.length})` },
              { id: 'DICTIONARY', label: '📖 Keyword Dictionary' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded text-xs font-semibold transition-all ${
                tab === t.id
                  ? 'bg-cyan-500 text-slate-950 shadow-[0_0_12px_rgba(6,182,212,0.3)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by term..."
            className="w-full pl-9 pr-4 py-1.5 rounded-lg bg-slate-950/80 border border-slate-800 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>
      </div>

      {/* View 1: Keyword Dictionary View */}
      {tab === 'DICTIONARY' ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredCategories.map((cat) => (
              <div
                key={cat.category}
                className="p-5 rounded-2xl glass-panel border border-slate-800 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-bold text-slate-200">{cat.displayName}</h3>
                    <span className="text-[12px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
                      {cat.keywords.length} terms
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mb-4">{cat.description}</p>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-3 border-t border-slate-800/80">
                  {cat.keywords.map((kw) => (
                    <span
                      key={kw}
                      onClick={() => handleCopy(kw)}
                      className="text-xs font-mono px-2.5 py-1 rounded bg-slate-950 hover:bg-cyan-950/40 text-slate-300 hover:text-cyan-300 border border-slate-800 hover:border-cyan-500/40 cursor-pointer transition-colors"
                      title="Click to copy term"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* View 2: Model Indicator Weights Cards */
        <div className="space-y-6">
          {/* Summary Callouts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl glass-panel border border-rose-900/40 bg-rose-950/10 flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-rose-500/20 text-rose-400 border border-rose-500/30">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs font-bold text-rose-300">Fraud-Indicative Features (Positive Coef)</span>
                <p className="text-[13px] text-slate-400">
                  Tokens like{' '}
                  {fraudIndicators.slice(0, 3).map((i, idx) => (
                    <React.Fragment key={i.term}>
                      {idx > 0 && ', '}
                      <code className="text-rose-400 font-mono">{i.term}</code>
                    </React.Fragment>
                  ))}{' '}
                  increase the fraud score most.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl glass-panel border border-emerald-900/40 bg-emerald-950/10 flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs font-bold text-emerald-300">Legitimate Features (Negative Coef)</span>
                <p className="text-[13px] text-slate-400">
                  Words like{' '}
                  {legitIndicators.slice(0, 3).map((i, idx) => (
                    <React.Fragment key={i.term}>
                      {idx > 0 && ', '}
                      <code className="text-emerald-400 font-mono">{i.term}</code>
                    </React.Fragment>
                  ))}{' '}
                  reduce the fraud score most.
                </p>
              </div>
            </div>
          </div>

          {/* Indicators Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredIndicators.map((ind) => {
              const isFraud = ind.type === 'fraud';
              const barWidth = Math.min(100, Math.round((Math.abs(ind.weight) / maxAbsWeight) * 100));

              return (
                <div
                  key={ind.term}
                  className="p-4 rounded-xl glass-panel border border-slate-800 hover:border-slate-700 transition-all flex flex-col justify-between"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono font-bold text-slate-100">
                        &quot;{ind.term}&quot;
                      </span>
                      <button
                        onClick={() => handleCopy(ind.term)}
                        className="text-slate-500 hover:text-slate-300 transition-colors"
                        title="Copy term"
                      >
                        {copiedTerm === ind.term ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                    <span
                      className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                        isFraud
                          ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                          : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                      }`}
                    >
                      {ind.weight > 0 ? `+${ind.weight.toFixed(4)}` : ind.weight.toFixed(4)}
                    </span>
                  </div>

                  <p className="text-[13px] text-slate-400 mb-3">
                    In {ind.fraudDocs} fraud and {ind.legitDocs} legitimate training messages
                  </p>

                  {/* Weight Magnitude Bar */}
                  <div>
                    <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden mb-1">
                      <div
                        className={`h-full rounded-full ${isFraud ? 'bg-rose-500' : 'bg-emerald-500'}`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[12px] text-slate-500 font-mono">
                      <span>{isFraud ? 'Pushes toward fraud' : 'Pushes toward legit'}</span>
                      <span>|w| relative to max</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </AppShell>
  );
}
