'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, SIGNED_OUT_EVENT, SessionUser, getCurrentUser, getHealth, getModelReport } from './api';
import { ApiHealth, ModelReport } from './types';

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError(String(err), 0);
}

export function useModelReport() {
  const [report, setReport] = useState<ModelReport | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(() => {
    setError(null);
    getModelReport()
      .then(setReport)
      .catch((err) => setError(toApiError(err)));
  }, []);

  useEffect(load, [load]);
  return { report, error, retry: load };
}

const HEALTH_POLL_MS = 15000;

export function useApiHealth() {
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = () =>
      getHealth()
        .then((h) => {
          if (cancelled) return;
          setHealth(h);
          setError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          setHealth(null);
          setError(toApiError(err));
        });
    check();
    const interval = setInterval(check, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { health, error };
}

type SessionState =
  | { status: 'loading' }
  | { status: 'signed-in'; user: SessionUser }
  | { status: 'signed-out' }
  | { status: 'error'; error: ApiError };

// Shared across pages so navigating does not re-check the session each time.
let sessionCache: SessionState = { status: 'loading' };
const listeners = new Set<(s: SessionState) => void>();

function setSession(state: SessionState) {
  sessionCache = state;
  listeners.forEach((l) => l(state));
}

export function refreshSession() {
  return getCurrentUser()
    .then((user) => setSession(user ? { status: 'signed-in', user } : { status: 'signed-out' }))
    .catch((err) => setSession({ status: 'error', error: toApiError(err) }));
}

export function markSignedIn(user: SessionUser) {
  setSession({ status: 'signed-in', user });
}

export function markSignedOut() {
  setSession({ status: 'signed-out' });
}

if (typeof window !== 'undefined') {
  window.addEventListener(SIGNED_OUT_EVENT, () => setSession({ status: 'signed-out' }));
}

export function useSession() {
  const [state, setState] = useState<SessionState>(sessionCache);
  useEffect(() => {
    listeners.add(setState);
    if (sessionCache.status === 'loading' || sessionCache.status === 'error') refreshSession();
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return state;
}
