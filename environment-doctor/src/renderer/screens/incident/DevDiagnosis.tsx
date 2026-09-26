/** Board 05 · Dev issue diagnosis (types dev | setup, and PC incidents without a crash timeline). */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { EvidenceRef, Incident } from '../../../shared/contracts';
import { Page } from '../../components/Shell';
import { Icon } from '../../components/Icon';
import { Button, ConfidenceMeter, EvidenceTag, LinkButton, LoopStepper, SegmentedControl, Spinner } from '../../components/ui';
import {
  AiNote, CheckAgainButton, CloseIncidentButton, EvidenceIds, HypothesisRow, IconBox, IncidentMeta, RunBanner, StaleNotice,
  incidentCrumbs, isRootCauseRestated, loopStepFor, runActive, type ViewProps,
} from './shared';
import { activeSteps, usePlanPreview } from './usePlanPreview';

export function DevDiagnosis({ inc, run, reload }: ViewProps) {
  const active = runActive(run);
  const blocked = inc.status === 'blocked';
  const stale = !!inc.stale;
  const wantPlan = !active && !blocked && !stale;
  const plan = usePlanPreview(inc.id, wantPlan);
  const step = loopStepFor(inc, run, !!plan.plan);

  return (
    <Page
      crumbs={incidentCrumbs(inc.id)}
      actions={<><CheckAgainButton />{!active && <CloseIncidentButton inc={inc} onClosed={reload} />}</>}
    >
      <RunBanner run={run} inc={inc} />
      {stale && <StaleNotice />}
      <section className="dx-head" aria-label="Incident">
        <div className="dx-head-main">
          <IconBox icon="alert" tone={inc.rootCause ? 'danger' : 'neutral'} />
          <div className="col" style={{ gap: 8, minWidth: 0 }}>
            <h1 className="dx-title">{inc.title}</h1>
            <IncidentMeta inc={inc} />
          </div>
        </div>
        <div className="dx-stepper"><LoopStepper current={step} /></div>
      </section>

      <div className={`dx-body ${stale ? 'dx-stale' : ''}`}>
        <div className="dx-main">
          <RootCauseCard inc={inc} />
          <Hypotheses inc={inc} />
        </div>
        <EvidencePanel inc={inc} />
      </div>

      <FixCta inc={inc} run={run} stale={stale} blocked={blocked} active={active} plan={plan} />
    </Page>
  );
}

function RootCauseCard({ inc }: { inc: Incident }) {
  const rc = inc.rootCause;
  if (!rc) {
    return (
      <section className="card dx-root unknown" aria-labelledby="dx-rc">
        <div className="row between">
          <h2 id="dx-rc" className="t-overline dx-root-label"><Icon name="search" size={16} />Root cause</h2>
          <ConfidenceMeter value="unknown" />
        </div>
        <p className="dx-root-title">Not found yet. Unknown is a valid answer — the checks below narrow it down.</p>
        <p className="t-small c-muted">{inc.summary}</p>
      </section>
    );
  }
  const facts = rc.detail.split(' · ').map((s) => s.trim().replace(/\.$/, '')).filter(Boolean).map((s) => s.charAt(0).toUpperCase() + s.slice(1));
  const confirmed = rc.confidence === 'confirmed';
  return (
    <section className={`card dx-root ${confirmed ? '' : 'pending'}`} aria-labelledby="dx-rc">
      <div className="row between">
        <h2 id="dx-rc" className={`t-overline dx-root-label ${confirmed ? 'ok' : ''}`}><Icon name="search" size={16} />Root cause</h2>
        {confirmed
          ? <span className="dx-conf-pill" data-confidence="confirmed"><Icon name="check" size={12} stroke={3} />Confirmed</span>
          : <ConfidenceMeter value={rc.confidence} />}
      </div>
      <p className="dx-root-title">{rc.title}</p>
      {facts.length > 1
        ? <ul className="dx-facts">{facts.map((f) => <li key={f} className="dx-fact"><Icon name="check" size={15} className={confirmed ? 'c-ok' : 'c-accent'} />{f}</li>)}</ul>
        : rc.detail && <p className="t-small c-text2">{rc.detail}</p>}
      <div className="row wrap" style={{ gap: 8 }}><span className="t-small c-subtle">Evidence</span><EvidenceIds ids={rc.evidenceIds} /></div>
    </section>
  );
}

