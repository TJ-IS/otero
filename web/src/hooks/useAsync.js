import { useEffect, useState, useCallback } from 'react';

/**
 * Minimal data-fetching hook with manual refresh trigger.
 * @param {(signal: AbortSignal) => Promise<T>} fetcher
 * @param {Array} deps react deps array
 * @returns {{ data: T|null, error: Error|null, loading: boolean, refresh: () => void }}
 */
export function useAsync(fetcher, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce(n => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    fetcher(controller.signal)
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e) => {
        if (!cancelled && e.name !== 'AbortError') setError(e);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, error, loading, refresh };
}
