'use client';

import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { ApiError } from '@/lib/api';

interface ApiErrorPanelProps {
  error: ApiError;
  onRetry?: () => void;
}

export function ApiErrorPanel({ error, onRetry }: ApiErrorPanelProps) {
  return (
    <div
      role="alert"
      className="p-5 rounded-2xl border border-rose-500/40 bg-rose-950/20 flex items-start gap-3"
    >
      <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-sm font-bold text-rose-300">
          {error.status ? `API error ${error.status}` : 'API unreachable'}
        </p>
        <p className="text-xs text-slate-300 break-words">{error.message}</p>
        {error.hint && <p className="text-xs font-mono text-slate-400 break-words">{error.hint}</p>}
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-medium border border-slate-800"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Retry</span>
        </button>
      )}
    </div>
  );
}

export function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="p-8 rounded-2xl glass-panel border border-slate-800 text-center text-xs font-mono text-slate-400">
      {label}
    </div>
  );
}
