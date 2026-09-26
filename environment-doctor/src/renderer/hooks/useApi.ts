import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiError, Channel, Req, Res, Result, Stream, Streams } from '../../shared/contracts';
import { getBridge } from '../api/client';

export type Loadable<T> = { data: T | null; error: ApiError | null; loading: boolean; reload: () => Promise<void>; set: (d: T) => void };

/** Read a channel on mount (and when `deps` change). */
export function useApi<C extends Channel>(channel: C, req: Req<C>, deps: unknown[] = []): Loadable<Res<C>> {
  const [data, setData] = useState<Res<C> | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const reqRef = useRef(req);
  reqRef.current = req;
  const alive = useRef(true);
  const reload = useCallback(async () => {
    setLoading(true);
    const r = await getBridge().invoke(channel, reqRef.current);
    if (!alive.current) return;
    if (r.ok) { setData(r.data); setError(null); } else setError(r.error);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, ...deps]);
  useEffect(() => { alive.current = true; void reload(); return () => { alive.current = false; }; }, [reload]);
  return { data, error, loading, reload, set: setData };
}

/** Imperative call with busy/error state, for intents (approve, run, …). */
export function useAction<C extends Channel>(channel: C) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const run = useCallback(async (req: Req<C>): Promise<Result<Res<C>>> => {
    setBusy(true);
    setError(null);
    const r = await getBridge().invoke(channel, req);
    if (!r.ok) setError(r.error);
    setBusy(false);
    return r;
  }, [channel]);
  return { run, busy, error, setError };
}

export function useStream<S extends Stream>(stream: S, cb: (d: Streams[S]) => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => getBridge().subscribe(stream, (d) => ref.current(d)), [stream]);
}

export function usePrefersReducedMotion() {
  const [r, setR] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const m = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!m) return;
    const h = () => setR(m.matches);
    m.addEventListener?.('change', h);
    return () => m.removeEventListener?.('change', h);
  }, []);
  return !!r;
}
