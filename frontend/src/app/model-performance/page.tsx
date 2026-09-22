'use client';

import React, { useState } from 'react';
import {
  Cpu,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Scale,
  CheckCircle2,
  XCircle,
  HelpCircle,
  TrendingUp,
  BarChart3,
  Layers,
  Info,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from 'recharts';
import { AppShell } from '@/components/layout/AppShell';
import { getErrorAnalysis, getModelComparisons, getModelMetrics } from '@/lib/api';
import { ErrorAnalysisData, ModelComparisonItem, ModelMetrics } from '@/lib/types';

export default function ModelPerformancePage() {
  const [metrics] = useState<ModelMetrics>(getModelMetrics());
  const [comparisons] = useState<ModelComparisonItem[]>(getModelComparisons());
  const [errors] = useState<ErrorAnalysisData>(getErrorAnalysis());
  const [activeTab, setActiveTab] = useState<'METRICS' | 'COMPARISON' | 'ERRORS'>('METRICS');

  const { tn, fp, fn, tp, total } = metrics.confusionMatrix;

  const compareChartData = comparisons.map((c) => ({
    name: c.name.split(' ')[0],
    fullName: c.name,
    prAuc: Number((c.testPrAuc * 100).toFixed(1)),
    recall: Number((c.recall * 100).toFixed(1)),
    precision: Number((c.precision * 100).toFixed(1)),
    expectedCost: c.expectedCost,
    isBest: c.isBest,
  }));

  return (
    <AppShell>
      {/* Top Banner */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900/90 via-[#0b1329]/80 to-slate-900/90 border border-slate-800 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-400">
              Hold-Out Test Evaluation
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800">
              1,034 Test Samples
            </span>
          </div>
          <h2 className="text-xl font-bold text-slate-100">Model Evaluation & Error Diagnostics</h2>
          <p className="text-xs text-slate-400">
            Rigorous evaluation under class imbalance (~12.6% fraud rate) and asymmetric 10:1 cost optimization.
          </p>
        </div>

        {/* Tab Buttons */}
        <div className="flex items-center gap-1.5 bg-slate-950/80 p-1 rounded-xl border border-slate-800 text-xs font-mono self-start md:self-auto">
          {(
            [
              { id: 'METRICS', label: 'KPIs & Confusion Matrix' },
              { id: 'COMPARISON', label: 'Model Benchmarking' },
              { id: 'ERRORS', label: 'Error Analysis (Judges)' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === t.id
                  ? 'bg-cyan-500 text-slate-950 shadow-[0_0_12px_rgba(6,182,212,0.3)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'METRICS' && (
        <div className="space-y-6">
          {/* Core KPI Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* PR-AUC */}
            <div className="p-4 rounded-xl glass-panel border border-cyan-500/40 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
              <span className="text-[10px] uppercase font-mono text-cyan-400 font-bold block mb-1">
                PR-AUC (Primary)
              </span>
              <div className="text-2xl font-black font-mono text-slate-100">
                {(metrics.prAuc * 100).toFixed(2)}%
              </div>
              <span className="text-[10px] text-slate-400 font-mono">Area under PR curve</span>
            </div>

            {/* ROC-AUC */}
            <div className="p-4 rounded-xl glass-panel border border-slate-800">
              <span className="text-[10px] uppercase font-mono text-slate-400 font-bold block mb-1">
                ROC-AUC
              </span>
              <div className="text-2xl font-black font-mono text-slate-100">
                {(metrics.rocAuc * 100).toFixed(2)}%
              </div>
              <span className="text-[10px] text-slate-400 font-mono">Class separability</span>
            </div>

            {/* Recall */}
            <div className="p-4 rounded-xl glass-panel border border-emerald-500/30">
              <span className="text-[10px] uppercase font-mono text-emerald-400 font-bold block mb-1">
                Fraud Recall
              </span>
              <div className="text-2xl font-black font-mono text-emerald-400">
                {(metrics.recall * 100).toFixed(2)}%
              </div>
              <span className="text-[10px] text-slate-400 font-mono">130 of 131 caught</span>
            </div>

            {/* Precision */}
            <div className="p-4 rounded-xl glass-panel border border-slate-800">
              <span className="text-[10px] uppercase font-mono text-slate-400 font-bold block mb-1">
                Precision
              </span>
              <div className="text-2xl font-black font-mono text-slate-100">
                {(metrics.precision * 100).toFixed(2)}%
              </div>
              <span className="text-[10px] text-slate-400 font-mono">80.2% positive predictive</span>
            </div>

            {/* F1 Score */}
            <div className="p-4 rounded-xl glass-panel border border-slate-800">
              <span className="text-[10px] uppercase font-mono text-slate-400 font-bold block mb-1">
                F1 Score
              </span>
              <div className="text-2xl font-black font-mono text-slate-100">
                {(metrics.f1 * 100).toFixed(2)}%
              </div>
              <span className="text-[10px] text-slate-400 font-mono">Harmonic mean</span>
            </div>

            {/* Expected Cost */}
            <div className="p-4 rounded-xl glass-panel border border-amber-500/30">
              <span className="text-[10px] uppercase font-mono text-amber-400 font-bold block mb-1">
                Expected Cost
              </span>
              <div className="text-2xl font-black font-mono text-amber-400">
                {metrics.expectedCost.toFixed(1)}
              </div>
              <span className="text-[10px] text-slate-400 font-mono">10×FN + 1×FP</span>
            </div>
          </div>

          {/* Interactive Confusion Matrix & Cost Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Confusion Matrix (7 cols) */}
            <div className="lg:col-span-7 p-6 rounded-2xl glass-panel border border-slate-800">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-sm font-bold text-slate-100">Test Set Confusion Matrix</h3>
                  <p className="text-xs text-slate-400">
                    Evaluated on 1,034 held-out SMS messages (903 Legit, 131 Fraud)
                  </p>
                </div>
                <span className="text-xs font-mono text-cyan-400 bg-cyan-950/60 px-2.5 py-1 rounded border border-cyan-800">
                  Threshold: 0.0417
                </span>
              </div>

              {/* 2x2 Visual Grid */}
              <div className="grid grid-cols-2 gap-3 max-w-lg mx-auto font-mono">
                {/* True Negative */}
                <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/30 text-center">
                  <span className="text-[10px] uppercase font-bold text-emerald-400 block mb-1">
                    True Negative (TN)
                  </span>
                  <div className="text-3xl font-black text-emerald-400">{tn}</div>
                  <span className="text-[11px] text-slate-400">Legit Correctly Passed</span>
                  <span className="text-[10px] text-slate-500 block mt-1">
                    {((tn / (tn + fp)) * 100).toFixed(1)}% Specificity
                  </span>
                </div>

                {/* False Positive */}
                <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-500/30 text-center">
                  <span className="text-[10px] uppercase font-bold text-amber-400 block mb-1">
                    False Positive (FP)
                  </span>
                  <div className="text-3xl font-black text-amber-400">{fp}</div>
                  <span className="text-[11px] text-slate-400">False Alarms</span>
                  <span className="text-[10px] text-slate-500 block mt-1">
                    Cost penalty: {fp} × 1.0 = {fp}
                  </span>
                </div>

                {/* False Negative */}
                <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-500/50 text-center relative overflow-hidden">
                  <div className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-rose-900 text-rose-300 text-[9px] font-bold">
                    Cost 10x
                  </div>
                  <span className="text-[10px] uppercase font-bold text-rose-400 block mb-1">
                    False Negative (FN)
                  </span>
                  <div className="text-3xl font-black text-rose-400">{fn}</div>
                  <span className="text-[11px] text-slate-400">Missed Smishing Attack</span>
                  <span className="text-[10px] text-slate-500 block mt-1">
                    Cost penalty: {fn} × 10.0 = {fn * 10}
                  </span>
                </div>

                {/* True Positive */}
                <div className="p-4 rounded-xl bg-cyan-950/20 border border-cyan-500/30 text-center">
                  <span className="text-[10px] uppercase font-bold text-cyan-400 block mb-1">
                    True Positive (TP)
                  </span>
                  <div className="text-3xl font-black text-cyan-400">{tp}</div>
                  <span className="text-[11px] text-slate-400">Fraud Correctly Caught</span>
                  <span className="text-[10px] text-slate-500 block mt-1">
                    {((tp / (tp + fn)) * 100).toFixed(1)}% Recall
                  </span>
                </div>
              </div>
            </div>

            {/* Cost Optimization Explanation (5 cols) */}
            <div className="lg:col-span-5 p-6 rounded-2xl glass-panel border border-slate-800 flex flex-col justify-between space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Scale className="w-5 h-5 text-cyan-400" />
                  <h3 className="text-sm font-bold text-slate-100">Why Cost-Sensitive Triage?</h3>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed mb-3">
                  In SMS fraud detection, standard accuracy is misleading because legitimate messages represent ~87.4% of traffic.
                </p>
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-xs font-mono">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Cost of Missed Fraud (FN):</span>
                    <span className="text-rose-400 font-bold">10.0x</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Cost of False Alarm (FP):</span>
                    <span className="text-amber-400 font-bold">1.0x</span>
                  </div>
                  <div className="pt-2 border-t border-slate-800 flex justify-between font-bold">
                    <span className="text-slate-200">Total Expected Cost:</span>
                    <span className="text-cyan-400">
                      (10 × {fn}) + (1 × {fp}) = {metrics.expectedCost}
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-cyan-950/20 border border-cyan-500/30 text-xs text-cyan-300">
                <span className="font-bold block mb-1">Defense Rationale:</span>
                The 0.0417 operating threshold intentionally trades 32 mild false alarms to ensure 99.24% of attacks are neutralized.
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'COMPARISON' && (
        <div className="space-y-6">
          {/* Comparison Table */}
          <div className="rounded-2xl glass-panel border border-slate-800 overflow-hidden">
            <div className="p-5 border-b border-slate-800">
              <h3 className="text-sm font-bold text-slate-100">Cross-Validated Classifier Benchmark</h3>
              <p className="text-xs text-slate-400">
                Stratified 5-Fold Cross-Validation on training split with identical feature pipelines.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[11px] uppercase tracking-wider text-slate-400 bg-slate-900/80 border-b border-slate-800 font-mono">
                  <tr>
                    <th className="py-3 px-4">Model Architecture</th>
                    <th className="py-3 px-4">CV PR-AUC</th>
                    <th className="py-3 px-4">Test PR-AUC</th>
                    <th className="py-3 px-4">Test ROC-AUC</th>
                    <th className="py-3 px-4">Recall</th>
                    <th className="py-3 px-4">Precision</th>
                    <th className="py-3 px-4">Expected Cost</th>
                    <th className="py-3 px-4 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {comparisons.map((c) => (
                    <tr
                      key={c.name}
                      className={`hover:bg-slate-800/40 transition-colors ${
                        c.isBest ? 'bg-cyan-950/20 font-semibold' : ''
                      }`}
                    >
                      <td className="py-3.5 px-4 font-sans text-slate-200">
                        <div className="flex items-center gap-2">
                          <span>{c.name}</span>
                          {c.isBest && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500 text-slate-950 font-bold uppercase">
                              Production Choice
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-cyan-400 font-bold">
                        {(c.cvPrAuc * 100).toFixed(2)}%
                      </td>
                      <td className="py-3.5 px-4 text-emerald-400 font-bold">
                        {(c.testPrAuc * 100).toFixed(2)}%
                      </td>
                      <td className="py-3.5 px-4 text-slate-300">
                        {(c.testRocAuc * 100).toFixed(2)}%
                      </td>
                      <td className="py-3.5 px-4 text-emerald-400">
                        {(c.recall * 100).toFixed(2)}%
                      </td>
                      <td className="py-3.5 px-4 text-slate-300">
                        {(c.precision * 100).toFixed(2)}%
                      </td>
                      <td className="py-3.5 px-4 text-amber-400 font-bold">
                        {c.expectedCost.toFixed(1)}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {c.isBest ? (
                          <span className="text-emerald-400 font-bold">Optimal</span>
                        ) : (
                          <span className="text-slate-500">Baseline</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Comparison Bar Chart */}
          <div className="p-5 rounded-2xl glass-panel border border-slate-800">
            <div className="mb-4">
              <h3 className="text-sm font-bold text-slate-100">PR-AUC & Recall Benchmark</h3>
              <p className="text-xs text-slate-400">Comparing candidate models on test set</p>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={compareChartData}>
                  <XAxis dataKey="fullName" stroke="#64748b" fontSize={11} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} domain={[80, 100]} unit="%" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#090d16',
                      borderColor: '#334155',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="prAuc" name="PR-AUC %" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="recall" name="Recall %" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'ERRORS' && (
        <div className="space-y-6">
          {/* Missed Fraud (False Negatives) */}
          <div className="p-5 rounded-2xl glass-panel border border-rose-900/40 bg-rose-950/10 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <XCircle className="w-5 h-5 text-rose-400" />
                <h3 className="text-sm font-bold text-slate-100">
                  Missed Fraud Samples (False Negatives — {errors.falseNegativesCount} Total)
                </h3>
              </div>
              <span className="text-xs font-mono text-rose-400 font-bold bg-rose-950 px-2.5 py-1 rounded border border-rose-800">
                0.76% Error Rate
              </span>
            </div>
            <p className="text-xs text-slate-300">
              Judges frequently ask what the model fails on. Here is the single missed smishing attack from the test set:
            </p>

            <div className="space-y-3">
              {errors.falseNegatives.map((item) => (
                <div
                  key={item.id}
                  className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2"
                >
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-rose-400 font-bold">Actual: FRAUD • Predicted: LEGIT</span>
                    <span className="text-slate-400">Score: {item.score} (Thr: 0.0417)</span>
                  </div>
                  <p className="text-xs text-slate-200 font-sans italic bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                    &quot;{item.message}&quot;
                  </p>
                  <div className="text-xs text-slate-400">
                    <span className="font-semibold text-slate-300">Diagnostic Root Cause:</span>{' '}
                    {item.whyMissedOrAlarm}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* False Alarms (False Positives) */}
          <div className="p-5 rounded-2xl glass-panel border border-amber-900/40 bg-amber-950/10 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-bold text-slate-100">
                  False Alarms (False Positives — {errors.falsePositivesCount} Total)
                </h3>
              </div>
              <span className="text-xs font-mono text-amber-400 font-bold bg-amber-950 px-2.5 py-1 rounded border border-amber-800">
                3.1% Alarm Rate
              </span>
            </div>
            <p className="text-xs text-slate-300">
              Legitimate messages containing words commonly weaponized by phishers (e.g. &quot;bank&quot;, &quot;urgent&quot;, &quot;free&quot;):
            </p>

            <div className="space-y-3">
              {errors.falsePositives.map((item) => (
                <div
                  key={item.id}
                  className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2"
                >
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-amber-400 font-bold">Actual: LEGIT • Predicted: FRAUD</span>
                    <span className="text-slate-400">Score: {item.score}</span>
                  </div>
                  <p className="text-xs text-slate-200 font-sans italic bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                    &quot;{item.message}&quot;
                  </p>
                  <div className="text-xs text-slate-400">
                    <span className="font-semibold text-slate-300">Diagnostic Root Cause:</span>{' '}
                    {item.whyMissedOrAlarm}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
