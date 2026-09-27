'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  API_URL_CHANGED_EVENT,
  THRESHOLD_CHANGED_EVENT,
  ApiError,
  SIGNED_OUT_EVENT,
  SessionUser,
  getCurrentUser,
  getHealth,
  getModelReport,
} from './api';
import { ApiHealth, ModelReport } from './types';

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError(String(err), 0);
}

export function useModelReport() {
  const [report, setReport] = useState<ModelReport | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const generation = useRef(0);

  const load = useCallback(() => {
    const current = ++generation.current;
    setError(null);
    getModelReport()
      .then((value) => {
        if (generation.current === current) setReport(value);
      })
      .catch((err) => {
        if (generation.current === current) setError(toApiError(err));
      });
  }, []);

  useEffect(() => {
    load();
    const onApiUrlChanged = () => {
      setReport(null);
      load();
    };
    window.addEventListener(API_URL_CHANGED_EVENT, onApiUrlChanged);
    return () => window.removeEventListener(API_URL_CHANGED_EVENT, onApiUrlChanged);
  }, [load]);

  return { report, error, retry: load };
}

const HEALTH_POLL_MS = 15000;

export function useApiHealth() {
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let generation = 0;
    const check = () => {
      if (inFlight) return;
      inFlight = true;
      const current = ++generation;
      // Keep the last result on screen while polling so the status doesn't flicker.
      getHealth()
        .then((h) => {
          if (!cancelled && generation === current) {
            setHealth(h);
            setError(null);
          }
        })
        .catch((err) => {
          if (!cancelled && generation === current) {
            setHealth(null);
            setError(toApiError(err));
          }
        })
        .finally(() => {
          if (generation === current) inFlight = false;
        });
    };
    const onApiUrlChanged = () => {
      // A different server: the old result no longer applies.
      setHealth(null);
      setError(null);
      generation++;
      inFlight = false;
      check();
    };
    check();
    const interval = setInterval(check, HEALTH_POLL_MS);
    window.addEventListener(API_URL_CHANGED_EVENT, onApiUrlChanged);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener(API_URL_CHANGED_EVENT, onApiUrlChanged);
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
let sessionGeneration = 0;
const listeners = new Set<(s: SessionState) => void>();
const sessionChannel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('phishguard-session')
  : null;

function setSession(state: SessionState) {
  sessionCache = state;
  listeners.forEach((l) => l(state));
}

export function refreshSession() {
  const current = ++sessionGeneration;
  return getCurrentUser()
    .then((user) => {
      if (current === sessionGeneration) {
        setSession(user ? { status: 'signed-in', user } : { status: 'signed-out' });
      }
    })
    .catch((err) => {
      if (current === sessionGeneration) setSession({ status: 'error', error: toApiError(err) });
    });
}

export function markSignedIn(user: SessionUser) {
  sessionGeneration++;
  setSession({ status: 'signed-in', user });
  sessionChannel?.postMessage({ type: 'signed-in' });
}

export function markSignedOut() {
  sessionGeneration++;
  setSession({ status: 'signed-out' });
  sessionChannel?.postMessage({ type: 'signed-out' });
}

if (typeof window !== 'undefined') {
  sessionChannel?.addEventListener('message', (event) => {
    if (event.data?.type === 'signed-out') {
      sessionGeneration++;
      setSession({ status: 'signed-out' });
    } else if (event.data?.type === 'signed-in') {
      sessionGeneration++;
      setSession({ status: 'loading' });
      refreshSession();
    }
  });
  window.addEventListener(SIGNED_OUT_EVENT, () => {
    sessionGeneration++;
    setSession({ status: 'signed-out' });
    sessionChannel?.postMessage({ type: 'signed-out' });
  });
  window.addEventListener('storage', (event) => {
    if (event.key === 'phishguard_api_url' || event.key === null) {
      window.dispatchEvent(new Event(API_URL_CHANGED_EVENT));
    }
    if (event.key === 'phishguard_threshold' || event.key === null) {
      window.dispatchEvent(new Event(THRESHOLD_CHANGED_EVENT));
    }
  });
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
