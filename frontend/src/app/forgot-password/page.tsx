'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Mail, MailCheck } from 'lucide-react';
import { AuthCard, EMAIL_PATTERN, FormAlert, SubmitButton, TextField, toApiError } from '@/components/auth/AuthCard';
import { ApiError, forgotPassword } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!EMAIL_PATTERN.test(email.trim())) {
      setEmailError('Enter a valid email address, like name@example.com.');
      return;
    }
    setBusy(true);
    try {
      setSent(await forgotPassword(email.trim()));
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const backLink = (
    <Link href="/login" className="flex items-center justify-center gap-1.5 text-sm text-slate-400 hover:text-slate-200">
      <ArrowLeft className="w-4 h-4" />
      Back to sign in
    </Link>
  );

  if (sent) {
    return (
      <AuthCard title="Check your email" subtitle={`We sent instructions to ${email.trim()}.`}>
        <div className="flex gap-3 p-4 rounded-lg border border-emerald-500/30 bg-emerald-950/20">
          <MailCheck className="w-5 h-5 text-emerald-400 shrink-0" />
          <div className="space-y-1 text-sm">
            <p className="text-slate-200">{sent}</p>
            <p className="text-slate-400">Didn&apos;t get it? Check your spam folder, or try again in a few minutes.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSent(null)}
          className="w-full h-11 rounded-lg border border-slate-800 hover:bg-slate-900 text-sm text-slate-200 cursor-pointer"
        >
          Use a different email
        </button>
        {backLink}
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Forgot your password?" subtitle="Enter your account email and we'll send you a link to reset it.">
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <TextField
          label="Email"
          icon={Mail}
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="name@company.com"
          autoFocus
          value={email}
          error={emailError}
          disabled={busy}
          onChange={(e) => {
            setEmail(e.target.value);
            setEmailError(null);
          }}
        />
        {error && <FormAlert error={error} />}
        <SubmitButton busy={busy} busyLabel="Sending link...">Send reset link</SubmitButton>
      </form>
      {backLink}
    </AuthCard>
  );
}
