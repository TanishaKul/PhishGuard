'use client';

import React, { useState, useEffect } from 'react';
import {
  Settings,
  Sliders,
  Server,
  Database,
  ShieldAlert,
  CheckCircle2,
  RefreshCw,
  Info,
  Scale,
  Zap,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';

export default function SettingsPage() {
  const [threshold, setThreshold] = useState<number>(0.0417);
  const [apiMode, setApiMode] = useState<'mock' | 'live'>('mock');
  const [apiUrl, setApiUrl] = useState<string>('http://localhost:8000');
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [costFn, setCostFn] = useState<number>(10.0);
  const [costFp, setCostFp] = useState<number>(1.0);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const mode = localStorage.getItem('phishguard_api_mode') as 'mock' | 'live';
      const url = localStorage.getItem('phishguard_api_url');
      if (mode) setApiMode(mode);
      if (url) setApiUrl(url);
    }
  }, []);

  const handleSaveSettings = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('phishguard_api_mode', apiMode);
      localStorage.setItem('phishguard_api_url', apiUrl);
    }
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  // Threshold Simulation Calculations
  // As threshold increases:
  // - FP decreases (e.g. from 50 to 2)
  // - FN increases (e.g. from 0 to 25)
  const simFp = Math.max(0, Math.round(32 * Math.exp(-6 * (threshold - 0.0417))));
  const simFn = Math.max(
    0,
    Math.round(1 + 130 * (1 / (1 + Math.exp(-12 * (threshold - 0.25))) - 0.047))
  );
  const simCost = costFn * simFn + costFp * simFp;
  const simRecall = Math.max(75, Math.min(100, ((131 - simFn) / 131) * 100));
  const simPrecision = Math.max(
    60,
    Math.min(99, ((131 - simFn) / (131 - simFn + simFp || 1)) * 100)
  );

  return (
    <AppShell>
      {/* Top Banner */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900/90 via-[#0b1329]/80 to-slate-900/90 border border-slate-800 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-400">
              System Configuration & Optimization
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800">
              Decision Boundary Tuning
            </span>
          </div>
          <h2 className="text-xl font-bold text-slate-100">Threshold Simulator & Bridge Settings</h2>
          <p className="text-xs text-slate-400">
            Simulate operating threshold trade-offs and configure API endpoints between the mock engine and live backend.
          </p>
        </div>

        {savedSuccess && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-semibold animate-pulse">
            <CheckCircle2 className="w-4 h-4" />
            <span>Settings Saved Successfully</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Threshold Simulator (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="p-6 rounded-2xl glass-panel border border-slate-800 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5 text-cyan-400" />
                <h3 className="text-sm font-bold text-slate-100">
                  Interactive Operating Threshold Simulator
                </h3>
              </div>
              <button
                onClick={() => setThreshold(0.0417)}
                className="text-xs font-mono text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Reset to Optimal (0.0417)</span>
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Moving the decision threshold $\tau$ shifts the trade-off between missing smishing attacks (FN) versus generating false alarms (FP).
            </p>

            {/* Slider Control */}
            <div className="space-y-2 p-4 rounded-xl bg-slate-950 border border-slate-800">
              <div className="flex items-center justify-between font-mono text-xs">
                <span className="text-slate-400">Decision Threshold ($\tau$):</span>
                <span className="text-base font-bold text-cyan-400">
                  {(threshold * 100).toFixed(2)}% ({threshold.toFixed(4)})
                </span>
              </div>
              <input
                type="range"
                min="0.01"
                max="0.60"
                step="0.005"
                value={threshold}
                onChange={(e) => setThreshold(parseFloat(e.target.value))}
                className="w-full accent-cyan-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-500 font-mono pt-1">
                <span>1.0% (High Recall)</span>
                <span className="text-cyan-400 font-bold">4.17% (Optimal Cost Min)</span>
                <span>60.0% (Conservative)</span>
              </div>
            </div>

            {/* Real-time Dynamic Simulation Results */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-slate-400 text-[10px] block uppercase">Est. Recall</span>
                <span className="text-emerald-400 text-lg font-bold">
                  {simRecall.toFixed(1)}%
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-slate-400 text-[10px] block uppercase">Est. Precision</span>
                <span className="text-slate-200 text-lg font-bold">
                  {simPrecision.toFixed(1)}%
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-slate-400 text-[10px] block uppercase">False Alarms (FP)</span>
                <span className="text-amber-400 text-lg font-bold">{simFp}</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-slate-400 text-[10px] block uppercase">Missed Fraud (FN)</span>
                <span className="text-rose-400 text-lg font-bold">{simFn}</span>
              </div>
            </div>

            {/* Total Simulated Cost Callout */}
            <div className="p-4 rounded-xl bg-cyan-950/20 border border-cyan-500/30 flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-slate-200 block">
                  Simulated Expected Cost:
                </span>
                <span className="text-[11px] text-slate-400 font-mono">
                  ({costFn} × {simFn} FN) + ({costFp} × {simFp} FP)
                </span>
              </div>
              <div className="text-2xl font-black font-mono text-cyan-400">
                {simCost.toFixed(1)}
              </div>
            </div>
          </div>

          {/* Cost Matrix Weights */}
          <div className="p-6 rounded-2xl glass-panel border border-slate-800 space-y-4">
            <div className="flex items-center gap-2">
              <Scale className="w-5 h-5 text-amber-400" />
              <h3 className="text-sm font-bold text-slate-100">Cost Matrix Configuration</h3>
            </div>
            <p className="text-xs text-slate-400">
              Set the relative penalty for a missed smishing threat versus an annoying false alarm.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                <label className="text-xs font-mono text-slate-300 block mb-1.5">
                  Cost False Negative (C_FN):
                </label>
                <input
                  type="number"
                  value={costFn}
                  onChange={(e) => setCostFn(parseFloat(e.target.value) || 1)}
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-rose-400 font-bold focus:outline-none focus:border-cyan-500"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">Default: 10.0 (10x worse)</span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                <label className="text-xs font-mono text-slate-300 block mb-1.5">
                  Cost False Negative (C_FN):
                </label>
                <input
                  type="number"
                  value={costFp}
                  onChange={(e) => setCostFp(parseFloat(e.target.value) || 1)}
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-amber-400 font-bold focus:outline-none focus:border-cyan-500"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">Default: 1.0 (Baseline)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: API Mode & System Architecture (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          {/* API Bridge Selector */}
          <div className="p-6 rounded-2xl glass-panel border border-slate-800 space-y-4">
            <div className="flex items-center gap-2">
              <Server className="w-5 h-5 text-cyan-400" />
              <h3 className="text-sm font-bold text-slate-100">API Gateway & Engine Mode</h3>
            </div>
            <p className="text-xs text-slate-400">
              Select between the client-side calibrated mock engine and a live local Python ML API server.
            </p>

            <div className="space-y-3">
              <label
                onClick={() => setApiMode('mock')}
                className={`p-3.5 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                  apiMode === 'mock'
                    ? 'bg-cyan-950/30 border-cyan-500/50 shadow-[0_0_15px_rgba(6,182,212,0.15)]'
                    : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="apiMode"
                  checked={apiMode === 'mock'}
                  onChange={() => setApiMode('mock')}
                  className="mt-1 accent-cyan-500"
                />
                <div>
                  <span className="text-xs font-bold text-slate-200 block">
                    Mock Engine (Fast / Zero Backend Setup)
                  </span>
                  <span className="text-[11px] text-slate-400 leading-relaxed block mt-0.5">
                    Runs deterministic entity extraction and LinearSVC scoring directly in the browser.
                  </span>
                </div>
              </label>

              <label
                onClick={() => setApiMode('live')}
                className={`p-3.5 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                  apiMode === 'live'
                    ? 'bg-cyan-950/30 border-cyan-500/50 shadow-[0_0_15px_rgba(6,182,212,0.15)]'
                    : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="apiMode"
                  checked={apiMode === 'live'}
                  onChange={() => setApiMode('live')}
                  className="mt-1 accent-cyan-500"
                />
                <div>
                  <span className="text-xs font-bold text-slate-200 block">
                    Live Python API Server (Local Bridge)
                  </span>
                  <span className="text-[11px] text-slate-400 leading-relaxed block mt-0.5">
                    Connects to Python joblib pipeline at specified endpoint URL.
                  </span>
                </div>
              </label>
            </div>

            {apiMode === 'live' && (
              <div className="pt-2 space-y-1.5">
                <label className="text-xs font-mono text-slate-400 block">Python Server Endpoint:</label>
                <input
                  type="text"
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  placeholder="http://localhost:8000"
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-cyan-400 focus:outline-none focus:border-cyan-500"
                />
              </div>
            )}

            <button
              onClick={handleSaveSettings}
              className="w-full py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold shadow-[0_0_15px_rgba(6,182,212,0.3)] transition-all cursor-pointer"
            >
              Save Configuration
            </button>
          </div>

          {/* System Environment Information */}
          <div className="p-6 rounded-2xl glass-panel border border-slate-800 space-y-3 font-mono text-xs">
            <div className="flex items-center gap-2 font-sans font-bold text-slate-200 mb-2">
              <Database className="w-4 h-4 text-cyan-400" />
              <span>Machine Learning Environment</span>
            </div>
            <div className="flex justify-between text-slate-400 border-b border-slate-800/80 pb-1.5">
              <span>Model Artifact:</span>
              <span className="text-slate-200">fraud_model.joblib</span>
            </div>
            <div className="flex justify-between text-slate-400 border-b border-slate-800/80 pb-1.5">
              <span>Classifier:</span>
              <span className="text-cyan-400 font-bold">LinearSVC (calibrated)</span>
            </div>
            <div className="flex justify-between text-slate-400 border-b border-slate-800/80 pb-1.5">
              <span>Vectorization:</span>
              <span className="text-slate-200">Word (1-2) + Char (3-5)</span>
            </div>
            <div className="flex justify-between text-slate-400 border-b border-slate-800/80 pb-1.5">
              <span>Dataset:</span>
              <span className="text-slate-200">UCI SMS Collection (spam.csv)</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Training Pipeline:</span>
              <span className="text-slate-200 font-sans">spamham_project_v3.py</span>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