function Hypotheses({ inc }: { inc: Incident }) {
  const others = useMemo(() => inc.hypotheses.filter((h) => !isRootCauseRestated(h, inc)), [inc]);
  const [open, setOpen] = useState<string | null>(() => others.find((h) => !h.vetoedByRule)?.id ?? null);
  return (
    <section className="card dx-hyps" aria-labelledby="dx-hyps-h">
      <div className="dx-hyps-head">
        <h2 id="dx-hyps-h" className="t-title">{inc.rootCause ? 'Other explanations considered' : 'Possible explanations'}</h2>
        <span className="t-small c-subtle">Open a row for the reasoning</span>
      </div>
      {others.length === 0
        ? <p className="t-small c-subtle" style={{ padding: '0 20px 16px' }}>No other explanation fits the evidence.</p>
        : <ul className="dx-hyp-list">{others.map((h) => <HypothesisRow key={h.id} h={h} open={open === h.id} onToggle={() => setOpen(open === h.id ? null : h.id)} />)}</ul>}
    </section>
  );
}

type EvFilter = 'all' | 'for' | 'against';

function EvidencePanel({ inc }: { inc: Incident }) {
  const [tab, setTab] = useState<EvFilter>('all');
  const count = (k: EvFilter) => inc.evidence.filter((e) => k === 'all' || e.kind === k).length;
  const rows = inc.evidence.filter((e) => tab === 'all' || e.kind === tab);
  return (
    <aside className="card dx-side dx-evidence" aria-labelledby="dx-ev-h">
      <div className="dx-evidence-head">
        <h2 id="dx-ev-h" className="t-title">Evidence</h2>
        <SegmentedControl<EvFilter>
          label="Filter evidence" value={tab} onChange={setTab}
          options={[{ value: 'all', label: 'All', count: count('all') }, { value: 'for', label: 'Supports', count: count('for') }, { value: 'against', label: 'Rules out', count: count('against') }]}
        />
      </div>
      <ul className="dx-ev-list" aria-label={`Evidence · ${tab === 'all' ? 'all' : tab === 'for' ? 'supports the cause' : 'rules things out'}`}>
        {rows.map((e) => <EvidenceRow key={e.id} e={e} />)}
        {rows.length === 0 && <li className="dx-ev-row"><span className="t-small c-subtle">{tab === 'against' ? 'Nothing collected rules an explanation out.' : 'No evidence collected yet.'}</span></li>}
      </ul>
      <AiNote note={inc.aiNote} />
    </aside>
  );
}

const KIND_WORD: Record<EvidenceRef['kind'], string> = { for: 'Supports', against: 'Rules out', neutral: 'Context' };

function EvidenceRow({ e }: { e: EvidenceRef }) {
  return (
    <li className={`dx-ev-row ${e.kind}`}>
      <EvidenceTag id={e.id} />
      <span className="col grow" style={{ gap: 3 }}>
        <span style={{ fontSize: 13, lineHeight: 1.4 }}>{e.text}</span>
        <span className="t-small c-subtle"><span className="sr-only">{KIND_WORD[e.kind]} · </span>{e.meta}</span>
      </span>
    </li>
  );
}

