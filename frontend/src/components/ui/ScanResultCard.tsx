'use client';

import React, { useEffect, useState } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Cpu,
  CheckCircle2,
  Copy,
  Check,
  Info,
  Clock,
  Flame,
} from 'lucide-react';
import { ApiError, removeFeedback, sendFeedback } from '@/lib/api';
import { FeedbackLabel, ScanResult } from '@/lib/types';
import { GaugeChart } from './GaugeChart';

interface ScanResultCardProps {
  result: ScanResult;
  onReset?: () => void;
  onFeedbackChange?: (feedback: FeedbackLabel | null) => void;
}

export function ScanResultCard({ result, onReset, onFeedbackChange }: ScanResultCardProps) {
  const [copied, setCopied] = useState(false);
  const [driversExpanded, setDriversExpanded] = useState(true);
  const [whyExpanded, setWhyExpanded] = useState(false);
  const [signalsExpanded, setSignalsExpanded] = useState(true);
  const [featuresExpanded, setFeaturesExpanded] = useState(false);

  const isFraud = result.prediction === 'FRAUD';
  const dangerousLink = result.detectedSignals.some(
    (signal) => signal.category === 'link_risk' && signal.severity === 'high'
  );
  const displayVerdict = dangerousLink && !isFraud ? 'RISKY LINK' : result.prediction;
  const displaySeverity = dangerousLink && !isFraud ? 'LINK WARNING' : `${result.riskLevel} SEVERITY`;
  const [feedback, setFeedback] = useState<FeedbackLabel | null>(result.feedback ?? null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const predictedLabel: FeedbackLabel = isFraud ? 'fraud' : 'legit';

  useEffect(() => {
    setFeedback(result.feedback ?? null);
  }, [result.id, result.feedback]);

  const handleFeedback = async (label: FeedbackLabel) => {
    setFeedbackBusy(true);
    setFeedbackError(null);
    try {
      if (feedback === label) {
        await removeFeedback(result.id);
        setFeedback(null);
        onFeedbackChange?.(null);
      } else {
        await sendFeedback(result.id, label);
        setFeedback(label);
        onFeedbackChange?.(label);
      }
    } catch (err) {
      setFeedbackError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setFeedbackBusy(false);
    }
  };

  const handleCopy = async () => {
    const text = `PHISHGUARD SCAN REPORT
Verdict: ${result.prediction}
Risk Level: ${result.riskLevel} (${result.riskScore}% risk)
Probability: ${(result.probability * 100).toFixed(2)}% (Threshold: ${(result.threshold * 100).toFixed(2)}%)
Message: "${result.message}"
Model drivers toward fraud: ${result.modelContributions.fraud.map((d) => d.term).join(', ') || 'none'}
Rule-based indicators:
${result.reasons.map((r) => ` - ${r}`).join('\n')}
Recommended Action: ${result.recommendedAction.action}`;

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className={`rounded-2xl glass-panel p-6 border transition-all duration-300 relative overflow-hidden ${
        isFraud
          ? 'border-rose-500/50 shadow-[0_0_30px_rgba(239,68,68,0.15)]'
          : dangerousLink || result.riskLevel === 'MEDIUM'
          ? 'border-amber-500/50 shadow-[0_0_30px_rgba(245,158,11,0.15)]'
          : 'border-emerald-500/50 shadow-[0_0_30px_rgba(16,185,129,0.15)]'
      }`}
    >
      {/* Top Banner Accent Line */}
      <div
        className={`absolute top-0 left-0 right-0 h-1.5 ${
          isFraud
            ? 'bg-gradient-to-r from-rose-600 via-rose-500 to-amber-500'
            : dangerousLink || result.riskLevel === 'MEDIUM'
            ? 'bg-gradient-to-r from-amber-500 to-yellow-500'
            : 'bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500'
        }`}
      />

      {/* Header Verdict Section */}
      <div className="flex flex-col gap-4 pb-6 border-b border-slate-800">
        {/* Left: Verdict Pill & Meta */}
        <div className="flex items-start gap-4 min-w-0">
          <div
            className={`p-3.5 rounded-xl border flex items-center justify-center shrink-0 ${
              isFraud
                ? 'bg-rose-500/10 border-rose-500/40 text-rose-400 shadow-[0_0_20px_rgba(239,68,68,0.2)]'
                : dangerousLink || result.riskLevel === 'MEDIUM'
                ? 'bg-amber-500/10 border-amber-500/40 text-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.2)]'
                : 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.2)]'
            }`}
          >
            {isFraud ? (
              <ShieldAlert className="w-8 h-8" />
            ) : dangerousLink || result.riskLevel === 'MEDIUM' ? (
              <AlertTriangle className="w-8 h-8" />
            ) : (
              <ShieldCheck className="w-8 h-8" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`text-2xl font-black tracking-wider uppercase ${
                  isFraud
                    ? 'text-rose-400'
                    : dangerousLink || result.riskLevel === 'MEDIUM'
                    ? 'text-amber-400'
                    : 'text-emerald-400'
                }`}
              >
                {displayVerdict}
              </span>
              <span
                className={`text-xs font-mono font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider ${
                  result.riskLevel === 'HIGH'
                    ? 'bg-rose-950 text-rose-300 border border-rose-700'
                    : dangerousLink || result.riskLevel === 'MEDIUM'
                    ? 'bg-amber-950 text-amber-300 border border-amber-700'
                    : 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                }`}
              >
                {displaySeverity}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1 flex flex-wrap items-center gap-2 font-mono">
              <span className="break-all">Scan ID: {result.id}</span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3 text-slate-400" />
                {result.latencyMs}ms inference
              </span>
            </p>
          </div>
        </div>

        {/* Right: Gauge & Threshold Metrics */}
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 self-start min-w-0 max-w-full bg-slate-900/60 px-4 sm:px-5 py-3 rounded-xl border border-slate-800">
          <GaugeChart
            score={result.riskScore}
            riskLevel={result.riskLevel}
            threshold={result.threshold * 100}
            warning={dangerousLink}
            size="md"
          />
          <div className="border-l border-slate-800 pl-4 space-y-1.5 text-xs font-mono shrink-0">
            <div>
              <span className="text-slate-400 block text-[12px] uppercase">Model Score</span>
              <span className="text-sm font-bold text-slate-100">
                {(result.probability * 100).toFixed(2)}%
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[12px] uppercase">Threshold</span>
              <span className="text-xs font-semibold text-cyan-400">
                {(result.threshold * 100).toFixed(2)}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Scanned Message Preview */}
      <div className="mt-5 p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[13px] uppercase tracking-wider font-semibold text-slate-400 font-mono">
            Analyzed SMS Payload
          </span>
          <span className="text-[13px] text-slate-400 font-mono">
            {result.message.length} chars • {result.modelFeatures.wordCount} words
          </span>
        </div>
        <p className="text-sm text-slate-200 font-sans leading-relaxed break-words">
          &quot;{result.message}&quot;
        </p>
      </div>

      {/* Recommended Action Card */}
      <div
        className={`mt-5 p-4 rounded-xl border ${
          result.recommendedAction.severity === 'red'
            ? 'bg-rose-950/20 border-rose-500/30'
            : result.recommendedAction.severity === 'amber'
            ? 'bg-amber-950/20 border-amber-500/30'
            : 'bg-emerald-950/20 border-emerald-500/30'
        }`}
      >
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span
              className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded min-w-0 break-words ${
                result.recommendedAction.severity === 'red'
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                  : result.recommendedAction.severity === 'amber'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
              }`}
            >
              Recommended SecOps Action
            </span>
            <span className="text-sm font-bold text-slate-100 min-w-0 break-words">
              {result.recommendedAction.action}
            </span>
          </div>
          <span className="text-xs text-slate-400 font-medium min-w-0 break-words text-right">
            {result.recommendedAction.badge}
          </span>
        </div>
        <p className="text-xs text-slate-300 mb-2.5">{result.recommendedAction.description}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 text-xs text-slate-400">
          {result.recommendedAction.steps.map((step, idx) => (
            <div key={idx} className="flex items-start gap-1.5">
              <CheckCircle2
                className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                  result.recommendedAction.severity === 'red'
                    ? 'text-rose-400'
                    : result.recommendedAction.severity === 'amber'
                    ? 'text-amber-400'
                    : 'text-emerald-400'
                }`}
              />
              <span>{step}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Expandable Section 0: the model's own reasons */}
      <div className="mt-5 border border-slate-800 rounded-xl overflow-hidden bg-slate-900/40">
        <button
          onClick={() => setDriversExpanded(!driversExpanded)}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-900/60 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono">
              What drove the model&apos;s score?
            </span>
          </div>
          {driversExpanded ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </button>

        {driversExpanded && (
          <div className="px-4 pb-4 pt-2 border-t border-slate-800/80 space-y-3">
            <p className="text-[13px] text-slate-400">
              Local probability effects for this message. Positive values raise the fraud score; negative values lower it.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(
                [
                  { label: 'Toward fraud', items: result.modelContributions.fraud, tone: 'rose' },
                  { label: 'Toward legitimate', items: result.modelContributions.legitimate, tone: 'emerald' },
                ] as const
              ).map((col) => (
                <div key={col.label} className="space-y-1.5">
                  <span
                    className={`text-[12px] uppercase font-mono font-bold ${
                      col.tone === 'rose' ? 'text-rose-400' : 'text-emerald-400'
                    }`}
                  >
                    {col.label}
                  </span>
                  {col.items.length === 0 ? (
                    <p className="text-[13px] text-slate-500">None</p>
                  ) : (
                    col.items.map((d) => (
                      <div
                        key={`${d.kind}-${d.term}`}
                        className="flex items-center justify-between gap-2 text-[13px] font-mono bg-slate-950/60 px-2 py-1 rounded border border-slate-800/80"
                      >
                        <span className="text-slate-200 truncate" title={d.term}>
                          {d.term}
                          <span className="text-slate-500 ml-1.5">{d.kind}</span>
                        </span>
                        <span className={col.tone === 'rose' ? 'text-rose-300' : 'text-emerald-300'}>
                          {d.weight > 0 ? '+' : ''}
                          {d.weight.toFixed(3)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Expandable Section 1: rule-based indicators */}
      <div className="mt-4 border border-slate-800 rounded-xl overflow-hidden bg-slate-900/40">
        <button
          onClick={() => setWhyExpanded(!whyExpanded)}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-900/60 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono">
              Rule-based indicators
            </span>
            <span className="text-[12px] px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800 font-mono">
              {result.reasons.length} {result.reasons.length === 1 ? 'Rule' : 'Rules'}
            </span>
          </div>
          {whyExpanded ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </button>

        {whyExpanded && (
          <div className="px-4 pb-4 pt-1 space-y-2 border-t border-slate-800/80">
            <p className="text-[13px] text-slate-400 pt-1">
              Keyword and entity rules found in the text. These do not decide the verdict.
            </p>
            {result.reasons.map((reason, idx) => (
              <div
                key={idx}
                className="flex items-start gap-2.5 text-xs text-slate-300 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                    isFraud ? 'bg-rose-400' : 'bg-emerald-400'
                  }`}
                />
                <span className="leading-relaxed font-sans">{reason}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Expandable Section 2: "Detected Signals" */}
      <div className="mt-4 border border-slate-800 rounded-xl overflow-hidden bg-slate-900/40">
        <button
          onClick={() => setSignalsExpanded(!signalsExpanded)}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-900/60 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono">
              Detected Threat Signals
            </span>
            <span className="text-[12px] px-2 py-0.5 rounded-full bg-amber-950 text-amber-400 border border-amber-800 font-mono">
              {result.detectedSignals.length} Active
            </span>
          </div>
          {signalsExpanded ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </button>

        {signalsExpanded && (
          <div className="px-4 pb-4 pt-1 border-t border-slate-800/80">
            {result.detectedSignals.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {result.detectedSignals.map((signal) => (
                  <div
                    key={signal.id}
                    className="p-3 rounded-lg bg-slate-950/70 border border-slate-800 flex flex-col justify-between"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold text-slate-200">{signal.name}</span>
                      <span
                        className={`text-[11px] uppercase font-bold px-1.5 py-0.5 rounded ${
                          signal.severity === 'high'
                            ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                            : signal.severity === 'medium'
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                            : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                        }`}
                      >
                        {signal.severity}
                      </span>
                    </div>
                    <div className="text-[13px] font-mono text-cyan-300 bg-slate-900 px-2 py-1 rounded mb-1.5 truncate">
                      Evidence: {signal.evidence}
                    </div>
                    <p className="text-[13px] text-slate-400 leading-tight">{signal.explanation}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 py-2">
                No high-risk entity tokens or coercion patterns identified.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Expandable Section 3: "Model Analysis & Feature Vector" */}
      <div className="mt-4 border border-slate-800 rounded-xl overflow-hidden bg-slate-900/40">
        <button
          onClick={() => setFeaturesExpanded(!featuresExpanded)}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-900/60 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-purple-400" />
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono">
              Model Feature Vector & Handcrafted Telemetry
            </span>
          </div>
          {featuresExpanded ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </button>

        {featuresExpanded && (
          <div className="px-4 pb-4 pt-1 space-y-3 border-t border-slate-800/80">
            {/* Handcrafted Features Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
              <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
                <span className="text-slate-400 text-[12px] block">Uppercase Ratio</span>
                <span className="text-cyan-300 font-bold">
                  {(result.modelFeatures.upperRatio * 100).toFixed(1)}%
                </span>
              </div>
              <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
                <span className="text-slate-400 text-[12px] block">Digit Ratio</span>
                <span className="text-cyan-300 font-bold">
                  {(result.modelFeatures.digitRatio * 100).toFixed(1)}%
                </span>
              </div>
              <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
                <span className="text-slate-400 text-[12px] block">Exclamation Marks</span>
                <span className="text-cyan-300 font-bold">
                  {result.modelFeatures.exclaimCount}
                </span>
              </div>
              <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
                <span className="text-slate-400 text-[12px] block">Suspicious Keywords</span>
                <span className="text-cyan-300 font-bold">
                  {result.modelFeatures.suspiciousKeywordCount}
                </span>
              </div>
            </div>

            {/* Extracted Tokens */}
            <div>
              <span className="text-[13px] text-slate-400 font-mono block mb-1.5">
                Normalised word tokens (first 12):
              </span>
              <div className="flex flex-wrap gap-1.5">
                {result.modelFeatures.wordTokens.map((token, idx) => (
                  <span
                    key={idx}
                    className="text-[13px] font-mono px-2 py-0.5 rounded bg-slate-950 text-slate-300 border border-slate-800"
                  >
                    {token}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Feedback: was the verdict right? */}
      <div className="mt-5 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-slate-300">
          {feedback === null ? (
            'Was this result right?'
          ) : feedback === predictedLabel ? (
            <span className="text-emerald-400">Thanks — you confirmed this result.</span>
          ) : (
            <span className="text-amber-400">
              Thanks — reported as {feedback === 'fraud' ? 'fraud' : 'legitimate'}. It will be used to retrain the model.
            </span>
          )}
          {feedbackError && <span className="block text-rose-400 mt-1">{feedbackError}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleFeedback(predictedLabel)}
            disabled={feedbackBusy}
            aria-pressed={feedback === predictedLabel}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 ${
              feedback === predictedLabel
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
            }`}
          >
            Correct
          </button>
          <button
            onClick={() => handleFeedback(isFraud ? 'legit' : 'fraud')}
            disabled={feedbackBusy}
            aria-pressed={feedback !== null && feedback !== predictedLabel}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 ${
              feedback !== null && feedback !== predictedLabel
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
            }`}
          >
            Wrong — it&apos;s {isFraud ? 'legitimate' : 'fraud'}
          </button>
        </div>
      </div>

      {/* Footer Action Bar */}
      <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-between">
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-medium border border-slate-800 transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Report Copied' : 'Copy Scan Report'}</span>
        </button>

        {onReset && (
          <button
            onClick={onReset}
            className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 text-xs font-bold transition-all shadow-[0_0_12px_rgba(6,182,212,0.25)]"
          >
            Scan Another SMS
          </button>
        )}
      </div>
    </div>
  );
}
