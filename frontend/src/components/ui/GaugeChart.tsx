'use client';

import React from 'react';
import { RiskLevel } from '@/lib/types';

interface GaugeChartProps {
  score: number; // 0 - 100
  riskLevel: RiskLevel;
  threshold?: number; // percent
  warning?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function GaugeChart({
  score,
  riskLevel,
  threshold = 4.17,
  warning = false,
  size = 'md',
}: GaugeChartProps) {
  // SVG gauge constants
  const clampedScore = Math.max(0, Math.min(100, score));
  const radius = size === 'sm' ? 42 : size === 'lg' ? 75 : 58;
  const strokeWidth = size === 'sm' ? 8 : size === 'lg' ? 12 : 10;
  const circumference = Math.PI * radius; // 180 deg semi-circle
  const strokeDashoffset = circumference - (clampedScore / 100) * circumference;

  let strokeColor = '#10b981'; // green
  if (riskLevel === 'MEDIUM' || warning) strokeColor = '#f59e0b';
  if (riskLevel === 'HIGH') strokeColor = '#ef4444';

  const viewBoxSize = radius * 2 + strokeWidth * 2 + 10;
  const cx = viewBoxSize / 2;
  const cy = radius + strokeWidth + 5;

  return (
    <div className="flex flex-col items-center justify-center relative">
      <svg
        width={size === 'sm' ? 110 : size === 'lg' ? 200 : 160}
        height={size === 'sm' ? 65 : size === 'lg' ? 120 : 95}
        viewBox={`0 0 ${viewBoxSize} ${cy + 10}`}
        className="overflow-visible max-w-full h-auto"
      >
        <defs>
          <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="40%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="glow" />
            <feComposite in="SourceGraphic" in2="glow" operator="over" />
          </filter>
        </defs>

        {/* Background Arc */}
        <path
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
          fill="none"
          style={{ stroke: 'var(--color-slate-800)' }}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />

        {/* Operating Threshold Marker */}
        {threshold && (
          <line
            x1={cx - radius * Math.cos((threshold / 100) * Math.PI)}
            y1={cy - radius * Math.sin((threshold / 100) * Math.PI)}
            x2={cx - (radius + strokeWidth / 2) * Math.cos((threshold / 100) * Math.PI)}
            y2={cy - (radius + strokeWidth / 2) * Math.sin((threshold / 100) * Math.PI)}
            stroke="#06b6d4"
            strokeWidth="3"
          />
        )}

        {/* Value Arc */}
        <path
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          style={{
            transition: 'stroke-dashoffset 0.8s cubic-bezier(0.16, 1, 0.3, 1), stroke 0.5s ease',
          }}
          filter="url(#glow)"
        />
      </svg>

      {/* Value Overlay */}
      <div className="text-center -mt-3">
        <div className="flex items-baseline justify-center gap-0.5">
          <span
            className={`font-mono font-bold tracking-tight ${
              size === 'sm' ? 'text-lg' : size === 'lg' ? 'text-3xl' : 'text-2xl'
            } ${
              riskLevel === 'HIGH'
                ? 'text-rose-400'
                : riskLevel === 'MEDIUM'
                ? 'text-amber-400'
                : 'text-emerald-400'
            }`}
          >
            {clampedScore.toFixed(1)}
          </span>
          <span className="text-xs text-slate-400 font-mono">%</span>
        </div>
        <div className="flex items-center justify-center gap-1.5 mt-0.5">
          <span
            className={`text-[12px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
              riskLevel === 'HIGH'
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-[0_0_8px_rgba(239,68,68,0.2)]'
                : riskLevel === 'MEDIUM'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-[0_0_8px_rgba(245,158,11,0.2)]'
                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-[0_0_8px_rgba(16,185,129,0.2)]'
            }`}
          >
            {riskLevel} RISK
          </span>
        </div>
      </div>
    </div>
  );
}