function FixCta({ inc, run, stale, blocked, active, plan }: { inc: Incident; run: ViewProps['run']; stale: boolean; blocked: boolean; active: boolean; plan: ReturnType<typeof usePlanPreview> }) {
  const nav = useNavigate();
  if (stale) {
    return (
      <section className="card dx-cta muted" aria-label="Fix">
        <IconBox icon="clock" tone="neutral" size="sm" />
        <div className="col grow" style={{ gap: 2 }}><span className="t-title">No fix from an out-of-date diagnosis</span><span className="t-small c-muted">Nothing was approved. Check again to collect fresh evidence.</span></div>
        <Button variant="primary" icon="search" onClick={() => nav('/scan?start=1')}>Check again</Button>
      </section>
    );
  }
  if (active) {
    return (
      <section className="card dx-cta" aria-label="Fix">
        <IconBox icon="wrench" tone="accent" size="sm" />
        <div className="col grow" style={{ gap: 2 }}><span className="t-title">{run?.queuedBehind ? `Queued behind ${run.queuedBehind}` : 'A repair is running for this incident'}</span><span className="t-small c-muted">Follow each step and its verification on the repair screen.</span></div>
        <LinkButton to={`/incidents/${inc.id}/run`} variant="primary" icon="arrowRight">Open the repair</LinkButton>
      </section>
    );
  }
  if (blocked) {
    return (
      <section className="card dx-cta warn" aria-label="Fix">
        <IconBox icon="alert" tone="warn" size="sm" />
        <div className="col grow" style={{ gap: 2 }}><span className="t-title">Paused — your PC changed mid-repair</span><span className="t-small c-muted">{run?.notRunStep ? `${run.notRunStep} did not run. ` : ''}Decide what happens next on the repair screen.</span></div>
        <LinkButton to={`/incidents/${inc.id}/run`} variant="primary">See what changed</LinkButton>
      </section>
    );
  }
  if (plan.loading) {
    return (
      <section className="card dx-cta" aria-label="Fix" aria-busy="true">
        <Spinner label="Preparing the fix" />
        <span className="t-small c-muted grow">Preparing a fix from the frozen evidence…</span>
      </section>
    );
  }
  if (plan.error) {
    const unsupported = plan.error.code === 'E_RULE_UNSUPPORTED';
    const next = plan.error.nextStep ?? inc.hypotheses.find((h) => h.test)?.test;
    return (
      <section className="card dx-cta warn" aria-label="Fix" role="status">
        <IconBox icon={unsupported ? 'info' : 'alert'} tone="warn" size="sm" />
        <div className="col grow" style={{ gap: 2 }}>
          <span className="t-title">{unsupported ? 'There’s no safe fix for this yet' : plan.error.headline}</span>
          <span className="t-small c-muted">{plan.error.didNotHappen ?? 'Nothing will change.'}{next && <> · <span className="c-text2">Next step: {next}</span></>}</span>
          <details className="t-small c-subtle"><summary>Details</summary><span className="mono">{plan.error.code}</span>{plan.error.detail && <pre className="code" style={{ marginTop: 6 }}>{plan.error.detail}</pre>}</details>
        </div>
        {unsupported
          ? <Button variant="primary" icon="search" onClick={() => nav('/scan?start=1')}>Check again</Button>
          : <Button onClick={() => void plan.reload()}>Try again</Button>}
      </section>
    );
  }
  const p = plan.plan;
  if (!p) return null;
  const steps = activeSteps(p);
  const removed = p.steps.length - steps.length;
  const minutes = p.estimatedMinutes <= 1 ? 'about a minute' : `about ${p.estimatedMinutes} min`;
  return (
    <section className="card dx-cta" aria-labelledby="dx-fix-h">
      <IconBox icon="wrench" tone="accent" size="sm" />
      <div className="col grow" style={{ gap: 2 }}>
        <span id="dx-fix-h" className="t-title">Fix ready · {steps.length} {steps.length === 1 ? 'step' : 'steps'}, {minutes}</span>
        <span className="t-small c-muted">
          {steps.map((s) => s.title + (s.privilege === 'admin' ? ' (needs admin)' : '') + (s.reboot ? ' (restart)' : '')).join(' · ')}
          {removed > 0 && <> · {removed} {removed === 1 ? 'step' : 'steps'} removed by policy</>}
        </span>
      </div>
      <LinkButton to={`/incidents/${inc.id}/plan`} variant="primary" icon="arrowRight">Review fix</LinkButton>
    </section>
  );
}
