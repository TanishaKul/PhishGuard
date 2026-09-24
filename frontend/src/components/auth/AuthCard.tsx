'use client';

import React, { useId, useState } from 'react';
import { AlertCircle, Check, Eye, EyeOff, Loader2, LockKeyhole, ShieldAlert, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { ThemeToggle } from '@/components/layout/ThemeToggle';

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 256;
// Same shape the API accepts (auth.EMAIL_RE), so the form never lets through
// an address the server will reject.
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const HIGHLIGHTS = [
  { icon: Zap, title: 'Instant verdicts', text: 'Paste any SMS and get a calibrated fraud score in under a second.' },
  { icon: Sparkles, title: 'Explained, not just flagged', text: 'See the words, links and patterns that drove each decision.' },
  { icon: LockKeyhole, title: 'Private by design', text: 'Your scan history is tied to your account and never shared.' },
];

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <div className="p-2.5 rounded-xl bg-cyan-500/15 border border-cyan-500/40 text-cyan-400">
        <ShieldAlert className="w-6 h-6" />
      </div>
      <div>
        <p className="text-lg font-bold tracking-wider text-slate-100">PHISHGUARD</p>
        <p className="text-[13px] text-slate-400">AI Smishing Detection</p>
      </div>
    </div>
  );
}

// Brand panel beside the form on wide screens; the form alone on phones.
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-app text-slate-100">
      <aside className="hidden lg:flex flex-col justify-between p-12 cyber-grid-bg border-r border-slate-800/80">
        <Brand />
        <div className="space-y-8 max-w-md">
          <div className="space-y-3">
            <h2 className="text-3xl font-semibold leading-tight text-slate-50">
              Catch smishing before it catches your users.
            </h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              PhishGuard combines a trained language model with link and keyword analysis to spot SMS fraud,
              and shows its reasoning so you can trust the result.
            </p>
          </div>
          <ul className="space-y-5">
            {HIGHLIGHTS.map(({ icon: Icon, title: heading, text }) => (
              <li key={heading} className="flex gap-3">
                <div className="mt-0.5 p-2 h-fit rounded-lg bg-slate-900 border border-slate-800 text-cyan-400">
                  <Icon className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-200">{heading}</p>
                  <p className="text-xs text-slate-400 leading-relaxed">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="flex items-center gap-2 text-[13px] text-slate-500">
          <ShieldCheck className="w-3.5 h-3.5" />
          Sessions are secured with HttpOnly cookies.
        </p>
      </aside>

      <main className="relative min-w-0 flex items-center justify-center p-6 sm:p-10 cyber-grid-bg lg:bg-none">
        <ThemeToggle className="absolute top-4 right-4" />
        <div className="w-full max-w-sm space-y-8">
          <div className="lg:hidden flex justify-center">
            <Brand />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold text-slate-50">{title}</h1>
            {subtitle && <p className="text-sm text-slate-400">{subtitle}</p>}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

const fieldBase =
  'w-full h-11 pl-10 pr-3 rounded-lg bg-slate-950/80 border text-sm text-slate-100 placeholder:text-slate-600 ' +
  'transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-500/30 disabled:opacity-60';

function fieldClass(invalid: boolean, extra = '') {
  return `${fieldBase} ${invalid ? 'border-rose-500/70 focus:border-rose-500' : 'border-slate-800 hover:border-slate-700 focus:border-cyan-500'} ${extra}`;
}

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  error?: string | null;
  hint?: React.ReactNode;
  labelAside?: React.ReactNode;
};

export function TextField({ label, icon: Icon, error, hint, labelAside, ...input }: InputProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-medium text-slate-300">{label}</label>
        {labelAside}
      </div>
      <div className="relative">
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
        <input id={id} aria-invalid={!!error} aria-describedby={describedBy} className={fieldClass(!!error)} {...input} />
      </div>
      <FieldMessage id={id} error={error} hint={hint} />
    </div>
  );
}

export function PasswordField({ label, icon: Icon, error, hint, labelAside, ...input }: InputProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState('CapsLock'));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-medium text-slate-300">{label}</label>
        {labelAside}
      </div>
      <div className="relative">
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          onKeyUp={onKey}
          onKeyDown={onKey}
          onBlur={() => setCapsLock(false)}
          className={fieldClass(!!error, 'pr-11')}
          {...input}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 rounded-md text-slate-500 hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40 cursor-pointer"
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {capsLock && <p className="text-xs text-amber-400">Caps Lock is on.</p>}
      <FieldMessage id={id} error={error} hint={hint} />
    </div>
  );
}

