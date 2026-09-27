'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock } from 'lucide-react';
import {
  AuthCard,
  FormAlert,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PasswordField,
  PasswordStrength,
  SubmitButton,
  toApiError,
} from '@/components/auth/AuthCard';
import { ApiError, resetPassword } from '@/lib/api';
import { markSignedIn } from '@/lib/hooks';

function ResetForm() {
  const router = useRouter();
  const legacyToken = useSearchParams().get('token') || '';
  const [fragmentToken, setFragmentToken] = useState('');
  const token = fragmentToken || legacyToken;
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    const readFragment = () => {
      const value = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      setFragmentToken(value.get('token') || '');
    };
    readFragment();
    window.addEventListener('hashchange', readFragment);
    return () => window.removeEventListener('hashchange', readFragment);
  }, []);

  useEffect(() => {
    if (token) window.history.replaceState(null, '', window.location.pathname);
  }, [token]);

  if (!token) {
    return (
      <div className="space-y-5">
        <FormAlert error={new ApiError('This page needs the link from your reset email.', 400,
          'Links expire after 1 hour and can be used once.')} />
        <Link
          href="/forgot-password"
          className="flex items-center justify-center w-full h-11 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-sm font-semibold"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const pwError = password.length < MIN_PASSWORD_LENGTH ? `Use at least ${MIN_PASSWORD_LENGTH} characters.` : null;
    const cfError = !confirm ? 'Re-enter your new password.' : confirm !== password ? "Passwords don't match." : null;
    setPasswordError(pwError);
    setConfirmError(cfError);
    if (pwError || cfError) return;

    setBusy(true);
    try {
      markSignedIn(await resetPassword(token, password));
      router.replace('/dashboard');
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <PasswordField
        label="New password"
        icon={Lock}
        autoComplete="new-password"
        placeholder="Create a new password"
        autoFocus
        maxLength={MAX_PASSWORD_LENGTH}
        value={password}
        error={passwordError}
        disabled={busy}
        onChange={(e) => {
          setPassword(e.target.value);
          setPasswordError(null);
        }}
        hint={password ? <PasswordStrength password={password} /> : null}
      />
      <PasswordField
        label="Confirm new password"
        icon={Lock}
        autoComplete="new-password"
        placeholder="Re-enter your new password"
        maxLength={MAX_PASSWORD_LENGTH}
        value={confirm}
        error={confirmError}
        disabled={busy}
        onChange={(e) => {
          setConfirm(e.target.value);
          setConfirmError(null);
        }}
      />
      {error && <FormAlert error={error} />}
      <SubmitButton busy={busy} busyLabel="Saving...">Set new password</SubmitButton>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthCard title="Choose a new password" subtitle="You'll be signed out everywhere else once it's saved.">
      <Suspense>
        <ResetForm />
      </Suspense>
      <Link href="/login" className="block text-center text-sm text-slate-400 hover:text-slate-200">
        Back to sign in
      </Link>
    </AuthCard>
  );
}
