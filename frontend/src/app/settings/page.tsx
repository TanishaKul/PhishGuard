'use client';

import React, { useState, useEffect } from 'react';
import {
  Sliders,
  Server,
  Database,
  CheckCircle2,
  RefreshCw,
  Scale,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { ApiErrorPanel, LoadingPanel } from '@/components/ui/ApiErrorPanel';
import {
  ApiError,
  getApiUrl,
  getThresholdOverride,
  setApiUrl,
  setThresholdOverride,
  testApiHealth,
} from '@/lib/api';
import { useModelReport } from '@/lib/hooks';

export default function SettingsPage() {
  const { report, error, retry } = useModelReport();
  const [threshold, setThreshold] = useState<number | null>(null);
  const [appliedThreshold, setAppliedThreshold] = useState<number | null>(null);
  const [apiUrl, setApiUrlValue] = useState<string>('');
  const [connection, setConnection] = useState<{ ok: boolean; text: string } | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [costFn, setCostFn] = useState<number>(10.0);
  const [costFp, setCostFp] = useState<number>(1.0);

  useEffect(() => {
    setApiUrlValue(getApiUrl());
    setAppliedThreshold(getThresholdOverride());
  }, []);

  useEffect(() => {
    if (!report) return;
    setThreshold((t) => t ?? getThresholdOverride() ?? report.metrics.threshold);
    setCostFn(report.metrics.costFnWeight);
    setCostFp(report.metrics.costFpWeight);
  }, [report]);

  const flash = (text: string) => {
    setSavedMessage(text);
    setTimeout(() => setSavedMessage(null), 2500);
  };

  const handleTestAndSave = async () => {
    const candidate = apiUrl.trim();
    setConnection(null);
    try {
      const health = await testApiHealth(candidate);
      setApiUrl(candidate || null);
      setConnection({ ok: true, text: `Connected: ${health.model} (threshold ${health.threshold.toFixed(4)})` });
      flash('API endpoint saved');
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError(String(err), 0);
      setConnection({ ok: false, text: e.hint ? `${e.message} ${e.hint}` : e.message });
    }
  };

  const handleApplyThreshold = () => {
    if (threshold === null) return;
    setThresholdOverride(threshold);
    setAppliedThreshold(threshold);
    flash(`Scans now use threshold ${threshold.toFixed(2)}`);
  };

  const handleResetThreshold = () => {
    setThresholdOverride(null);
    setAppliedThreshold(null);
    if (report) setThreshold(report.metrics.threshold);
    flash("Scans use the model's own threshold");
  };

  // Nearest point on the test-split threshold curve saved at training time.
  const point =
    report && threshold !== null
      ? report.thresholdCurve.reduce((best, p) =>
          Math.abs(p.threshold - threshold) < Math.abs(best.threshold - threshold) ? p : best
        )
      : null;
  const testFraudRate = report?.metrics.fraudRateTest ?? 0;
  const targetPrevalence = report?.metrics.assumedPrevalence;
  const simCost = point
    ? costFn * point.fn * (testFraudRate > 0 && testFraudRate < 1
        ? (targetPrevalence ?? testFraudRate) / testFraudRate
        : 1)
      + costFp * point.fp * (testFraudRate < 1
        ? (1 - (targetPrevalence ?? testFraudRate)) / (1 - testFraudRate)
        : 1)
    : 0;
  const simRecall = point && point.tp + point.fn ? (point.tp / (point.tp + point.fn)) * 100 : 0;
  const simPrecision = point && point.tp + point.fp ? (point.tp / (point.tp + point.fp)) * 100 : 0;
  const modelThreshold = report?.metrics.threshold ?? 0;

  return (
    <AppShell>
      {/* Top Banner */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900/90 via-hero/80 to-slate-900/90 border border-slate-800 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-400">
              System Configuration & Optimization
            </span>
            <span className="text-[12px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800">
              Decision Boundary Tuning
            </span>
          </div>
          <h2 className="text-xl font-bold text-slate-100">Threshold Simulator & API Settings</h2>
          <p className="text-xs text-slate-400">
            Explore threshold trade-offs on the held-out test split and configure the fraud-detection API endpoint.
          </p>
        </div>

        {savedMessage && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-semibold">
            <CheckCircle2 className="w-4 h-4" />
            <span>{savedMessage}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Threshold Simulator (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {!report || !point || threshold === null ? (
            error ? (
              <ApiErrorPanel error={error} onRetry={retry} />
            ) : (
              <LoadingPanel label="Loading threshold curve..." />
            )
          ) : (
            <div className="p-6 rounded-2xl glass-panel border border-slate-800 space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sliders className="w-5 h-5 text-cyan-400" />
                  <h3 className="text-sm font-bold text-slate-100">Operating Threshold Simulator</h3>
                </div>
                <button
                  onClick={handleResetThreshold}
                  className="text-xs font-mono text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Reset to model default ({modelThreshold.toFixed(4)})</span>
                </button>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed">
                Counts below are real: the saved model re-scored on the {report.metrics.testSamples.toLocaleString()}{' '}
                held-out test messages at each threshold (0.01 steps).
              </p>

              {/* Slider Control */}
              <div className="space-y-2 p-4 rounded-xl bg-slate-950 border border-slate-800">
                <div className="flex items-center justify-between font-mono text-xs">
                  <span className="text-slate-400">Decision threshold:</span>
                  <span className="text-base font-bold text-cyan-400">{point.threshold.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.01"
                  max="0.99"
                  step="0.01"
                  value={threshold}
                  onChange={(e) => setThreshold(parseFloat(e.target.value))}
                  className="w-full accent-cyan-500 cursor-pointer"
                />
                <div className="flex justify-between text-[12px] text-slate-500 font-mono pt-1">
                  <span>0.01 (High recall)</span>
                  <span className="text-cyan-400 font-bold">Model default {modelThreshold.toFixed(2)}</span>
                  <span>0.99 (Conservative)</span>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <span className="text-slate-400 text-[12px] block uppercase">Recall</span>
                  <span className="text-emerald-400 text-lg font-bold">{simRecall.toFixed(1)}%</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <span className="text-slate-400 text-[12px] block uppercase">Precision</span>
                  <span className="text-slate-200 text-lg font-bold">{simPrecision.toFixed(1)}%</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <span className="text-slate-400 text-[12px] block uppercase">False Alarms (FP)</span>
                  <span className="text-amber-400 text-lg font-bold">{point.fp}</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <span className="text-slate-400 text-[12px] block uppercase">Missed Fraud (FN)</span>
                  <span className="text-rose-400 text-lg font-bold">{point.fn}</span>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-cyan-950/20 border border-cyan-500/30 flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-slate-200 block">Expected cost on test split:</span>
                  <span className="text-[13px] text-slate-400 font-mono">
                    Reweighted to {((targetPrevalence ?? testFraudRate) * 100).toFixed(1)}% target prevalence from the held-out counts
                  </span>
                </div>
                <div className="text-2xl font-black font-mono text-cyan-400">{simCost.toFixed(1)}</div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[13px] text-slate-400 font-mono">
                  Scans currently use:{' '}
                  <span className="text-cyan-300">
                    {appliedThreshold === null
                      ? `model default (${modelThreshold.toFixed(4)})`
                      : appliedThreshold.toFixed(2)}
                  </span>
                </span>
                <button
                  onClick={handleApplyThreshold}
                  className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-all cursor-pointer"
                >
                  Use {threshold.toFixed(2)} for scans
                </button>
              </div>
            </div>
          )}

          {/* Cost Matrix Weights */}
          <div className="p-6 rounded-2xl glass-panel border border-slate-800 space-y-4">
            <div className="flex items-center gap-2">
              <Scale className="w-5 h-5 text-amber-400" />
              <h3 className="text-sm font-bold text-slate-100">Cost Matrix (simulator only)</h3>
            </div>
            <p className="text-xs text-slate-400">
              Relative penalty for a missed smishing message versus a false alarm. Changing these updates the cost
              above; the model&apos;s default threshold was optimised for the training-time weights.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                <label className="text-xs font-mono text-slate-300 block mb-1.5">
                  Cost False Negative (C_FN):
                </label>
                <input
                  type="number"
                  min="0"
                  value={costFn}
                  onChange={(e) => setCostFn(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-rose-400 font-bold focus:outline-none focus:border-cyan-500"
                />
                <span className="text-[12px] text-slate-500 mt-1 block">
                  Training default: {report?.metrics.costFnWeight ?? '—'}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                <label className="text-xs font-mono text-slate-300 block mb-1.5">
                  Cost False Positive (C_FP):
                </label>
                <input
                  type="number"
                  min="0"
                  value={costFp}
                  onChange={(e) => setCostFp(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-amber-400 font-bold focus:outline-none focus:border-cyan-500"
                />
                <span className="text-[12px] text-slate-500 mt-1 block">
                  Training default: {report?.metrics.costFpWeight ?? '—'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: API endpoint & model info (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="p-6 rounded-2xl glass-panel border border-slate-800 space-y-4">
            <div className="flex items-center gap-2">
              <Server className="w-5 h-5 text-cyan-400" />
              <h3 className="text-sm font-bold text-slate-100">Fraud-Detection API</h3>
            </div>
            <p className="text-xs text-slate-400">
              All scoring runs in the Python API (<code className="font-mono">api_server.py</code>). There is no
              offline mode: if the API is down, scans show an error.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-mono text-slate-400 block">API endpoint:</label>
              <input
                type="text"
                value={apiUrl}
                onChange={(e) => setApiUrlValue(e.target.value)}
                placeholder="http://localhost:8000"
                className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-cyan-400 focus:outline-none focus:border-cyan-500"
              />
            </div>

            {connection && (
              <p className={`text-xs font-mono break-words ${connection.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                {connection.text}
              </p>
            )}

            <button
              onClick={handleTestAndSave}
              className="w-full py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold shadow-[0_0_15px_rgba(6,182,212,0.3)] transition-all cursor-pointer"
            >
              Test Connection & Save
            </button>
          </div>

          <div className="p-6 rounded-2xl glass-panel border border-slate-800 space-y-3 font-mono text-xs">
            <div className="flex items-center gap-2 font-sans font-bold text-slate-200 mb-2">
              <Database className="w-4 h-4 text-cyan-400" />
              <span>Loaded Model</span>
            </div>
            <div className="flex justify-between text-slate-400 border-b border-slate-800/80 pb-1.5">
              <span>Classifier:</span>
              <span className="text-cyan-400 font-bold">{report?.metrics.modelName ?? '—'}</span>
            </div>
            <div className="flex justify-between text-slate-400 border-b border-slate-800/80 pb-1.5">
              <span>Default threshold:</span>
              <span className="text-slate-200">{report ? modelThreshold.toFixed(4) : '—'}</span>
            </div>
            <div className="flex justify-between text-slate-400 border-b border-slate-800/80 pb-1.5">
              <span>Vectorization:</span>
              <span className="text-slate-200">Word (1-2) + Char (3-5) + 12 signals</span>
            </div>
            <div className="flex justify-between text-slate-400 border-b border-slate-800/80 pb-1.5">
              <span>Dataset:</span>
              <span className="text-slate-200">{report?.dataset ?? '—'}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Train / test:</span>
              <span className="text-slate-200">
                {report ? `${report.metrics.trainSamples} / ${report.metrics.testSamples}` : '—'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
