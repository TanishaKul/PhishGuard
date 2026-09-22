'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { LogIn, UserPlus } from 'lucide-react';
import { AuthCard, inputClass } from '@/components/auth/AuthCard';
import { ApiErrorPanel } from '@/components/ui/ApiErrorPanel';
import { ApiError, login, register } from '@/lib/api';
import { markSignedIn, useSession } from '@/lib/hooks';

const MIN_PASSWORD_LENGTH = 8;

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const session = useSession();
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // Only follow same-app paths, never an absolute URL from the query string.
  const nextParam = params.get('next') || '/dashboard';
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/dashboard';

  useEffect(() => {
    if (session.status === 'signed-in') router.replace(next);
  }, [session.status, router, next]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === 'register' && password.length < MIN_PASSWORD_LENGTH) {
      setError(new ApiError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, 400));
      return;
    }
    setBusy(true);
    try {
      const user = mode === 'signin' ? await login(email, password) : await register(email, password);
      markSignedIn(user);
      router.replace(next);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(String(err), 0));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title={mode === 'signin' ? 'Sign in' : 'Create an account'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-mono text-slate-400">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-mono text-slate-400">Password</span>
          <input
            type="password"
            required
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
          {mode === 'register' && (
            <span className="text-[11px] text-slate-500">At least {MIN_PASSWORD_LENGTH} characters.</span>
          )}
        </label>

        {error && <ApiErrorPanel error={error} />}

        <button
          type="submit"
          disabled={busy}
          className="w-full py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
        >
          {mode === 'signin' ? <LogIn className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
          <span>{busy ? 'Please wait...' : mode === 'signin' ? 'Sign in' : 'Create account'}</span>
        </button>

        {mode === 'signin' && (
          <Link href="/forgot-password" className="block text-center text-xs text-slate-400 hover:text-slate-200">
            Forgot password?
          </Link>
        )}

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'signin' ? 'register' : 'signin');
            setError(null);
          }}
          className="w-full text-xs text-cyan-400 hover:text-cyan-300"
        >
          {mode === 'signin' ? "Don't have an account? Create one" : 'Already have an account? Sign in'}
        </button>
      </form>
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
