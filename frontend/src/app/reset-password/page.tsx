'use client';

import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthCard, buttonClass, inputClass } from '@/components/auth/AuthCard';
import { ApiErrorPanel } from '@/components/ui/ApiErrorPanel';
import { ApiError, resetPassword } from '@/lib/api';
import { markSignedIn } from '@/lib/hooks';

const MIN_PASSWORD_LENGTH = 8;

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  if (!token) {
    return (
      <p className="text-xs text-rose-400">
        This page needs the link from your reset email.{' '}
        <Link href="/forgot-password" className="text-cyan-400">Request a new link</Link>.
      </p>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(new ApiError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, 400));
      return;
    }
    if (password !== confirm) {
      setError(new ApiError('The two passwords do not match.', 400));
      return;
    }
    setBusy(true);
    try {
      markSignedIn(await resetPassword(token, password));
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(String(err), 0));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="block space-y-1.5">
        <span className="text-xs font-mono text-slate-400">New password</span>
        <input type="password" required autoComplete="new-password" value={password}
          onChange={(e) => setPassword(e.target.value)} className={inputClass} />
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-mono text-slate-400">Confirm new password</span>
        <input type="password" required autoComplete="new-password" value={confirm}
          onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
      </label>
      {error && <ApiErrorPanel error={error} />}
      <button type="submit" disabled={busy} className={buttonClass}>
        {busy ? 'Saving...' : 'Set new password'}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthCard title="Choose a new password">
      <Suspense>
        <ResetForm />
      </Suspense>
    </AuthCard>
  );
}
