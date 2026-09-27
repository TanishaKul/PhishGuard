'use client';

import React, { useRef, useState } from 'react';
import {
  ScanLine,
  Eraser,
  Radio,
  Zap,
  Terminal,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { ScanResultCard } from '@/components/ui/ScanResultCard';
import { ApiErrorPanel } from '@/components/ui/ApiErrorPanel';
import { ApiError, getThresholdOverride, scanMessage } from '@/lib/api';
import { useApiHealth } from '@/lib/hooks';
import { ScanResult } from '@/lib/types';

const PRESET_EXAMPLES = [
  {
    id: 'account_threat',
    label: '⚠️ Account Threat',
    category: 'Urgency & Security Warning',
    text: 'URGENT! Your account has been blocked. Click here to verify immediately.',
  },
  {
    id: 'prize_scam',
    label: '🎁 Prize Scam',
    category: 'Financial & Reward Bait',
    text: 'Congratulations! You won a free prize. Click this link to claim.',
  },
  {
    id: 'legitimate',
    label: '💬 Legitimate Chat',
    category: 'Benign Conversational',
    text: 'Hey, are we still meeting at 6 pm today?',
  },
  {
    id: 'delivery_phish',
    label: '📦 Delivery Scam',
    category: 'Parcel Logistics Impersonation',
    text: 'USPS Notice: Your package delivery #94821 is pending. Update your address at http://usps-track-parcel.info to avoid return.',
  },
  {
    id: 'tax_refund',
    label: '💰 Tax Refund',
    category: 'Authority & Monetary Lure',
    text: 'IRS Notification: An outstanding refund of $640.00 is ready for deposit. Claim your funds at https://irs-direct-refund.cc immediately.',
  },
];

const SCAN_STEPS = [
  'Preserving entity tokens (<url>, <phone>, <cur>, <shortcode>)...',
  'Vectorizing word n-grams (1-2) & character n-grams (3-5)...',
  'Calculating 12 handcrafted fraud heuristics (uppercase, digits, urgency)...',
  'Computing calibrated fraud probability...',
];

export default function AnalyzePage() {
  const { health } = useApiHealth();
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanStepIndex, setScanStepIndex] = useState(0);
  const [result, setResult] = useState<ScanResult | null>(null);
  const scanRequest = useRef(0);

  const charCount = message.length;
  const wordCount = message.trim() ? message.trim().split(/\s+/).length : 0;
  const thresholdOverride = getThresholdOverride();
  const effectiveThreshold = thresholdOverride ?? health?.threshold;

  const handleScan = async () => {
    if (!message.trim()) return;
    const current = ++scanRequest.current;

    setIsScanning(true);
    setResult(null);
    setError(null);
    setScanStepIndex(0);

    // Step animation sequence
    const stepInterval = setInterval(() => {
      setScanStepIndex((prev) => (prev < SCAN_STEPS.length - 1 ? prev + 1 : prev));
    }, 180);

    try {
      const scanned = await scanMessage(message);
      if (scanRequest.current === current) setResult(scanned);
    } catch (err) {
      if (scanRequest.current === current) {
        setError(err instanceof ApiError ? err : new ApiError(String(err), 0));
      }
    } finally {
      clearInterval(stepInterval);
      if (scanRequest.current === current) setIsScanning(false);
    }
  };

  const handleClear = () => {
    if (isScanning) return;
    scanRequest.current++;
    setMessage('');
    setResult(null);
    setError(null);
  };

  const handleApplyPreset = (text: string) => {
    if (isScanning) return;
    setMessage(text);
    setResult(null);
  };

  return (
    <AppShell>
      {/* Top Banner */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900/90 via-hero/80 to-slate-900/90 border border-slate-800 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-400">
              Interactive Diagnostic Console
            </span>
            {effectiveThreshold !== undefined && (
              <span className="text-[12px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800">
                {thresholdOverride === null ? 'Model threshold' : 'Effective threshold'} {(effectiveThreshold * 100).toFixed(2)}%
              </span>
            )}
          </div>
          <h2 className="text-xl font-bold text-slate-100">SMS Threat Intelligence Scanner</h2>
          <p className="text-xs text-slate-400">
            Paste any inbound SMS message for multi-layer entity extraction, linguistic coercion detection, and cost-sensitive risk scoring.
          </p>
        </div>
      </div>

      {/* Main Scanner Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left / Input Console (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="rounded-2xl glass-panel border border-slate-800 p-5 relative overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-mono font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Terminal className="w-4 h-4 text-cyan-400" />
                <span>Inbound SMS Payload</span>
              </span>
              <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
                <span>{charCount} chars</span>
                <span>•</span>
                <span>{wordCount} words</span>
              </div>
            </div>

            {/* Textarea */}
            <div className="relative">
              <textarea
                rows={6}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={isScanning}
                placeholder="Paste SMS content here to evaluate..."
                className="w-full rounded-xl bg-slate-950/80 border border-slate-800 p-4 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/40 transition-all font-sans leading-relaxed resize-y min-h-[140px]"
              />
              {isScanning && <div className="animate-scanline" />}
            </div>

            {/* Console Toolbar */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800/80">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={isScanning || (!message && !result)}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-slate-400 hover:text-slate-200 text-xs font-medium border border-slate-800 flex items-center gap-1.5 transition-colors"
                >
                  <Eraser className="w-3.5 h-3.5" />
                  <span>Clear</span>
                </button>
              </div>

              <button
                onClick={handleScan}
                disabled={isScanning || !message.trim()}
                className="px-6 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 disabled:opacity-40 text-slate-950 text-xs font-black shadow-[0_0_20px_rgba(6,182,212,0.3)] transition-all flex items-center gap-2 cursor-pointer"
              >
                {isScanning ? (
                  <>
                    <Radio className="w-4 h-4 animate-spin" />
                    <span>Analyzing Payload...</span>
                  </>
                ) : (
                  <>
                    <ScanLine className="w-4 h-4" />
                    <span>Analyze Threat</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Quick Preset Cards */}
          <div className="rounded-2xl glass-panel border border-slate-800 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                <span>Benchmark Test Examples</span>
              </span>
              <span className="text-[13px] text-slate-400 font-mono">Click to test</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {PRESET_EXAMPLES.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => handleApplyPreset(preset.text)}
                  disabled={isScanning}
                  className="p-3 rounded-xl bg-slate-950/70 hover:bg-slate-900 border border-slate-800/80 hover:border-cyan-500/40 text-left transition-all group"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="shrink-0 text-xs font-bold text-slate-200 group-hover:text-cyan-300 transition-colors">
                      {preset.label}
                    </span>
                    <span className="min-w-0 truncate text-[12px] text-slate-400 font-mono" title={preset.category}>
                      {preset.category}
                    </span>
                  </div>
                  <p className="text-[13px] text-slate-400 line-clamp-2 leading-relaxed">
                    &quot;{preset.text}&quot;
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right / Results & Telemetry View (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          {isScanning ? (
            /* Scanning Animation State */
            <div className="rounded-2xl glass-panel border border-cyan-500/40 p-8 flex flex-col items-center justify-center text-center h-full min-h-[380px] shadow-[0_0_30px_rgba(6,182,212,0.15)] relative overflow-hidden">
              <div className="animate-scanline" />
              <div className="relative w-20 h-20 mb-6 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border border-cyan-500/30 animate-ping" />
                <div className="w-16 h-16 rounded-full bg-cyan-950/80 border border-cyan-400 flex items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.4)]">
                  <ScanLine className="w-8 h-8 text-cyan-400 animate-pulse" />
                </div>
              </div>
              <h3 className="text-sm font-bold text-slate-100 mb-1 font-mono">
                EXTRACTING SIGNAL TELEMETRY
              </h3>
              <p className="text-xs text-cyan-400 font-mono max-w-xs animate-pulse">
                {SCAN_STEPS[scanStepIndex]}
              </p>
            </div>
          ) : error ? (
            <ApiErrorPanel error={error} onRetry={handleScan} />
          ) : result ? (
            /* Result Card */
            <ScanResultCard
              result={result}
              onReset={handleClear}
              onFeedbackChange={(feedback) => setResult((item) => item ? { ...item, feedback } : item)}
            />
          ) : (
            /* Empty State */
            <div className="rounded-2xl glass-panel border border-slate-800 p-8 flex flex-col items-center justify-center text-center h-full min-h-[380px]">
              <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 text-slate-400 mb-4">
                <ScanLine className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="text-sm font-bold text-slate-200 mb-1">Awaiting Inbound SMS</h3>
              <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
                Enter an SMS message or select a benchmark example to run the multi-heuristic classification pipeline.
              </p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

