import React from 'react';
import { ShieldAlert } from 'lucide-react';

// Centered brand + card layout shared by the signed-out pages.
export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#070a12] text-slate-100 cyber-grid-bg p-6">
      <div className="w-full max-w-sm space-y-5">
        <div className="flex items-center gap-3 justify-center">
          <div className="p-2.5 rounded-xl bg-cyan-500/15 border border-cyan-500/40 text-cyan-400">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-wider text-slate-100">PHISHGUARD</h1>
            <p className="text-[11px] text-slate-400">AI Smishing Detection</p>
          </div>
        </div>
        <div className="p-6 rounded-2xl glass-panel border border-slate-800 space-y-4">
          <h2 className="text-sm font-bold text-slate-100">{title}</h2>
          {children}
        </div>
      </div>
    </div>
  );
}

export const inputClass =
  'w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-cyan-500';
export const buttonClass =
  'w-full py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 text-xs font-bold cursor-pointer';
