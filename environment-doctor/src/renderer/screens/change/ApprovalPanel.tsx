/** Board 06 aside: approve this exact plan → final check → run. Shared by Plan and Guided. */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Button, Checkbox, ErrorState, StatusChip, clock } from '../../components/ui';
import { listJoin, mmss, shortHash } from './api';
import type { ApprovalApi } from './useApproval';

export function ApprovalPanel({ a, runLabel, notNowTo, blockedReason, backTo }: {
  a: ApprovalApi;
  runLabel: string;
  notNowTo: string;
  /** A reason approval is not possible right now (e.g. a repair for this incident is already running). */
  blockedReason?: string | null;
  /** Where to start again if a fresh plan can't be built here. */
  backTo: string;
}) {
  // One toggle for the technical binding details, kept across review → final check.
  const [tech, setTech] = useState(false);
  if (!a.plan) return null;
  const binding = <Binding a={a} tech={tech} onTech={() => setTech((t) => !t)} />;
  return (
    <section className="card ch-panel" aria-label="Approval">
      {a.changed && a.stage === 'review' && (
        <div className="ch-note warn" role="alert">
          <Icon name="alert" size={16} />
          <span className="col" style={{ gap: 2 }}>
            <strong>{a.changed.headline} · {a.changed.didNotHappen.replace(/\.$/, '')}</strong>
            <span>We loaded the new plan. Review what changed — it needs a fresh approval.</span>
          </span>
        </div>
      )}
      {a.stage === 'expired'
        ? <Expired a={a} backTo={backTo} binding={binding} />
        : a.stage === 'confirm' && a.approval
          ? <Confirm a={a} runLabel={runLabel} binding={binding} />
          : <Review a={a} notNowTo={notNowTo} blockedReason={blockedReason} binding={binding} />}
    </section>
  );
}

function Head({ icon, tone, title, sub, focusRef }: { icon: 'shield' | 'shieldCheck' | 'clock' | 'alert'; tone: 'accent' | 'ok' | 'warn' | 'danger'; title: ReactNode; sub: ReactNode; focusRef?: React.Ref<HTMLHeadingElement> }) {
  return (
    <div className="ch-panel-head">
      <span className={`ch-icon ${tone}`} aria-hidden="true"><Icon name={icon} size={19} /></span>
      <div className="col" style={{ gap: 2 }}>
        <h2 className="ch-panel-title" tabIndex={focusRef ? -1 : undefined} ref={focusRef}>{title}</h2>
        <span className="t-small c-muted">{sub}</span>
      </div>
    </div>
  );
}

/** UI safety rule 2: plan hash, evidence snapshot and expiry are always visible; technical details behind one toggle. */
function Binding({ a, tech, onTech }: { a: ApprovalApi; tech: boolean; onTech: () => void }) {
  const plan = a.plan!;
  const techId = useId();
  const expiry = a.stage === 'expired'
    ? 'Ran out — nothing ran'
    : a.approval
      ? <>Runs out in <span className="ch-timer" role="timer" aria-live="off">{mmss(a.remainingMs)}</span> or at restart</>
      : '15 min or restart, whichever is first';
  return (
    <>
      <div className="ch-bind">
        <dl>
          <div><dt>Plan fingerprint</dt><dd className="mono" title={plan.binding.planHash}>{shortHash(plan.binding.planHash)}</dd></div>
          <div><dt>Evidence snapshot</dt><dd className="mono">{plan.binding.evidenceSnapshot}</dd></div>
          <div><dt>Expires</dt><dd>{expiry}</dd></div>
        </dl>
        {tech && (
          <dl className="ch-tech" id={techId}>
            <div><dt>Plan hash</dt><dd>{plan.binding.planHash}</dd></div>
            <div><dt>Boot session</dt><dd>{plan.binding.bootId}</dd></div>
            <div><dt>UI confirmation</dt><dd>{plan.binding.uiConfirmationVersion}</dd></div>
            <div><dt>Plan ID</dt><dd>{plan.id}</dd></div>
            {a.approval && <div><dt>Approval</dt><dd>{a.approval.approvalId} · approved {clock(a.approval.approvedAt)}</dd></div>}
            <div><dt>Actions</dt><dd>{a.active.map((s) => <span key={s.id} style={{ display: 'block' }}>{s.actionId} · v{s.actionVersion}</span>)}</dd></div>
          </dl>
        )}
      </div>
      <button type="button" className="ch-linkbtn" aria-expanded={tech} aria-controls={tech ? techId : undefined} onClick={onTech}>
        <Icon name={tech ? 'chevronDown' : 'chevronRight'} size={14} />{tech ? 'Hide technical details' : 'Show technical details'}
      </button>
    </>
  );
}

