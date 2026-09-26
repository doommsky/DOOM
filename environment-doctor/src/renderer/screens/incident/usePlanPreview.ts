import { useCallback, useEffect, useState } from 'react';
import type { ApiError, Plan, Req } from '../../../shared/contracts';
import { call } from '../../api/client';

type PlanReq = Omit<Req<'plan.forIncident'>, 'incidentId'>;

/**
 * Loads the draft plan the orchestrator would propose (plan.forIncident is stable while a draft exists),
 * so the diagnosis can say “Fix ready · N steps” or “There’s no safe fix for this yet”. Nothing is approved here.
 */
export function usePlanPreview(incidentId: string, enabled: boolean, req: PlanReq = {}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(enabled);
  const key = JSON.stringify(req);
  const load = useCallback(async (alive: { v: boolean } = { v: true }) => {
    setLoading(true);
    const r = await call('plan.forIncident', { incidentId, ...(JSON.parse(key) as PlanReq) });
    if (!alive.v) return;
    if (r.ok) { setPlan(r.data); setError(null); } else { setPlan(null); setError(r.error); }
    setLoading(false);
  }, [incidentId, key]);
  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    const alive = { v: true };
    void load(alive);
    return () => { alive.v = false; };
  }, [enabled, load]);
  return { plan, error, loading, reload: () => load() };
}

export const activeSteps = (p: Plan) => p.steps.filter((s) => !s.removedReason);
