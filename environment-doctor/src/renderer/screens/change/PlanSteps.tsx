/** Board 06 primary column: typed steps (expandable), removed steps, and the verification contract. */
import { useId, useState } from 'react';
import type { ActionEntry, Plan, PlanStep, VerificationCheck } from '../../../shared/contracts';
import { Icon } from '../../components/Icon';
import { activeSteps, riskWord, undoShort } from './api';

export const TIER_WORD: Record<VerificationCheck['tier'], string> = {
  V1: 'State check', V2: 'Original problem re-tested', V3: 'Stress test', V4: 'Your real workflow', V5: 'Watched over time',
};

export function PlanStats({ plan }: { plan: Plan }) {
  const act = activeSteps(plan.steps);
  const risk = act.some((s) => s.risk === 'high') ? 'high' : act.some((s) => s.risk === 'medium') ? 'medium' : 'low';
  const admin = act.filter((s) => s.privilege === 'admin').length;
  const undoable = act.filter((s) => !/not possible/i.test(s.undo)).length;
  const undo = undoable === 0 ? 'None' : undoable === act.length ? (act.length === 1 ? 'Yes' : act.length === 2 ? 'Both steps' : 'All steps') : `${undoable} of ${act.length} steps`;
  const stats: [string, string][] = [
    ['Risk', riskWord(risk)],
    ['Admin', admin === 0 ? 'Not needed' : `${admin} step${admin > 1 ? 's' : ''}`],
    ['Undo', undo],
    ['Restart', plan.requiresReboot ? 'Needed' : 'Not needed'],
    ['Time', plan.estimatedMinutes <= 1 ? 'About a minute' : `~${plan.estimatedMinutes} min`],
  ];
  return (
    <dl className="ch-stats">
      {stats.map(([k, v]) => <div key={k} className="ch-stat"><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}

export function PlanSteps({ plan, previous, catalog }: { plan: Plan; previous?: Plan | null; catalog: ActionEntry[] }) {
  const act = activeSteps(plan.steps);
  const removed = plan.steps.filter((s) => s.removedReason);
  const [open, setOpen] = useState<string | null>(act[0]?.id ?? null);
  const before = new Map((previous?.steps ?? []).map((s) => [s.id, s]));
  return (
    <section className="col" style={{ gap: 10 }} aria-labelledby="ch-steps-h">
      <div className="row between">
        <h2 id="ch-steps-h" className="t-title">What will change</h2>
        <span className="t-small c-subtle">{act.length} step{act.length === 1 ? '' : 's'} · in this order</span>
      </div>
      <ol className="ch-steps" aria-label="Plan steps">
        {act.map((s, i) => {
          const was = before.get(s.id);
          const changed = !!previous && (!was || was.targetSummary !== s.targetSummary || was.title !== s.title || was.actionVersion !== s.actionVersion);
          return <StepCard key={s.id} n={i + 1} step={s} open={open === s.id} onToggle={() => setOpen(open === s.id ? null : s.id)} changed={changed} why={catalog.find((c) => c.id === s.actionId)?.description} />;
        })}
      </ol>
      {removed.length > 0 && (
        <div className="col" style={{ gap: 8 }}>
          <h3 className="t-overline">Removed from this plan — won’t run</h3>
          <ul className="ch-steps" aria-label="Removed steps">
            {removed.map((s) => (
              <li key={s.id} className="ch-step removed">
                <div className="ch-step-head static">
                  <span className="ch-step-n" aria-hidden="true"><Icon name="close" size={14} /></span>
                  <span className="col grow" style={{ gap: 4 }}>
                    <s className="t-title c-muted">{s.title}</s>
                    <span className="mono t-small c-subtle">{s.targetSummary}</span>
                  </span>
                  <span className="chip neutral">Removed</span>
                </div>
                <details className="ch-why">
                  <summary className="btn ghost sm">See why</summary>
                  <p className="t-small c-text2">{s.removedReason}</p>
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function StepCard({ n, step: s, open, onToggle, changed, why }: { n: number; step: PlanStep; open: boolean; onToggle: () => void; changed: boolean; why?: string }) {
  const bodyId = useId();
  return (
    <li className={`ch-step ${open ? 'open' : ''} ${changed ? 'changed' : ''}`}>
      <button type="button" className="ch-step-head" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={onToggle}>
        <span className="ch-step-n" aria-hidden="true">{n}</span>
        <span className="col grow" style={{ gap: 4 }}>
          <span className="t-title row wrap" style={{ gap: 8 }}><span className="sr-only">Step {n}: </span>{s.title}{changed && <span className="chip warn">Changed</span>}</span>
          <span className="mono t-small c-muted ch-target">{s.targetSummary}</span>
        </span>
        <span className="row wrap end" style={{ gap: 6, maxWidth: 340 }}>
          <span className={`chip ${s.privilege === 'admin' ? 'warn' : 'neutral'}`}>{s.privilege === 'admin' ? 'Needs admin' : 'Your account'}</span>
          <span className={`chip ${s.risk === 'high' ? 'fail' : 'neutral'}`}>{riskWord(s.risk)} risk</span>
          {s.reboot && <span className="chip neutral"><Icon name="restart" size={12} />Restart</span>}
        </span>
        <Icon name="chevronDown" size={16} className="chev" />
      </button>
      {open && (
        <div className="ch-step-body" id={bodyId}>
          <p className="c-text2" style={{ fontSize: 13 }}>{why ?? s.targetSummary}</p>
          {s.preconditions.length > 0 && (
            <div className="col" style={{ gap: 6 }}>
              <span className="t-overline">Checked again right before it runs</span>
              <ul className="ch-checks">
                {s.preconditions.map((p) => <li key={p}><Icon name="check" size={13} className="c-subtle" />{p}</li>)}
              </ul>
            </div>
          )}
          <p className="t-small c-muted"><span className="c-subtle">Undo · </span>{undoShort(s.undo)}</p>
          <p className="mono ch-action">{s.actionId} · v{s.actionVersion} · undo: {undoShort(s.undo).replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase())}</p>
        </div>
      )}
    </li>
  );
}

export function VerificationContract({ plan }: { plan: Plan }) {
  const n = plan.verification.length;
  return (
    <section className="card" aria-labelledby="ch-ver-h">
      <div className="card-head">
        <h2 id="ch-ver-h" className="t-title">How we’ll know it worked</h2>
        <span className="t-small c-subtle">{n === 1 ? 'This check must pass' : `All ${n} must pass`} · checked without the AI</span>
      </div>
      <p className="t-small c-muted">It only counts as fixed when every check below passes. A step finishing, or an exit code, is information — never proof.</p>
      <ol className="ch-ver" aria-label="Verification contract">
        {plan.verification.map((v) => (
          <li key={v.id}>
            <span className="tier"><span className="chip neutral mono">{v.tier}</span>{TIER_WORD[v.tier]}</span>
            <span>{v.label}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
