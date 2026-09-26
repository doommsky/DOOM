/**
 * The approval state machine shared by Plan (board 06) and Guided (board 10):
 * review → approve (approval.submit) → confirm (final check + visible expiry) → run.start.
 * UI safety rules 1–3: nothing runs without this flow, the binding stays visible, expiry is visible and
 * an expired or changed approval always ends in a “Nothing ran” state before asking again.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UI_CONFIRMATION_VERSION, type ApiError, type Approval, type Plan, type Result, type RunProgress } from '../../../shared/contracts';
import { activeSteps, ask, listJoin, useNow } from './api';

export type ApprovalStage = 'review' | 'confirm' | 'expired';

export interface ApprovalOptions {
  /** Changes when a different plan must be loaded (route params). */
  loadKey: string;
  /** Loads the plan to review. */
  load: () => Promise<Result<Plan>>;
  /** Fetches a fresh draft after an approval ran out (“Re-check and review”). */
  refetch: () => Promise<Result<Plan>>;
  /** Called with the run once run.start succeeded (including queued / blocked runs). */
  onStarted: (run: RunProgress) => void;
}

export interface PlanChange {
  headline: string;
  didNotHappen: string;
  /** The plan the user saw before — used to mark what changed. */
  previous: Plan;
}

export function useApproval(o: ApprovalOptions) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<ApprovalStage>('review');
  const [ack, setAck] = useState(false);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [busy, setBusy] = useState<null | 'approve' | 'run' | 'recheck'>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [expired, setExpired] = useState<ApiError | null>(null);
  const [changed, setChanged] = useState<PlanChange | null>(null);

  const opts = useRef(o);
  opts.current = o;
  const mounted = useRef(true);
  const keyRef = useRef<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const resetApproval = () => { setApproval(null); setAck(false); setActionError(null); };

  const reload = useCallback(async () => {
    const key = opts.current.loadKey;
    setLoading(true);
    setLoadError(null);
    const r = await opts.current.load();
    if (!mounted.current || keyRef.current !== key) return;
    if (r.ok) { setPlan(r.data); setLoadError(null); } else { setPlan(null); setLoadError(r.error); }
    setStage('review'); setExpired(null); setChanged(null); resetApproval();
    setLoading(false);
  }, []);

  // Load once per key (guarded so StrictMode's double effect never builds two plans, e.g. for undo).
  useEffect(() => {
    if (keyRef.current === o.loadKey) return;
    keyRef.current = o.loadKey;
    void reload();
  }, [o.loadKey, reload]);

  const active = useMemo(() => (plan ? activeSteps(plan.steps) : []), [plan]);
  const adminSteps = active.map((s, i) => (s.privilege === 'admin' ? i + 1 : 0)).filter(Boolean);
  const highSteps = active.map((s, i) => (s.risk === 'high' ? i + 1 : 0)).filter(Boolean);
  const needsAck = !!plan && (plan.requiresAdmin || plan.requiresReboot || highSteps.length > 0);

  const ackReasons: string[] = [];
  if (plan?.requiresAdmin) ackReasons.push('this plan needs admin rights');
  if (plan?.requiresReboot) ackReasons.push('your PC will restart during the repair');
  if (highSteps.length) ackReasons.push('it includes a high-risk step');

  const ackText = (() => {
    if (!plan) return '';
    const parts: string[] = [];
    const n = (xs: number[]) => (xs.length === active.length && xs.length > 2 ? `all ${xs.length} steps` : `step${xs.length > 1 ? 's' : ''} ${listJoin(xs)}`);
    if (adminSteps.length) parts.push(`${n(adminSteps)} ${adminSteps.length > 1 ? 'need' : 'needs'} admin rights, and Windows will ask me to confirm`);
    if (plan.requiresReboot) parts.push('my PC will restart during the repair, and I’ll approve again after the restart');
    if (highSteps.length) parts.push(`${n(highSteps)} ${highSteps.length > 1 ? 'are' : 'is'} high risk`);
    return `I understand ${listJoin(parts)}.`;
  })();

  const now = useNow(!!approval);
  const remainingMs = approval ? Date.parse(approval.expiresAt) - now : 0;

  // Rule 3: approvals expire visibly — the countdown reaching zero ends it here too (the orchestrator enforces it anyway).
  useEffect(() => {
    if (stage === 'confirm' && approval && remainingMs <= 0) {
      setExpired({ code: 'E_APPROVAL_EXPIRED', headline: 'This approval ran out', didNotHappen: 'Nothing ran.', nextStep: 'Re-check and review', detail: 'Approvals last 15 minutes.' });
      setStage('expired');
      setApproval(null);
      setAck(false);
    }
  }, [stage, approval, remainingMs]);

  const showChangedPlan = async (ref: string | undefined, previous: Plan, headline: string, didNotHappen: string) => {
    if (!ref) return false;
    const p = await ask('plan.get', { id: ref });
    if (!mounted.current || !p.ok) return false;
    setPlan(p.data);
    setChanged({ headline, didNotHappen, previous });
    setStage('review');
    return true;
  };

  const approve = async () => {
    if (!plan || busy) return;
    if (needsAck && !ack) return;
    // Back from the final check keeps the (still valid) approval for this exact plan.
    if (approval && approval.planId === plan.id && remainingMs > 0) { setStage('confirm'); return; }
    setBusy('approve');
    setActionError(null);
    const r = await ask('approval.submit', { planId: plan.id, planHash: plan.binding.planHash, uiConfirmationVersion: UI_CONFIRMATION_VERSION, acknowledged: ack });
    if (!mounted.current) return;
    setBusy(null);
    if (r.ok) { setApproval(r.data); setChanged(null); setStage('confirm'); return; }
    if (r.error.code === 'E_APPROVAL_MISMATCH' && r.error.ref && r.error.ref !== plan.id) {
      resetApproval();
      if (await showChangedPlan(r.error.ref, plan, r.error.headline, r.error.didNotHappen ?? 'Nothing was approved.')) return;
    }
    setActionError(r.error);
  };

  const back = () => { setStage('review'); setActionError(null); };

  const runFix = async () => {
    if (!plan || !approval || busy) return;
    setBusy('run');
    setActionError(null);
    const r = await ask('run.start', { approvalId: approval.approvalId, planHash: plan.binding.planHash });
    if (!mounted.current) return;
    setBusy(null);
    if (r.ok) { opts.current.onStarted(r.data); return; }
    const e = r.error;
    if (e.code === 'E_APPROVAL_EXPIRED') {
      setExpired(e); setStage('expired'); resetApproval();
      return;
    }
    if (e.code === 'E_APPROVAL_MISMATCH') {
      resetApproval();
      if (await showChangedPlan(e.ref, plan, e.headline, e.didNotHappen ?? 'Nothing ran.')) return;
      setStage('review');
    }
    setActionError(e);
  };

  /** “Re-check and review”: a fresh draft from the orchestrator; the user reviews and approves again. */
  const recheck = async () => {
    setBusy('recheck');
    setActionError(null);
    const r = await opts.current.refetch();
    if (!mounted.current) return;
    setBusy(null);
    if (r.ok) {
      setPlan(r.data); setStage('review'); setExpired(null); setChanged(null); resetApproval();
    } else setActionError(r.error);
  };

  return {
    plan, loading, loadError, reload, stage, ack, setAck, needsAck, ackText, ackReasons, active,
    approval, remainingMs, busy, actionError, expired, changed, approve, back, runFix, recheck,
  };
}

export type ApprovalApi = ReturnType<typeof useApproval>;