function Review({ a, notNowTo, blockedReason, binding }: { a: ApprovalApi; notNowTo: string; blockedReason?: string | null; binding: ReactNode }) {
  const plan = a.plan!;
  const reasonId = useId();
  const ackId = useId();
  const used = plan.status !== 'draft' && !a.approval;
  const reason = blockedReason
    ?? (used ? 'This plan was already used or ran out. Get a fresh plan to continue.' : null)
    ?? (a.needsAck && !a.ack ? `Tick the box above to approve — ${listJoin(a.ackReasons)}.` : null);
  return (
    <>
      <Head icon="shield" tone="accent" title="Approve this exact plan" sub="Locked to this plan, on this PC, this session" />
      {binding}
      <p className="t-small c-muted row start" style={{ gap: 8 }}><Icon name="info" size={15} style={{ flexShrink: 0, marginTop: 1 }} />If anything in the plan or on your PC changes, this approval stops working and we ask again.</p>
      {plan.requiresAdmin && !used && (
        <p className="t-small c-muted row start" style={{ gap: 8 }}><Icon name="shield" size={15} style={{ flexShrink: 0, marginTop: 1 }} />After you approve, Windows asks for admin permission. We never ask for your password.</p>
      )}
      {a.needsAck && !used && (
        <div className={`ch-ack ${a.ack ? 'on' : ''}`}>
          <Checkbox id={ackId} checked={a.ack} onChange={a.setAck}>{a.ackText}</Checkbox>
        </div>
      )}
      {a.actionError && (
        <ErrorState compact error={a.actionError} onRetry={a.actionError.code === 'E_APPROVAL_MISMATCH' || a.actionError.code === 'E_EVIDENCE_STALE' ? a.recheck : undefined} retryLabel="Get a fresh plan" />
      )}
      {used
        ? <Button variant="primary" size="lg" className="ch-full" onClick={a.recheck} disabled={a.busy === 'recheck'}>{a.busy === 'recheck' ? 'Getting a fresh plan…' : 'Get a fresh plan'}</Button>
        : (
          <Button variant="primary" size="lg" className="ch-full" icon="shieldCheck" disabled={!!reason || a.busy === 'approve'} aria-describedby={reason ? reasonId : undefined} onClick={a.approve}>
            {a.busy === 'approve' ? 'Approving…' : 'Approve plan'}
          </Button>
        )}
      {reason && <p id={reasonId} className="ch-reason"><Icon name="info" size={14} style={{ flexShrink: 0, marginTop: 2 }} />{reason}</p>}
      <Link to={notNowTo} className="ch-notnow">Not now</Link>
    </>
  );
}

function Confirm({ a, runLabel, binding }: { a: ApprovalApi; runLabel: string; binding: ReactNode }) {
  const plan = a.plan!;
  const ap = a.approval!;
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const allOk = ap.finalCheck.every((c) => c.ok);
  const expiryId = useId();
  return (
    <>
      <Head
        icon={allOk ? 'shieldCheck' : 'alert'} tone={allOk ? 'ok' : 'danger'} focusRef={ref}
        title={allOk ? 'Approved — final check passed' : 'Final check found a problem'}
        sub={`Re-checked at ${clock(ap.approvedAt)}, right before running`}
      />
      <div className="col" style={{ gap: 8 }}>
        <span className="t-overline">Final check</span>
        <ul className="ch-final" aria-label="Final check">
          {ap.finalCheck.map((c, i) => (
            <li key={i}>
              <Icon name={c.ok ? 'check' : 'close'} size={15} className={c.ok ? 'c-ok' : 'c-danger'} />
              <span className="grow">{c.label}</span>
              <StatusChip status={c.ok ? 'ok' : 'fail'} label={c.ok ? 'Passed' : 'Failed'} />
            </li>
          ))}
        </ul>
      </div>
      {binding}
      <p className="ch-expiry" id={expiryId}>
        <Icon name="clock" size={15} />
        <span>This approval runs out in <strong className="ch-timer">{mmss(a.remainingMs)}</strong> — or at the next restart.</span>
      </p>
      {plan.requiresAdmin && (
        <div className="ch-note warn">
          <Icon name="shield" size={16} />
          <span>Next, Windows asks for permission. Check the prompt names <strong>Environment Doctor admin helper</strong> and a verified publisher. We never ask for your password.</span>
        </div>
      )}
      {plan.requiresReboot && (
        <div className="ch-note info">
          <Icon name="restart" size={16} />
          <span>A restart is part of this repair. Your approval ends at the restart — you’ll confirm again before anything else changes.</span>
        </div>
      )}
      {a.actionError && <ErrorState compact error={a.actionError} />}
      <Button variant="primary" size="lg" className="ch-full" icon="play" onClick={a.runFix} disabled={!allOk || a.busy === 'run'} aria-describedby={expiryId}>
        {a.busy === 'run' ? 'Starting…' : runLabel}
      </Button>
      <Button variant="ghost" className="ch-back" onClick={a.back}>Back</Button>
    </>
  );
}

function Expired({ a, backTo, binding }: { a: ApprovalApi; backTo: string; binding: ReactNode }) {
  const e = a.expired;
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <>
      <div className="col gap-4" role="alert">
        <Head icon="clock" tone="warn" focusRef={ref} title={e?.headline ?? 'This approval ran out'} sub="Approvals last 15 minutes, or until a restart" />
        <p className="ch-nothing"><Icon name="check" size={15} />Nothing ran.</p>
        <p className="t-small c-muted">{e?.detail ? `${e.detail} ` : ''}Your PC may have changed since you looked, so we re-check it and show you the plan again before asking you to approve.</p>
      </div>
      {binding}
      {a.actionError && (
        <div className="col gap-3">
          <ErrorState compact error={a.actionError} />
          <Link to={backTo} className="btn">Start again from the incident</Link>
        </div>
      )}
      <Button variant="primary" size="lg" className="ch-full" icon="restart" onClick={a.recheck} disabled={a.busy === 'recheck'}>
        {a.busy === 'recheck' ? 'Re-checking…' : 'Re-check and review'}
      </Button>
      {e && <details className="t-small c-subtle"><summary>Details</summary><span className="mono">{e.code}</span></details>}
    </>
  );
}
