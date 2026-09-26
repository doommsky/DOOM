/**
 * Board 06 · Plan & approval — /incidents/:id/plan[?variant=…|?next=1|?planId=…]
 * Typed steps, the verification contract and the binding summary; acknowledgement → approve → final check → run.
 * UI safety rules 1–3: nothing runs without this screen, the binding is always visible, expiry is visible.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { ActionEntry, ApiError, Channels } from '../../shared/contracts';
import { useApp } from '../AppContext';
import { Icon } from '../components/Icon';
import { Page } from '../components/Shell';
import { Card, ErrorState, LinkButton, LoadingState } from '../components/ui';
import { ApprovalPanel } from './change/ApprovalPanel';
import { PlanStats, PlanSteps, VerificationContract } from './change/PlanSteps';
import { ask } from './change/api';
import { useApproval } from './change/useApproval';
import '../styles/change.css';

type Variant = NonNullable<Channels['plan.forIncident']['req']['variant']>;
const VARIANTS: Variant[] = ['rollback', 'clean', 'user-only', 'undo', 'resume'];

export default function Plan() {
  const { id = '' } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { lock } = useApp();
  const planId = sp.get('planId') ?? undefined;
  const rawVariant = sp.get('variant');
  const variant = VARIANTS.includes(rawVariant as Variant) ? (rawVariant as Variant) : undefined;
  const next = sp.get('next') === '1';

  const fresh = useCallback(
    () => ask('plan.forIncident', { incidentId: id, ...(variant ? { variant } : {}), ...(next ? { next: true } : {}) }),
    [id, variant, next],
  );
  const a = useApproval({
    loadKey: `${id}|${planId ?? ''}|${variant ?? ''}|${next ? 1 : 0}`,
    load: () => (planId ? ask('plan.get', { id: planId }) : fresh()),
    refetch: fresh,
    // Queued, blocked (helper untrusted) and running repairs are all shown by the run screen.
    onStarted: () => nav(`/incidents/${id}/run`),
  });

  const [catalog, setCatalog] = useState<ActionEntry[]>([]);
  useEffect(() => { void ask('actions.catalog', undefined).then((r) => { if (r.ok) setCatalog(r.data); }); }, []);

  const plan = a.plan;
  const isSetup = plan?.kind === 'setup' || id.startsWith('SU-');
  const incidentTo = isSetup ? '/setup' : `/incidents/${id}`;
  const crumbs = isSetup
    ? [{ label: 'Set up', to: '/setup' }, { label: 'Plan' }]
    : [{ label: 'Incidents', to: '/incidents' }, { label: id, to: `/incidents/${id}` }, { label: 'Repair plan' }];
  const actions = <span className="t-small c-subtle row" style={{ gap: 6 }}><Icon name="clock" size={14} />Approval window: 15 min, or until restart</span>;

  const sameRunning = !!lock?.held && lock.incidentId === id;
  const otherRunning = !!lock?.held && !!lock.incidentId && lock.incidentId !== id;

  if (a.loading && !plan) {
    return <Page crumbs={crumbs} actions={actions}><LoadingState label="Building the plan…" /></Page>;
  }
  if (!plan) {
    return (
      <Page crumbs={crumbs} actions={actions}>
        <PlanLoadError error={a.loadError ?? { code: 'E_NOT_FOUND', headline: 'That plan wasn’t found', didNotHappen: 'Nothing changed.' }} onRetry={a.reload} backTo={incidentTo} />
      </Page>
    );
  }

  const kindWord = plan.kind === 'guided' ? 'Guided repair plan' : plan.kind === 'setup' ? 'Setup plan' : variant === 'undo' ? 'Undo plan' : 'Repair plan';
  return (
    <Page
      crumbs={crumbs}
      actions={actions}
      split
      aside={
        <ApprovalPanel
          a={a}
          runLabel={plan.kind === 'setup' ? 'Run the setup' : plan.kind === 'guided' ? 'Start the repair' : 'Run the fix'}
          notNowTo={incidentTo}
          backTo={incidentTo}
          blockedReason={sameRunning ? 'A repair for this incident is already running. Nothing new can be approved until it ends.' : null}
        />
      }
    >
      <div className="col" style={{ gap: 18 }}>
        <section className="col gap-4" aria-labelledby="ch-plan-h">
          <div className="col" style={{ gap: 6 }}>
            <span className="t-overline">{kindWord} · {id}</span>
            <h1 id="ch-plan-h" className="t-h1">{variant === 'undo' ? 'Here’s the undo plan' : plan.kind === 'setup' ? 'Here’s the setup plan' : 'Here’s the fix'}</h1>
            <p className="c-muted" style={{ fontSize: 14 }}>{plan.title}</p>
          </div>
          <PlanStats plan={plan} />
        </section>

        {sameRunning && (
          <div className="ch-note info" role="status">
            <Icon name="lock" size={16} />
            <span className="grow">A repair for {id} is running right now. One repair at a time.</span>
            <LinkButton to={`/incidents/${id}/run`} size="sm">See progress</LinkButton>
          </div>
        )}
        {otherRunning && (
          <div className="ch-note info" role="status">
            <Icon name="lock" size={16} />
            <span>Another repair ({lock!.incidentId}) is running. You can still approve this plan — it waits its turn and nothing runs until the other one ends.</span>
          </div>
        )}
        {plan.kind === 'guided' && (
          <div className="ch-note neutral">
            <Icon name="restart" size={16} />
            <span className="grow">This repair spans restarts. The step-by-step guide shows what you’ll see at each step.</span>
            <LinkButton to={`/incidents/${id}/guided`} size="sm">Open the guide</LinkButton>
          </div>
        )}
        {plan.isolationNote && (
          <div className="ch-note ok">
            <Icon name="shieldCheck" size={16} />
            <span><strong>Kept isolated.</strong> {plan.isolationNote}</span>
          </div>
        )}

        <PlanSteps plan={plan} previous={a.changed?.previous} catalog={catalog} />
        <VerificationContract plan={plan} />
      </div>
    </Page>
  );
}

function PlanLoadError({ error, onRetry, backTo }: { error: ApiError; onRetry: () => void; backTo: string }) {
  const settled = error.code === 'E_RULE_UNSUPPORTED' || error.code === 'E_POLICY_DENIED';
  const lines = error.code === 'E_POLICY_DENIED' && error.detail ? error.detail.split('\n').filter(Boolean) : [];
  return (
    <div className="col gap-4" style={{ maxWidth: 760 }}>
      <ErrorState error={error} onRetry={settled ? undefined : onRetry} retryLabel="Try again" />
      {lines.length > 0 && (
        <Card aria-labelledby="ch-removed-h">
          <h2 id="ch-removed-h" className="t-title">Why each step was removed</h2>
          <ul className="list" aria-label="Removed steps">
            {lines.map((l) => {
              const [title, ...rest] = l.split(': ');
              return (
                <li key={l} className="list-row">
                  <Icon name="close" size={14} className="c-subtle" />
                  <span className="col grow" style={{ gap: 2 }}><s className="c-muted">{title}</s><span className="t-small c-text2">{rest.join(': ')}</span></span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <div className="row"><LinkButton to={backTo} icon="arrowRight">Back to the incident</LinkButton></div>
    </div>
  );
}
