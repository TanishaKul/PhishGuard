'use client';

import React from 'react';
import { X, ShieldAlert, ShieldCheck, AlertTriangle, Clock, Tag, ExternalLink } from 'lucide-react';
import { ScanHistoryItem } from '@/lib/types';
import { scoreMessage } from '@/lib/api';
import { ScanResultCard } from './ScanResultCard';

interface DetailDrawerProps {
  item: ScanHistoryItem | null;
  isOpen: boolean;
  onClose: () => void;
}

export function DetailDrawer({ item, isOpen, onClose }: DetailDrawerProps) {
  if (!isOpen || !item) return null;

  // Generate full scan analysis for the history record
  const fullResult = scoreMessage(item.message);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Slide-over Content Container */}
      <div className="relative w-full max-w-2xl bg-[#090d16] border-l border-slate-800 shadow-2xl h-full flex flex-col z-10 overflow-y-auto">
        {/* Drawer Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between sticky top-0 bg-[#090d16]/90 backdrop-blur-md z-20">
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
          <ScanResultCard result={fullResult} />
        </div>
      </div>
    </div>
  );
}
