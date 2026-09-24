'use client';

import React from 'react';
import { X } from 'lucide-react';
import { FeedbackLabel, ScanHistoryItem } from '@/lib/types';
import { ScanResultCard } from './ScanResultCard';

interface DetailDrawerProps {
  item: ScanHistoryItem | null;
  isOpen: boolean;
  onClose: () => void;
  onFeedbackChange?: (feedback: FeedbackLabel | null) => void;
}

export function DetailDrawer({ item, isOpen, onClose, onFeedbackChange }: DetailDrawerProps) {
  if (!isOpen || !item) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Slide-over Content Container */}
      <div className="relative w-full max-w-2xl bg-surface border-l border-slate-800 shadow-2xl h-full flex flex-col z-10 overflow-y-auto">
        {/* Drawer Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between sticky top-0 bg-surface/90 backdrop-blur-md z-20">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold text-slate-400">SCAN TELEMETRY</span>
            <span className="text-xs font-mono text-cyan-400">{item.id}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Drawer Body */}
        <div className="p-6 space-y-6">
          <ScanResultCard result={item.result} onFeedbackChange={onFeedbackChange} />
        </div>
      </div>
    </div>
  );
}
