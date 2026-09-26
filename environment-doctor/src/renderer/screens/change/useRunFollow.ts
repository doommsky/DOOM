/** Follows one incident's repair: run.get once, then the live run.progress stream; run.decide for answers. */
import { useCallback, useEffect, useState } from 'react';
import type { ApiError, RunProgress } from '../../../shared/contracts';
import { useStream } from '../../hooks/useApi';
import { ask, newerRun } from './api';

export type Decision = 'keep' | 'undo' | 'relook' | 'cancel' | 'admin-allow' | 'admin-decline' | 'restart-now' | 'later';

export function useRunFollow(incidentId: string, opts: { load?: boolean } = {}) {
  const shouldLoad = opts.load !== false;
  const [run, setRun] = useState<RunProgress | null>(null);
  const [loaded, setLoaded] = useState(!shouldLoad);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [deciding, setDeciding] = useState<Decision | null>(null);
  const [decideError, setDecideError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const r = await ask('run.get', { incidentId });
    if (r.ok) setRun((prev) => (r.data ? newerRun(prev, r.data) : prev));
    else setLoadError(r.error);
    setLoaded(true);
  }, [incidentId]);
  useEffect(() => { if (shouldLoad) void load(); }, [load, shouldLoad]);

  useStream('run.progress', (r) => { if (r.incidentId === incidentId) setRun(r); });

  const decide = useCallback(async (executionId: string, decision: Decision) => {
    setDeciding(decision);
    setDecideError(null);
    const r = await ask('run.decide', { executionId, decision });
    setDeciding(null);
    if (r.ok) setRun((prev) => newerRun(prev, r.data));
    else setDecideError(r.error);
    return r;
  }, []);

  const adopt = useCallback((r: RunProgress) => setRun((prev) => newerRun(prev, r)), []);

  return { run, adopt, loaded, loadError, load, decide, deciding, decideError };
}

export type RunFollow = ReturnType<typeof useRunFollow>;
