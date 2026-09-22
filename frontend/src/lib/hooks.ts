'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, getHealth, getModelReport } from './api';
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
