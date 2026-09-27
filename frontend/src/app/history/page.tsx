'use client';

import React, { useState, useEffect } from 'react';
import {
  Search,
  Download,
  Trash2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { DetailDrawer } from '@/components/ui/DetailDrawer';
import { ApiErrorPanel, LoadingPanel } from '@/components/ui/ApiErrorPanel';
import { ApiError, clearScanHistory, formatTimestamp, getScanHistory } from '@/lib/api';
import { FeedbackLabel, ScanHistoryItem } from '@/lib/types';

export default function HistoryPage() {
  const [history, setHistory] = useState<ScanHistoryItem[]>([]);
  const [search, setSearch] = useState('');
  const [verdictFilter, setVerdictFilter] = useState<'ALL' | 'FRAUD' | 'LEGITIMATE'>('ALL');
  const [riskFilter, setRiskFilter] = useState<'ALL' | 'HIGH' | 'MEDIUM' | 'LOW'>('ALL');
  const [sortField, setSortField] = useState<'timestamp' | 'riskScore' | 'confidence'>('timestamp');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedItem, setSelectedItem] = useState<ScanHistoryItem | null>(null);

  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setError(null);
    setLoading(true);
    getScanHistory()
      .then(setHistory)
      .catch((err) => setError(err instanceof ApiError ? err : new ApiError(String(err), 0)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleClear = async () => {
    if (!window.confirm(`Delete all ${history.length} scans from your history? This cannot be undone.`)) return;
    try {
      await clearScanHistory();
      setHistory([]);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(String(err), 0));
    }
  };

  const handleSort = (field: 'timestamp' | 'riskScore' | 'confidence') => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const filteredHistory = history
    .filter((item) => {
      const matchesSearch =
        item.message.toLowerCase().includes(search.toLowerCase()) ||
        item.id.toLowerCase().includes(search.toLowerCase());
      const matchesVerdict = verdictFilter === 'ALL' || item.prediction === verdictFilter;
      const matchesRisk = riskFilter === 'ALL' || item.riskLevel === riskFilter;
      return matchesSearch && matchesVerdict && matchesRisk;
    })
    .sort((a, b) => {
      let comparison = 0;
      if (sortField === 'timestamp') {
        comparison = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      } else if (sortField === 'riskScore') {
        comparison = a.riskScore - b.riskScore;
      } else if (sortField === 'confidence') {
        comparison = a.confidence - b.confidence;
      }
      return sortOrder === 'desc' ? -comparison : comparison;
    });

  const handleFeedbackChange = (feedback: FeedbackLabel | null) => {
    if (!selectedItem) return;
    setHistory((items) => items.map((item) =>
      item.id === selectedItem.id
        ? { ...item, feedback, result: { ...item.result, feedback } }
        : item
    ));
    setSelectedItem((item) => item
      ? { ...item, feedback, result: { ...item.result, feedback } }
      : item
    );
  };

  const handleExportCSV = () => {
    const safeCell = (value: string | number) => {
      const text = String(value);
      return /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
    };
    const headers = ['ID', 'Timestamp', 'Verdict', 'Risk Level', 'Risk Score (%)', 'Confidence (%)', 'Message'];
    const rows = filteredHistory.map((item) => [
      safeCell(item.id),
      safeCell(item.timestamp),
      safeCell(item.prediction),
      safeCell(item.riskLevel),
      item.riskScore,
      item.confidence,
      `"${safeCell(item.message).replace(/"/g, '""')}"`,
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `phishguard_scans_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell>
      {/* Top Banner */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900/90 via-hero/80 to-slate-900/90 border border-slate-800 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-400">
              Audit Logs & Telemetry
            </span>
            <span className="text-[12px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800">
              {history.length} Total Records
            </span>
          </div>
          <h2 className="text-xl font-bold text-slate-100">Scan History & Diagnostic Records</h2>
          <p className="text-xs text-slate-400">
            Search, filter, and inspect previously analyzed SMS messages. Click any row to view full feature extractions.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <button
            onClick={handleExportCSV}
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-semibold border border-slate-800 flex items-center gap-2 transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4 text-cyan-400" />
            <span>Export Logs (.CSV)</span>
          </button>
          <button
            onClick={handleClear}
            disabled={history.length === 0}
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-rose-950/40 disabled:opacity-40 text-slate-200 text-xs font-semibold border border-slate-800 flex items-center gap-2 transition-colors cursor-pointer"
          >
            <Trash2 className="w-4 h-4 text-rose-400" />
            <span>Clear History</span>
          </button>
        </div>
      </div>

      {error && <ApiErrorPanel error={error} onRetry={load} />}
      {loading && <LoadingPanel label="Loading scan history..." />}

      {!loading && (
        <>
      <div className="p-4 rounded-xl glass-panel border border-slate-800 flex flex-wrap items-center justify-between gap-4">
        {/* Search */}
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by text content or Scan ID..."
            className="w-full pl-9 pr-4 py-1.5 rounded-lg bg-slate-950/80 border border-slate-800 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>

        {/* Verdict Filters */}
        <div className="flex items-center gap-1.5 bg-slate-950/80 p-1 rounded-lg border border-slate-800 text-xs font-mono">
          <span className="text-[12px] text-slate-400 px-2 uppercase">Verdict:</span>
          {(['ALL', 'FRAUD', 'LEGITIMATE'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setVerdictFilter(v)}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-all ${
                verdictFilter === v
                  ? v === 'FRAUD'
                    ? 'bg-rose-500 text-slate-950 shadow-[0_0_10px_rgba(239,68,68,0.4)]'
                    : v === 'LEGITIMATE'
                    ? 'bg-emerald-500 text-slate-950 shadow-[0_0_10px_rgba(16,185,129,0.4)]'
                    : 'bg-cyan-500 text-slate-950 shadow-[0_0_10px_rgba(6,182,212,0.4)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        {/* Risk Filters */}
        <div className="flex items-center gap-1.5 bg-slate-950/80 p-1 rounded-lg border border-slate-800 text-xs font-mono">
          <span className="text-[12px] text-slate-400 px-2 uppercase">Severity:</span>
          {(['ALL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRiskFilter(r)}
              className={`px-2 py-1 rounded text-xs font-semibold transition-all ${
                riskFilter === r
                  ? 'bg-slate-800 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Interactive Table */}
      <div className="rounded-2xl glass-panel border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[13px] uppercase tracking-wider text-slate-400 bg-slate-900/80 border-b border-slate-800 font-mono whitespace-nowrap">
              <tr>
                <th
                  onClick={() => handleSort('timestamp')}
                  className="py-3 px-4 cursor-pointer hover:text-slate-200"
                >
                  <div className="flex items-center gap-1">
                    <span>Timestamp</span>
                    {sortField === 'timestamp' &&
                      (sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                  </div>
                </th>
                <th className="py-3 px-4">Message Preview</th>
                <th className="py-3 px-4">Verdict</th>
                <th className="py-3 px-4">Severity Level</th>
                <th
                  onClick={() => handleSort('riskScore')}
                  className="py-3 px-4 cursor-pointer hover:text-slate-200"
                >
                  <div className="flex items-center gap-1">
                    <span>Risk Score</span>
                    {sortField === 'riskScore' &&
                      (sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('confidence')}
                  className="py-3 px-4 cursor-pointer hover:text-slate-200"
                >
                  <div className="flex items-center gap-1">
                    <span>Confidence</span>
                    {sortField === 'confidence' &&
                      (sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                  </div>
                </th>
                <th className="py-3 px-4 text-right">Telemetry</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredHistory.length > 0 ? (
                filteredHistory.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => setSelectedItem(item)}
                    className="hover:bg-slate-800/40 transition-colors cursor-pointer group"
                  >
                    <td className="py-3 px-4 font-mono text-slate-400 whitespace-nowrap">
                      <span title={item.timestamp}>{formatTimestamp(item.timestamp)}</span>
                    </td>
                    <td className="py-3 px-4 max-w-sm text-slate-200">
                      <p className="truncate">{item.message}</p>
                      {item.topReason && (
                        <span className="text-[12px] text-slate-400 font-mono block mt-0.5 truncate">
                          Flag: {item.topReason}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
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
                    <td className="py-3 px-4 font-mono font-bold text-[12px]">
                      <span
                        className={`px-2 py-0.5 rounded ${
                          item.riskLevel === 'HIGH'
                            ? 'bg-rose-950 text-rose-300 border border-rose-800'
                            : item.riskLevel === 'MEDIUM'
                            ? 'bg-amber-950 text-amber-300 border border-amber-800'
                            : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                        }`}
                      >
                        {item.riskLevel}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono font-bold">
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
                    <td className="py-3 px-4 font-mono text-slate-300">
                      {item.confidence.toFixed(1)}%
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button className="text-cyan-400 group-hover:text-cyan-300 font-mono text-[13px] inline-flex items-center gap-1">
                        <span>Inspect</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-slate-500">
                    No scans match the active search and filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Slide-over Detail Drawer */}
      <DetailDrawer
        item={selectedItem}
        isOpen={Boolean(selectedItem)}
        onClose={() => setSelectedItem(null)}
        onFeedbackChange={handleFeedbackChange}
      />
        </>
      )}
    </AppShell>
  );
}
