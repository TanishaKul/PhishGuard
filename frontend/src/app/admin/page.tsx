'use client';

import React, { useEffect, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { AppShell } from '@/components/layout/AppShell';
import { ApiErrorPanel, LoadingPanel } from '@/components/ui/ApiErrorPanel';
import { AdminFeedbackItem, AdminStats, ApiError, formatTimestamp, getAdminFeedback, getAdminStats } from '@/lib/api';

function Tile({ label, value, tone = 'text-slate-100' }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="p-4 rounded-xl glass-panel border border-slate-800">
      <span className="text-[12px] uppercase font-mono text-slate-400 font-bold block mb-1">{label}</span>
      <div className={`text-2xl font-black font-mono ${tone}`}>{value}</div>
    </div>
  );
}

export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [feedback, setFeedback] = useState<AdminFeedbackItem[]>([]);
  const [onlyWrong, setOnlyWrong] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const load = () => {
    setError(null);
    Promise.all([getAdminStats(), getAdminFeedback()])
      .then(([s, f]) => {
        setStats(s);
        setFeedback(f);
      })
      .catch((err) => setError(err instanceof ApiError ? err : new ApiError(String(err), 0)));
  };

  useEffect(load, []);

  if (!stats) {
    return (
      <AppShell>
        {error ? <ApiErrorPanel error={error} onRetry={load} /> : <LoadingPanel label="Loading admin data..." />}
      </AppShell>
    );
  }

  const shown = onlyWrong ? feedback.filter((f) => f.wrong) : feedback;

  return (
    <AppShell>
      <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900/90 via-hero/80 to-slate-900/90 border border-slate-800">
        <h2 className="text-xl font-bold text-slate-100">Admin</h2>
        <p className="text-xs text-slate-400">
          Usage across all accounts and user corrections. Model: {stats.model ?? 'not loaded'}. Export
          corrections for training with <code className="font-mono">python export_feedback.py</code>.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Tile label="Users" value={stats.users} />
        <Tile label="Scans" value={stats.scans} />
        <Tile label="Flagged as fraud" value={stats.fraudScans} tone="text-rose-400" />
        <Tile label="Feedback given" value={stats.feedback} />
        <Tile label="Reported wrong" value={stats.reportedWrong} tone="text-amber-400" />
      </div>

      <div className="p-5 rounded-2xl glass-panel border border-slate-800">
        <h3 className="text-sm font-bold text-slate-200 mb-3">Scans in the last 7 days</h3>
        {stats.scansByDay.length === 0 ? (
          <p className="text-xs text-slate-400">No scans in the last 7 days.</p>
        ) : (
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.scansByDay}>
                <XAxis dataKey="date" stroke="#64748b" fontSize={11} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-slate-700)', borderRadius: '8px', fontSize: '12px' }} />
                <Bar dataKey="count" name="Scans" fill="#06b6d4" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="rounded-2xl glass-panel border border-slate-800 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-slate-200">User feedback</h3>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={onlyWrong} onChange={(e) => setOnlyWrong(e.target.checked)} className="accent-cyan-500" />
            Only results reported wrong
          </label>
        </div>
        <p className="text-[13px] text-slate-500 mb-3">Digits, emails and link paths in messages are scrubbed.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[13px] uppercase tracking-wider text-slate-400 bg-slate-900/60 border-b border-slate-800 font-mono">
              <tr>
                <th className="py-2.5 px-3">When</th>
                <th className="py-2.5 px-3">Message</th>
                <th className="py-2.5 px-3">Model said</th>
                <th className="py-2.5 px-3">User says</th>
                <th className="py-2.5 px-3">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-400">No feedback yet.</td>
                </tr>
              )}
              {shown.map((f) => (
                <tr key={f.scanId}>
                  <td className="py-2.5 px-3 font-mono text-slate-400 whitespace-nowrap"><span title={f.createdAt}>{formatTimestamp(f.createdAt)}</span></td>
                  <td className="py-2.5 px-3 text-slate-200 max-w-md break-words">{f.message}</td>
                  <td className="py-2.5 px-3 font-mono">
                    {f.predicted} {(f.probability * 100).toFixed(0)}% score
                  </td>
                  <td className={`py-2.5 px-3 font-mono font-bold ${f.wrong ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {f.correctLabel === 'fraud' ? 'FRAUD' : 'LEGITIMATE'}
                  </td>
                  <td className="py-2.5 px-3 text-slate-400">{f.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