function FieldMessage({ id, error, hint }: { id: string; error?: string | null; hint?: React.ReactNode }) {
  if (error) {
    return <p id={`${id}-error`} className="text-xs text-rose-400">{error}</p>;
  }
  if (hint) {
    return <div id={`${id}-hint`} className="text-xs text-slate-500">{hint}</div>;
  }
  return null;
}

// Guidance only: the server enforces length, this nudges toward a strong password.
export function passwordStrength(password: string): { score: number; label: string } {
  if (!password) return { score: 0, label: '' };
  if (password.length < MIN_PASSWORD_LENGTH) return { score: 1, label: 'Too short' };
  let score = 1;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
  return { score, label: ['', 'Weak', 'Fair', 'Good', 'Strong'][score] };
}

const STRENGTH_COLORS = ['bg-slate-800', 'bg-rose-500', 'bg-amber-500', 'bg-cyan-500', 'bg-emerald-500'];

export function PasswordStrength({ password }: { password: string }) {
  const { score, label } = passwordStrength(password);
  const rules = [
    { ok: password.length >= MIN_PASSWORD_LENGTH, text: `At least ${MIN_PASSWORD_LENGTH} characters` },
    { ok: /[a-z]/.test(password) && /[A-Z]/.test(password), text: 'Upper and lower case letters' },
    { ok: /\d/.test(password), text: 'A number' },
    { ok: /[^A-Za-z0-9]/.test(password), text: 'A symbol' },
  ];
  return (
    <div className="space-y-2" aria-live="polite">
      <div className="flex items-center gap-2">
        <div className="flex-1 grid grid-cols-4 gap-1">
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className={`h-1 rounded-full transition-colors ${i <= score ? STRENGTH_COLORS[score] : 'bg-slate-800'}`} />
          ))}
        </div>
        <span className="text-[13px] w-16 text-right text-slate-400">{label}</span>
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
        {rules.map((rule) => (
          <li key={rule.text} className={`flex items-center gap-1.5 text-[13px] ${rule.ok ? 'text-emerald-400' : 'text-slate-500'}`}>
            <Check className={`w-3 h-3 ${rule.ok ? 'opacity-100' : 'opacity-30'}`} />
            {rule.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Form-level error: the server's message and hint, without raw status codes.
export function FormAlert({ error }: { error: ApiError }) {
  const title =
    error.status === 0 ? "Can't reach the server"
      : error.status === 429 ? 'Too many attempts'
        : error.status >= 500 ? 'Something went wrong on our side'
          : null;
  return (
    <div role="alert" className="flex gap-3 p-3.5 rounded-lg border border-rose-500/40 bg-rose-950/30">
      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
      <div className="space-y-0.5 min-w-0">
        {title && <p className="text-sm font-medium text-rose-300">{title}</p>}
        <p className={`text-sm break-words ${title ? 'text-slate-300' : 'text-rose-300'}`}>{error.message}</p>
        {error.hint && <p className="text-xs text-slate-400 break-words">{error.hint}</p>}
      </div>
    </div>
  );
}

export function SubmitButton({ busy, busyLabel, children }: { busy: boolean; busyLabel: string; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy}
      aria-busy={busy}
      className="w-full h-11 rounded-lg bg-cyan-500 hover:bg-cyan-400 active:bg-cyan-600 disabled:opacity-60 disabled:cursor-not-allowed text-slate-950 text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-app"
    >
      {busy && <Loader2 className="w-4 h-4 animate-spin" />}
      <span>{busy ? busyLabel : children}</span>
    </button>
  );
}

export function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError(String(err), 0);
}
