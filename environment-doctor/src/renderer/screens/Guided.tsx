/**
 * Board 10 · Guided repair — /incidents/:id/guided
 * A multi-step repair across restarts (INC-0043 clean driver reinstall). Starting needs the same approval as any
 * plan (rule 1). When a step needs a restart the journal is saved as WAITING_FOR_REBOOT before the restart is
 * requested (AC-19); after the restart Resume (screen 11) re-checks and asks again (rule 4).
 */
import { useCallback, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import type { Plan, PlanStep, RunProgress } from '../../shared/contracts';
import { AdminHandoff } from '../components/AdminHandoff';
import { Icon, type IconName } from '../components/Icon';
import { Page } from '../components/Shell';
import { Button, Card, ErrorState, LinkButton, LoadingState, Spinner, StatusChip, journalLabel } from '../components/ui';
import { ApprovalPanel } from './change/ApprovalPanel';
import { activeSteps, ask, isActiveRun } from './change/api';
import { useApproval } from './change/useApproval';
import { useRunFollow } from './change/useRunFollow';
import '../styles/change.css';

type Kind = 'Safety net' | 'Download' | 'Restart' | 'Fix' | 'Verify';
interface Copy { kind: Kind; body: string; see: string; cta?: string }

/** Friendly copy for the INC-0043 guided steps (board 10). Anything else falls back to the step’s own fields. */
const COPY: Record<string, Copy> = {
  'Create a restore point': { kind: 'Safety net', body: 'Saves a Windows restore point first, so there’s always a way back if anything goes wrong.', see: 'A short progress note. Nothing else on your PC changes.' },
  'Download a clean driver': { kind: 'Download', body: 'Downloads the signed driver package and checks its signature and fingerprint before anything uses it.', see: 'A download progress note. Your current driver keeps working for now.' },
  'Restart into Safe Mode': { kind: 'Restart', body: 'Safe Mode starts Windows with only basic drivers, so the NVIDIA driver can be removed cleanly without anything holding on to it.', see: 'A black screen for a minute, then a low-resolution desktop with “Safe Mode” in the corners. That’s normal.', cta: 'Restart into Safe Mode' },
  'Remove the current driver': { kind: 'Fix', body: 'Removes the NVIDIA display driver that started the freezes. The old package stays saved so it can be put back.', see: 'The screen may flicker once. Resolution stays low until the next step.' },
  'Install the clean driver': { kind: 'Fix', body: 'Installs the verified driver package downloaded earlier — nothing else, and nothing new from the internet at this point.', see: 'A progress bar, then a normal-looking desktop after the next restart.' },
  'Restart normally': { kind: 'Restart', body: 'Back to normal Windows with the fresh driver loaded.', see: 'A normal start-up. Environment Doctor opens and continues.', cta: 'Restart now' },
};
const VERIFY_TITLE = 'Prove it’s fixed';
const VERIFY_COPY: Copy = { kind: 'Verify', body: 'We put the laptop to sleep and wake it three times, then keep quietly watching for freezes. Only when every check passes is it marked fixed.', see: 'The screen turns off and back on a few times. Leave the lid open.' };

const copyFor = (s: PlanStep): Copy => COPY[s.title] ?? { kind: s.reboot && /restart/i.test(s.title) ? 'Restart' : 'Fix', body: s.targetSummary, see: 'Progress shows here while it runs.' };
const KIND_ICON: Record<Kind, IconName> = { 'Safety net': 'shieldCheck', Download: 'download', Restart: 'restart', Fix: 'wrench', Verify: 'check' };

interface Item { id: string; title: string; sub: string; state: 'done' | 'now' | 'todo' | 'bad'; step?: PlanStep; verify?: boolean; restartLabel?: string }

export default function Guided() {
  const { id = '' } = useParams();
  const f = useRunFollow(id, { load: false });
  const [earlier, setEarlier] = useState<{ run: RunProgress; plan: Plan | null } | null>(null);
  const [lastRun, setLastRun] = useState<RunProgress | null>(null);

  const fresh = useCallback(() => ask('plan.forIncident', { incidentId: id, variant: 'clean' }), [id]);
  const a = useApproval({
    loadKey: id,
    load: async () => {
      const [inc, rg] = await Promise.all([ask('incident.get', { id }), ask('run.get', { incidentId: id })]);
      const prev = rg.ok ? rg.data : null;
      // A repair already under way (or waiting for its restart): follow it instead of building a new plan.
      if (prev && isActiveRun(prev.state)) { f.adopt(prev); return ask('plan.get', { id: prev.planId }); }
      if (prev) setLastRun(prev);
      // After a restart, Resume leaves a continuation plan: the remaining steps, to approve again.
      if (inc.ok && inc.data.planId && prev) {
        const p = await ask('plan.get', { id: inc.data.planId });
        if (p.ok && p.data.status === 'draft' && p.data.kind === 'guided' && prev.steps.some((s) => s.state === 'done' && !p.data.steps.some((x) => x.id === s.id))) {
          const orig = await ask('plan.get', { id: prev.planId });
          setEarlier({ run: prev, plan: orig.ok ? orig.data : null });
          return p;
        }
      }
      return fresh();
    },
    refetch: fresh,
    onStarted: (r) => f.adopt(r),
  });

  const plan = a.plan;
  const run = f.run && plan && f.run.planId === plan.id ? f.run : null;
  const crumbs = [{ label: 'Incidents', to: '/incidents' }, { label: id, to: `/incidents/${id}` }, { label: 'Guided repair' }];

  const { decide } = f;
  const [hidden, setHidden] = useState<string | null>(null);
  const promptKey = run?.adminPrompt ? `${run.executionId}:${run.adminPrompt}` : null;
  const closeOverlay = useCallback(() => setHidden(promptKey), [promptKey]);
  const allow = useCallback(() => { if (run) void decide(run.executionId, 'admin-allow'); }, [decide, run]);
  const decline = useCallback(() => { if (run) void decide(run.executionId, 'admin-decline'); }, [decide, run]);

  if (a.loading && !plan) return <Page crumbs={crumbs}><LoadingState label="Preparing the guided repair…" /></Page>;
  if (!plan) {
    return (
      <Page crumbs={crumbs}>
        <ErrorState error={a.loadError ?? { code: 'E_NOT_FOUND', headline: 'That repair wasn’t found', didNotHappen: 'Nothing changed.' }} onRetry={a.reload} />
        <div className="row"><LinkButton to={`/incidents/${id}`}>Back to the incident</LinkButton></div>
      </Page>
    );
  }

  // ── the full list: earlier (done) steps + this plan’s steps + the final proof ──
  const act = activeSteps(plan.steps);
  const doneBefore = earlier ? earlier.run.steps.filter((s) => s.state === 'done' && !act.some((x) => x.id === s.id)) : [];
  const allSteps: PlanStep[] = [
    ...doneBefore.map((s) => earlier?.plan?.steps.find((x) => x.id === s.id) ?? ({ id: s.id, title: s.title, targetSummary: '', actionId: '', actionVersion: '', risk: 'low', privilege: 'user', reboot: false, undo: '', preconditions: [] } as PlanStep)),
    ...act,
  ];
  const restartIds = allSteps.filter((s) => copyFor(s).kind === 'Restart').map((s) => s.id);
  const runStep = (sid: string) => run?.steps.find((x) => x.id === sid);
  const verifying = !!run && ['EXECUTED', 'VERIFYING'].includes(run.state);

  let currentIdx = -1;
  const items: Item[] = allSteps.map((s, i) => {
    const before = doneBefore.some((d) => d.id === s.id);
    const rs = runStep(s.id);
    let state: Item['state'] = 'todo';
    if (before || rs?.state === 'done') state = 'done';
    if (rs?.state === 'failed') state = 'bad';
    const rIdx = restartIds.indexOf(s.id);
    const restartLabel = rIdx >= 0 ? `Restart ${rIdx + 1} of ${restartIds.length}` : undefined;
    const sub = before ? 'Done before the restart' : rs?.state === 'not_run' ? 'Didn’t run' : rs?.state === 'failed' ? 'Didn’t finish' : rs?.state === 'done' && !restartLabel ? 'Done' : restartLabel ?? s.targetSummary;
    return { id: s.id, title: s.title, sub, state, step: s, restartLabel };
  });
  items.push({
    id: 'verify', title: VERIFY_TITLE, verify: true,
    sub: plan.verification.some((v) => v.tier === 'V5') ? `${plan.verification.length} checks + a quiet watch` : `${plan.verification.length} checks`,
    state: run?.state === 'VERIFIED' ? 'done' : run?.state === 'PARTIALLY_VERIFIED' ? 'bad' : 'todo',
  });
  const waitingId = run?.state === 'WAITING_FOR_REBOOT' ? run.steps[run.stepIndex]?.id : undefined;
  if (run && isActiveRun(run.state) && !verifying && !run.queuedBehind) currentIdx = items.findIndex((it) => it.id === run.steps[run.stepIndex]?.id);
  else if (verifying || run?.state === 'VERIFIED' || run?.state === 'PARTIALLY_VERIFIED') currentIdx = items.length - 1;
  else if (run && !isActiveRun(run.state)) currentIdx = items.findIndex((it) => it.state === 'bad' || it.state === 'todo');
  else currentIdx = items.findIndex((it) => it.state === 'todo');
  if (currentIdx < 0) currentIdx = items.length - 1;
  if (items[currentIdx].state === 'todo' || items[currentIdx].id === waitingId) items[currentIdx] = { ...items[currentIdx], state: 'now' };
  const cur = items[currentIdx];

  const overlay = !!promptKey && hidden !== promptKey;
  const stopped = run?.adminPrompt === 'declined' || run?.adminPrompt === 'timeout' || run?.adminPrompt === 'untrusted';

  return (
    <Page crumbs={crumbs} actions={<span className="chip neutral">Step {currentIdx + 1} of {items.length}</span>}>
      <div className="ch-guided">
        <Card className="ch-glist" aria-labelledby="ch-g-h">
          <h1 id="ch-g-h" className="t-h2" style={{ fontSize: 18 }}>{plan.title.replace(/^Guided repair · /, '').replace(/^./, (c) => c.toUpperCase())}</h1>
          <span className="t-small c-subtle">{restartIds.length ? `${restartIds.length} restart${restartIds.length > 1 ? 's' : ''} · ` : ''}about {plan.estimatedMinutes} minutes</span>
          <ol className="ch-gsteps" aria-label="Guided steps">
            {items.map((it, i) => (
              <li key={it.id} className={it.state} aria-current={i === currentIdx ? 'step' : undefined}>
                <span className="rail" aria-hidden="true">
                  <span className="num">{it.state === 'done' ? <Icon name="check" size={14} stroke={2.4} /> : i + 1}</span>
                  <span className="line" />
                </span>
                <span className="txt">
                  <span className="ttl">{it.title}{it.restartLabel && <Icon name="restart" size={13} label="Needs a restart" />}</span>
                  <span className="t-small c-subtle">{it.sub}</span>
                  <span className="sr-only">{it.state === 'done' ? 'Done' : it.state === 'now' ? 'Current step' : it.state === 'bad' ? 'Did not finish' : 'Not started'}</span>
                </span>
              </li>
            ))}
          </ol>
        </Card>

        <div className="ch-gmain">
          {overlay && run && <AdminHandoff run={run} mode="overlay" onAllow={allow} onDecline={decline} onClose={closeOverlay} busy={!!f.deciding} />}
          {!overlay && run?.adminPrompt && <AdminHandoff run={run} mode="inline" onAllow={allow} onDecline={decline} busy={!!f.deciding} />}
          {earlier && !run && (
            <div className="ch-note ok" role="status">
              <Icon name="check" size={16} />
              <span>{doneBefore.length} step{doneBefore.length === 1 ? '' : 's'} finished before the restart and stay{doneBefore.length === 1 ? 's' : ''} in place. The rest needs your approval again.</span>
            </div>
          )}
          {!run && lastRun && !earlier && (
            <div className="ch-note neutral" role="status">
              <Icon name="history" size={16} />
              <span className="grow">The last repair for {id} ended: {journalLabel(lastRun.state)}.</span>
              <LinkButton to={`/incidents/${id}/run`} size="sm">See it</LinkButton>
            </div>
          )}
          {!stopped && <StepCard item={cur} no={currentIdx + 1} plan={plan} run={run} f={f} />}
          {!run && <ApprovalPanel a={a} runLabel="Start guided repair" notNowTo={`/incidents/${id}`} backTo={`/incidents/${id}`} />}
          {run?.queuedBehind && run.state === 'APPROVED' && (
            <section className="card" role="status" aria-labelledby="ch-gq-h">
              <h2 id="ch-gq-h" className="t-title">Queued behind {run.queuedBehind}</h2>
              <p className="t-small c-muted">One repair at a time. Nothing has run yet.</p>
              <div className="row"><Button onClick={() => void decide(run.executionId, 'cancel')} disabled={!!f.deciding}>Cancel</Button></div>
            </section>
          )}
          {f.decideError && <ErrorState compact error={f.decideError} />}
          <Card className="ch-wayback" aria-label="Your way back">
            <span className="ch-icon ok" aria-hidden="true"><Icon name="undo" size={18} /></span>
            <span className="col grow" style={{ gap: 3 }}>
              <span className="t-title" style={{ fontSize: 14 }}>Your way back</span>
              <span className="t-small c-muted">A restore point comes first and the old driver package is kept for undo. If the screen stays black, hold the power button for 10 s — you’ll be offered undo on the next start.</span>
            </span>
          </Card>
        </div>
      </div>
    </Page>
  );
}

function StepCard({ item, no, plan, run, f }: { item: Item; no: number; plan: Plan; run: RunProgress | null; f: ReturnType<typeof useRunFollow> }) {
  const c = item.verify ? VERIFY_COPY : item.step ? copyFor(item.step) : VERIFY_COPY;
  const check = item.verify ? plan.verification.map((v) => v.label).join(' · ') : item.step?.preconditions.join(' · ') || 'That nothing changed since you approved.';
  const waitingRestart = run?.state === 'WAITING_FOR_REBOOT' && run.steps[run.stepIndex]?.id === item.id;
  const rs = run?.steps.find((x) => x.id === item.id);
  const [later, setLater] = useState(false);

  const restartNow = async () => {
    if (!run) return;
    const r = await f.decide(run.executionId, 'restart-now');
    // Demo: the browser reload stands in for the restart; the app boots into Resume (screen 11).
    if (r.ok) window.location.reload();
  };
  const postpone = async () => { if (run && (await f.decide(run.executionId, 'later')).ok) setLater(true); };

  let status: ReactNode = null;
  if (waitingRestart) {
    status = (
      <div className="ch-note warn" role="status">
        <Icon name="check" size={16} />
        <span><strong>Progress saved — the journal is WAITING_FOR_REBOOT</strong><br />Nothing else runs until you restart and approve again.</span>
      </div>
    );
  } else if (rs?.state === 'running') {
    status = <p className="row c-accent" role="status" style={{ gap: 10 }}><Spinner label="Working" />Working on it…</p>;
  } else if (item.verify && run && ['EXECUTED', 'VERIFYING', 'VERIFIED', 'PARTIALLY_VERIFIED'].includes(run.state)) {
    status = (
      <>
      {(run.state === 'VERIFIED' || run.state === 'PARTIALLY_VERIFIED') && (
        <div className={`ch-note ${run.state === 'VERIFIED' ? 'ok' : 'warn'}`} role="status">
          <Icon name={run.state === 'VERIFIED' ? 'check' : 'alert'} size={16} />
          <span className="grow">{run.state === 'VERIFIED' ? 'Fixed and verified — every check passed.' : 'Partly fixed — not every check passed, so it isn’t marked fixed.'}</span>
          <LinkButton to={`/incidents/${run.incidentId}${run.state === 'VERIFIED' ? '/run' : ''}`} size="sm">{run.state === 'VERIFIED' ? 'See details' : 'See what we learned'}</LinkButton>
        </div>
      )}
      <ul className="ch-final" aria-label="Verification checks" aria-live="polite">
        {run.verification.map((v) => (
          <li key={v.id} data-check-state={v.state}>
            {v.state === 'running' ? <Spinner label="Checking" /> : <Icon name={v.state === 'pass' ? 'check' : v.state === 'fail' ? 'close' : 'clock'} size={15} className={v.state === 'pass' ? 'c-ok' : v.state === 'fail' ? 'c-danger' : 'c-subtle'} />}
            <span className="grow">{v.label}</span>
            <span className={`t-small ${v.state === 'pass' ? 'c-ok' : v.state === 'fail' ? 'c-danger' : 'c-subtle'}`}>{v.state === 'pass' ? 'Passed' : v.state === 'fail' ? 'Failed' : v.state === 'running' ? 'Checking…' : 'Waiting'}</span>
          </li>
        ))}
      </ul>
      </>
    );
  } else if (run && !isActiveRun(run.state)) {
    status = (
      <div className={`ch-note ${run.state === 'VERIFIED' ? 'ok' : 'neutral'}`} role="status">
        <Icon name={run.state === 'VERIFIED' ? 'check' : 'info'} size={16} />
        <span className="grow">{run.state === 'VERIFIED' ? 'Fixed and verified — every check passed.' : run.error?.headline ?? `The repair ended: ${journalLabel(run.state)}.`}</span>
        <LinkButton to={`/incidents/${run.incidentId}/run`} size="sm">See details</LinkButton>
      </div>
    );
  }

  return (
    <section className="card ch-gcard" aria-labelledby="ch-gcard-h">
      <div className="row gap-4">
        <span className={`ch-icon lg ${c.kind === 'Restart' ? 'warn' : c.kind === 'Verify' ? 'ok' : ''}`} aria-hidden="true"><Icon name={KIND_ICON[c.kind]} size={24} /></span>
        <div className="col" style={{ gap: 4 }}>
          <span className="kind">Step {no} · {item.restartLabel ?? c.kind}</span>
          <h2 id="ch-gcard-h" className="t-h1">{item.title}</h2>
        </div>
        {rs?.state === 'done' && !waitingRestart && <StatusChip status="ok" label="Done" />}
      </div>
      <p className="body">{c.body}</p>
      <div className="ch-gfacts">
        <div><span className="k"><Icon name="eye" size={14} />What you’ll see</span><span className="v">{c.see}</span></div>
        <div><span className="k"><Icon name="shieldCheck" size={14} />What we check first</span><span className="v">{check}</span></div>
      </div>
      {c.kind === 'Restart' && (
        <div className="ch-note warn">
          <Icon name="alert" size={16} />
          <span>Save your work first. Environment Doctor reopens after the restart and picks up at the next step. Your approval ends at restart — you’ll confirm again before anything else changes.</span>
        </div>
      )}
      {rs?.exitInfo && <p className="t-small c-muted">Exit info: {rs.exitInfo} <span className="c-subtle">— information, not proof it worked</span></p>}
      {status}
      {later && <p className="t-small c-muted" role="status">Restart postponed. The journal stays saved until you restart.</p>}
      {waitingRestart && (
        <div className="row gap-3">
          <Button variant="primary" size="lg" icon="restart" onClick={restartNow} disabled={!!f.deciding}>{f.deciding === 'restart-now' ? 'Restarting…' : c.cta ?? 'Restart now'}</Button>
          <Button size="lg" onClick={postpone} disabled={!!f.deciding}>Later</Button>
        </div>
      )}
    </section>
  );
}
