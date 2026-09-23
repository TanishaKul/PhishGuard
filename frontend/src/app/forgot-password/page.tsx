'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { AuthCard, buttonClass, inputClass } from '@/components/auth/AuthCard';
import { ApiErrorPanel } from '@/components/ui/ApiErrorPanel';
import { ApiError, forgotPassword } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setSent(await forgotPassword(email));
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(String(err), 0));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Reset your password">
      {sent ? (
        <p className="text-xs text-emerald-400">{sent}</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-mono text-slate-400">Email</span>
            <input type="email" required autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          </label>
          {error && <ApiErrorPanel error={error} />}
          <button type="submit" disabled={busy} className={buttonClass}>
            {busy ? 'Sending...' : 'Email me a reset link'}
          </button>
        </form>
      )}
      <Link href="/login" className="block text-center text-xs text-cyan-400 hover:text-cyan-300">
        Back to sign in
      </Link>
    </AuthCard>
  );
}
