'use client';

import React, { useState } from 'react';
import {
  AlertTriangle,
  Scale,
  XCircle,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import { AppShell } from '@/components/layout/AppShell';
import { ApiErrorPanel, LoadingPanel } from '@/components/ui/ApiErrorPanel';
import { useModelReport } from '@/lib/hooks';
import { ErrorAnalysisItem, FeatureContribution } from '@/lib/types';

function DriverList({ label, drivers, tone }: { label: string; drivers: FeatureContribution[]; tone: 'rose' | 'emerald' }) {
  if (drivers.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
      <span className="text-slate-400">{label}</span>
      {drivers.map((d) => (
        <span
          key={d.term}
          className={`font-mono px-1.5 py-0.5 rounded border ${
            tone === 'rose'
              ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
              : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
          }`}
        >
          {d.term} {d.weight > 0 ? '+' : ''}
          {d.weight.toFixed(2)}
        </span>
      ))}
    </div>
  );
}

function ErrorCard({ item, threshold, tone }: { item: ErrorAnalysisItem; threshold: number; tone: 'rose' | 'amber' }) {
  return (
    <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
      <div className="flex items-center justify-between text-xs font-mono">
        <span className={`${tone === 'rose' ? 'text-rose-400' : 'text-amber-400'} font-bold`}>
          Actual: {item.actual} • Predicted: {item.predicted}
        </span>
        <span className="text-slate-400">
          Score: {item.score.toFixed(3)} (Thr: {threshold.toFixed(3)})
        </span>
      </div>
      <p className="text-xs text-slate-200 font-sans italic bg-slate-900 p-2.5 rounded-lg border border-slate-800 break-words">
        &quot;{item.message}&quot;
      </p>
      <DriverList label="Pushed toward fraud:" drivers={item.fraudDrivers} tone="rose" />
      <DriverList label="Pushed toward legit:" drivers={item.legitimateDrivers} tone="emerald" />
    </div>
  );
}

export default function ModelPerformancePage() {
  const { report, error, retry } = useModelReport();
  const [activeTab, setActiveTab] = useState<'METRICS' | 'COMPARISON' | 'ERRORS'>('METRICS');

  if (!report) {
    return (
      <AppShell>
        {error ? <ApiErrorPanel error={error} onRetry={retry} /> : <LoadingPanel label="Loading evaluation report..." />}
      </AppShell>
    );
  }

  const { metrics, comparisons, errorAnalysis: errors } = report;
  const { tn, fp, fn, tp, total } = metrics.confusionMatrix;
  const legitTotal = tn + fp;
  const fraudTotal = tp + fn;
  const costFn = metrics.costFnWeight;
  const costFp = metrics.costFpWeight;
  const testFraudRate = metrics.fraudRateTest;
  const targetPrevalence = metrics.assumedPrevalence ?? testFraudRate;
  const usesPrevalenceCost = report.selectionMethod === 'target_prevalence_cv_cost';

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
      <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900/90 via-hero/80 to-slate-900/90 border border-slate-800 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-400">
              Hold-Out Test Evaluation
            </span>
            <span className="text-[12px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800">
              {total.toLocaleString()} Test Samples
            </span>
          </div>
          <h2 className="text-xl font-bold text-slate-100">Model Evaluation & Error Diagnostics</h2>
          <p className="text-xs text-slate-400">
            Held-out evaluation under class imbalance ({(metrics.fraudRateTest * 100).toFixed(1)}% fraud rate) with a
            {' '}{costFn}:{costFp} cost ratio. Model and threshold were chosen by cross-validation on the training split only.
          </p>
        </div>

        {/* Tab Buttons */}
        <div className="flex items-center gap-1.5 bg-slate-950/80 p-1 rounded-xl border border-slate-800 text-xs font-mono self-start md:self-auto">
          {(
            [
              { id: 'METRICS', label: 'KPIs & Confusion Matrix' },
              { id: 'COMPARISON', label: 'Model Benchmarking' },
              { id: 'ERRORS', label: 'Error Analysis' },
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
              <span className="text-[12px] uppercase font-mono text-cyan-400 font-bold block mb-1">
                PR-AUC (Primary)
              </span>
              <div className="text-2xl font-black font-mono text-slate-100">
                {(metrics.prAuc * 100).toFixed(2)}%
              </div>
              <span className="text-[12px] text-slate-400 font-mono">Area under PR curve</span>
            </div>

            {/* ROC-AUC */}
            <div className="p-4 rounded-xl glass-panel border border-slate-800">
              <span className="text-[12px] uppercase font-mono text-slate-400 font-bold block mb-1">
                ROC-AUC
              </span>
              <div className="text-2xl font-black font-mono text-slate-100">
                {(metrics.rocAuc * 100).toFixed(2)}%
              </div>
              <span className="text-[12px] text-slate-400 font-mono">Class separability</span>
            </div>

            {/* Recall */}
            <div className="p-4 rounded-xl glass-panel border border-emerald-500/30">
              <span className="text-[12px] uppercase font-mono text-emerald-400 font-bold block mb-1">
                Fraud Recall
              </span>
              <div className="text-2xl font-black font-mono text-emerald-400">
                {(metrics.recall * 100).toFixed(2)}%
              </div>
              <span className="text-[12px] text-slate-400 font-mono">
                {tp} of {fraudTotal} caught
              </span>
            </div>

            {/* Precision */}
            <div className="p-4 rounded-xl glass-panel border border-slate-800">
              <span className="text-[12px] uppercase font-mono text-slate-400 font-bold block mb-1">
                Precision
              </span>
              <div className="text-2xl font-black font-mono text-slate-100">
                {(metrics.precision * 100).toFixed(2)}%
              </div>
              <span className="text-[12px] text-slate-400 font-mono">
                {tp} of {tp + fp} flags correct
              </span>
            </div>

            {/* F1 Score */}
            <div className="p-4 rounded-xl glass-panel border border-slate-800">
              <span className="text-[12px] uppercase font-mono text-slate-400 font-bold block mb-1">
                F1 Score
              </span>
              <div className="text-2xl font-black font-mono text-slate-100">
                {(metrics.f1 * 100).toFixed(2)}%
              </div>
              <span className="text-[12px] text-slate-400 font-mono">Harmonic mean</span>
            </div>

            {/* Expected Cost */}
            <div className="p-4 rounded-xl glass-panel border border-amber-500/30">
              <span className="text-[12px] uppercase font-mono text-amber-400 font-bold block mb-1">
                Expected Cost
              </span>
              <div className="text-2xl font-black font-mono text-amber-400">
                {metrics.expectedCost.toFixed(1)}
              </div>
              <span className="text-[12px] text-slate-400 font-mono">
                {usesPrevalenceCost ? 'Target-prevalence weighted' : 'Raw held-out counts'}
              </span>
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
                    Evaluated on {total.toLocaleString()} held-out SMS messages ({legitTotal} Legit, {fraudTotal} Fraud)
                  </p>
                </div>
                <span className="text-xs font-mono text-cyan-400 bg-cyan-950/60 px-2.5 py-1 rounded border border-cyan-800">
                  Threshold: {metrics.threshold.toFixed(4)}
                </span>
              </div>

              {/* 2x2 Visual Grid */}
              <div className="grid grid-cols-2 gap-3 max-w-lg mx-auto font-mono">
                {/* True Negative */}
                <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/30 text-center">
                  <span className="text-[12px] uppercase font-bold text-emerald-400 block mb-1">
                    True Negative (TN)
                  </span>
                  <div className="text-3xl font-black text-emerald-400">{tn}</div>
                  <span className="text-[13px] text-slate-400">Legit Correctly Passed</span>
                  <span className="text-[12px] text-slate-500 block mt-1">
                    {((tn / (tn + fp)) * 100).toFixed(1)}% Specificity
                  </span>
                </div>

                {/* False Positive */}
                <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-500/30 text-center">
                  <span className="text-[12px] uppercase font-bold text-amber-400 block mb-1">
                    False Positive (FP)
                  </span>
                  <div className="text-3xl font-black text-amber-400">{fp}</div>
                  <span className="text-[13px] text-slate-400">False Alarms</span>
                  <span className="text-[12px] text-slate-500 block mt-1">
                    Cost penalty: {fp} × {costFp} = {fp * costFp}
                  </span>
                </div>

                {/* False Negative */}
                <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-500/50 text-center relative overflow-hidden">
                  <div className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-rose-900 text-rose-300 text-[11px] font-bold">
                    Cost {costFn / costFp}x
                  </div>
                  <span className="text-[12px] uppercase font-bold text-rose-400 block mb-1">
                    False Negative (FN)
                  </span>
                  <div className="text-3xl font-black text-rose-400">{fn}</div>
                  <span className="text-[13px] text-slate-400">Missed Smishing Attack</span>
                  <span className="text-[12px] text-slate-500 block mt-1">
                    Cost penalty: {fn} × {costFn} = {fn * costFn}
                  </span>
                </div>

                {/* True Positive */}
                <div className="p-4 rounded-xl bg-cyan-950/20 border border-cyan-500/30 text-center">
                  <span className="text-[12px] uppercase font-bold text-cyan-400 block mb-1">
                    True Positive (TP)
                  </span>
                  <div className="text-3xl font-black text-cyan-400">{tp}</div>
                  <span className="text-[13px] text-slate-400">Fraud Correctly Caught</span>
                  <span className="text-[12px] text-slate-500 block mt-1">
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
                  Accuracy is misleading here because legitimate messages are{' '}
                  {((1 - metrics.fraudRateTest) * 100).toFixed(1)}% of the test data.
                </p>
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-xs font-mono">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Cost of Missed Fraud (FN):</span>
                    <span className="text-rose-400 font-bold">{costFn}x</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Cost of False Alarm (FP):</span>
                    <span className="text-amber-400 font-bold">{costFp}x</span>
                  </div>
                  <div className="pt-2 border-t border-slate-800 flex justify-between font-bold">
                    <span className="text-slate-200">Total Expected Cost:</span>
                    <span className="text-cyan-400">
                      {usesPrevalenceCost
                        ? `(${costFn} × ${fn} × ${targetPrevalence}/${testFraudRate}) + (${costFp} × ${fp} × ${1 - targetPrevalence}/${1 - testFraudRate})`
                        : `(${costFn} × ${fn}) + (${costFp} × ${fp})`}
                      {' = '}{metrics.expectedCost}
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-cyan-950/20 border border-cyan-500/30 text-xs text-cyan-300">
                <span className="font-bold block mb-1">Threshold rationale:</span>
                The {metrics.threshold.toFixed(4)} threshold minimised expected cost on out-of-fold training predictions.
                On the test split it produces {fp} false alarms and misses {fn} of {fraudTotal} frauds.
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
                {report.selectionMethod === 'target_prevalence_cv_cost'
                  ? 'Stratified 5-fold cross-validation selects the lowest target-prevalence cost; test columns are reported only.'
                  : 'Legacy report: stratified 5-fold CV selected by PR-AUC; test columns are reporting only.'}
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[13px] uppercase tracking-wider text-slate-400 bg-slate-900/80 border-b border-slate-800 font-mono">
                  <tr>
                    <th className="py-3 px-4">Model Architecture</th>
                    <th className="py-3 px-4">CV PR-AUC</th>
                    <th className="py-3 px-4">CV Expected Cost</th>
                    <th className="py-3 px-4">Threshold</th>
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
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-cyan-500 text-slate-950 font-bold uppercase">
                              Selected
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-cyan-400 font-bold">
                        {(c.cvPrAuc * 100).toFixed(2)}%
                      </td>
                      <td className="py-3.5 px-4 text-amber-400">
                        {c.cvExpectedCost === undefined ? '—' : c.cvExpectedCost.toFixed(1)}
                      </td>
                      <td className="py-3.5 px-4 text-slate-300">{c.threshold.toFixed(4)}</td>
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
                          <span className="text-emerald-400 font-bold">
                            {report.selectionMethod === 'target_prevalence_cv_cost' ? 'Lowest CV Cost' : 'Best CV PR-AUC'}
                          </span>
                        ) : (
                          <span className="text-slate-500">Candidate</span>
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
                  <YAxis stroke="#64748b" fontSize={11} domain={[0, 100]} unit="%" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--color-surface)',
                      borderColor: 'var(--color-slate-700)',
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
                  Missed Fraud (False Negatives — {errors.falseNegativesCount} Total)
                </h3>
              </div>
              <span className="text-xs font-mono text-rose-400 font-bold bg-rose-950 px-2.5 py-1 rounded border border-rose-800">
                {fraudTotal ? ((fn / fraudTotal) * 100).toFixed(2) : '0.00'}% of fraud missed
              </span>
            </div>
            <p className="text-xs text-slate-300">
              Real test-split messages, lowest scores first. Chips show the features that moved each score.
            </p>
            <div className="space-y-3">
              {errors.falseNegatives.map((item) => (
                <ErrorCard key={item.message} item={item} threshold={metrics.threshold} tone="rose" />
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
                {legitTotal ? ((fp / legitTotal) * 100).toFixed(2) : '0.00'}% of legit flagged
              </span>
            </div>
            <p className="text-xs text-slate-300">
              Real legitimate test-split messages the model flagged, highest scores first.
            </p>
            <div className="space-y-3">
              {errors.falsePositives.map((item) => (
                <ErrorCard key={item.message} item={item} threshold={metrics.threshold} tone="amber" />
              ))}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
