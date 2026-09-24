'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock, Mail } from 'lucide-react';
import {
  AuthCard,
  EMAIL_PATTERN,
  FormAlert,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PasswordField,
  PasswordStrength,
  SubmitButton,
  TextField,
  toApiError,
} from '@/components/auth/AuthCard';
import { ApiError, login, register } from '@/lib/api';
import { markSignedIn, useSession } from '@/lib/hooks';

type Mode = 'signin' | 'register';
type FieldErrors = { email?: string; password?: string; confirm?: string };

const COPY: Record<Mode, { title: string; subtitle: string; submit: string; busy: string }> = {
  signin: {
    title: 'Welcome back',
    subtitle: 'Sign in to scan messages and review your history.',
    submit: 'Sign in',
    busy: 'Signing in...',
  },
  register: {
    title: 'Create your account',
    subtitle: 'Start detecting SMS fraud in less than a minute.',
    submit: 'Create account',
    busy: 'Creating account...',
  },
};

function validate(mode: Mode, email: string, password: string, confirm: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!email.trim()) errors.email = 'Enter your email address.';
  else if (!EMAIL_PATTERN.test(email.trim())) errors.email = 'Enter a valid email address, like name@example.com.';

  if (!password) errors.password = 'Enter your password.';
  else if (mode === 'register') {
    if (password.length < MIN_PASSWORD_LENGTH) errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    else if (password.length > MAX_PASSWORD_LENGTH) errors.password = `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
    if (!confirm) errors.confirm = 'Re-enter your password.';
    else if (confirm !== password) errors.confirm = "Passwords don't match.";
  }
  return errors;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const session = useSession();
  const [mode, setMode] = useState<Mode>(params.get('mode') === 'register' ? 'register' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);

  // Only follow same-app paths, never an absolute URL from the query string.
  const nextParam = params.get('next') || '/dashboard';
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/dashboard';

  useEffect(() => {
    if (session.status === 'signed-in') router.replace(next);
  }, [session.status, router, next]);

  const switchMode = (value: Mode) => {
    if (value === mode) return;
    setMode(value);
    setError(null);
    setFieldErrors({});
    setEmailTaken(false);
    setConfirm('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setEmailTaken(false);
    const errors = validate(mode, email, password, confirm);
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    setBusy(true);
    try {
      const user = mode === 'signin' ? await login(email.trim(), password) : await register(email.trim(), password);
      markSignedIn(user);
      router.replace(next);
    } catch (err) {
      const apiError = toApiError(err);
      // An existing account is best fixed by signing in, with the email kept.
      if (mode === 'register' && apiError.status === 409) {
        setFieldErrors({ email: 'An account with this email already exists.' });
        setEmailTaken(true);
      } else {
        setError(apiError);
      }
    } finally {
      setBusy(false);
    }
  };

  const copy = COPY[mode];

  return (
    <AuthCard title={copy.title} subtitle={copy.subtitle}>
      <div role="tablist" aria-label="Account" className="grid grid-cols-2 p-1 rounded-lg bg-slate-900/80 border border-slate-800">
        {(['signin', 'register'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => switchMode(value)}
            className={`h-9 rounded-md text-sm font-medium transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40 ${
              mode === value ? 'bg-slate-800 text-slate-50 shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {value === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <TextField
          label="Email"
          icon={Mail}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          placeholder="name@company.com"
          autoFocus
          value={email}
          error={fieldErrors.email}
          disabled={busy}
          onChange={(e) => {
            setEmail(e.target.value);
            setEmailTaken(false);
            if (fieldErrors.email) setFieldErrors({ ...fieldErrors, email: undefined });
          }}
        />
        {emailTaken && (
          <button
            type="button"
            onClick={() => switchMode('signin')}
            className="-mt-3 text-xs text-cyan-400 hover:text-cyan-300 cursor-pointer"
          >
            Sign in with this email instead
          </button>
        )}

        <PasswordField
          label="Password"
          icon={Lock}
          name="password"
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          placeholder={mode === 'signin' ? 'Enter your password' : 'Create a password'}
          maxLength={MAX_PASSWORD_LENGTH}
          value={password}
          error={fieldErrors.password}
          disabled={busy}
          onChange={(e) => {
            setPassword(e.target.value);
            if (fieldErrors.password) setFieldErrors({ ...fieldErrors, password: undefined });
          }}
          labelAside={mode === 'signin' && (
            <Link href="/forgot-password" className="text-xs text-cyan-400 hover:text-cyan-300">
              Forgot password?
            </Link>
          )}
          hint={mode === 'register' && password ? <PasswordStrength password={password} /> : null}
        />

        {mode === 'register' && (
          <PasswordField
            label="Confirm password"
            icon={Lock}
            name="confirm-password"
            autoComplete="new-password"
            placeholder="Re-enter your password"
            maxLength={MAX_PASSWORD_LENGTH}
            value={confirm}
            error={fieldErrors.confirm}
            disabled={busy}
            onChange={(e) => {
              setConfirm(e.target.value);
              if (fieldErrors.confirm) setFieldErrors({ ...fieldErrors, confirm: undefined });
            }}
          />
        )}

        {error && <FormAlert error={error} />}

        <SubmitButton busy={busy} busyLabel={copy.busy}>{copy.submit}</SubmitButton>
      </form>

      <p className="text-center text-sm text-slate-400">
        {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
        <button
          type="button"
          onClick={() => switchMode(mode === 'signin' ? 'register' : 'signin')}
          className="font-medium text-cyan-400 hover:text-cyan-300 cursor-pointer"
        >
          {mode === 'signin' ? 'Create one' : 'Sign in'}
        </button>
      </p>
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
