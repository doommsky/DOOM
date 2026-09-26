/**
 * Board 07 · Running & verifying, and board 15 · PC changed mid-repair — /incidents/:id/run
 * Journal state, steps, verification checks and activity follow run.progress live.
 * “Verified” appears only when the journal says VERIFIED (every contract check passed); an exit code is information.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Plan, RunProgress } from '../../shared/contracts';
import { useApp } from '../AppContext';
import { AdminHandoff } from '../components/AdminHandoff';
import { Icon } from '../components/Icon';
import { Page } from '../components/Shell';
import { Button, Card, EmptyState, ErrorState, LinkButton, LoadingState, ProgressRing, RadioCard, Spinner, StatusChip, clock, journalLabel } from '../components/ui';
import { ask, isActiveRun } from './change/api';
import { useRunFollow, type RunFollow } from './change/useRunFollow';
import '../styles/change.css';

export default function Run() {
  const { id = '' } = useParams();
  const f = useRunFollow(id);
  const { run } = f;
  const [plan, setPlan] = useState<Plan | null>(null);
  useEffect(() => {
    if (!run?.planId || plan?.id === run.planId) return;
    void ask('plan.get', { id: run.planId }).then((r) => { if (r.ok) setPlan(r.data); });
  }, [run?.planId, plan?.id]);

  const crumbs = [{ label: 'Incidents', to: '/incidents' }, { label: id, to: `/incidents/${id}` }, { label: 'Running the fix' }];

  if (!f.loaded) return <Page crumbs={crumbs}><LoadingState label="Loading the repair…" /></Page>;
  if (f.loadError) return <Page crumbs={crumbs}><ErrorState error={f.loadError} onRetry={f.load} /></Page>;
  if (!run) {
    return (
      <Page crumbs={crumbs}>
        <EmptyState
          icon="wrench" title="No repair has run for this incident yet"
          body="Every change starts from a plan you review and approve."
          action={<div className="row gap-3"><LinkButton to={`/incidents/${id}`}>Back to the incident</LinkButton><LinkButton to={`/incidents/${id}/plan`} variant="primary">See the plan</LinkButton></div>}
        />
      </Page>
    );
  }
  if (run.queuedBehind && run.state === 'APPROVED') return <Queued run={run} f={f} crumbs={crumbs} />;
  if (run.state === 'BLOCKED' && run.drift.length > 0) return <Drift run={run} f={f} plan={plan} crumbs={crumbs} />;
  return <Execute run={run} f={f} plan={plan} crumbs={crumbs} />;
}

type Follow = RunFollow;
type Crumbs = { label: string; to?: string }[];

/* ───────────────────────────── board 07 ───────────────────────────── */

function Execute({ run, f, plan, crumbs }: { run: RunProgress; f: Follow; plan: Plan | null; crumbs: Crumbs }) {
  const { lock } = useApp();
  const [hidden, setHidden] = useState<string | null>(null);
  const promptKey = run.adminPrompt ? `${run.executionId}:${run.adminPrompt}` : null;
  const overlay = !!promptKey && hidden !== promptKey;
  const closeOverlay = useCallback(() => setHidden(promptKey), [promptKey]);
  const { decide } = f;
  const allow = useCallback(() => { void decide(run.executionId, 'admin-allow'); }, [decide, run.executionId]);
  const decline = useCallback(() => { void decide(run.executionId, 'admin-decline'); }, [decide, run.executionId]);
  const holdsLock = !!lock?.held && lock.executionId === run.executionId;
  const stopped = run.adminPrompt === 'untrusted' || run.adminPrompt === 'declined' || run.adminPrompt === 'timeout';

  const actions = holdsLock ? <><span className="chip accent"><Icon name="lock" size={12} />Lock held</span><span className="chip neutral">Updates paused</span></> : undefined;

  return (
    <Page crumbs={crumbs} actions={actions} split aside={<Aside run={run} holdsLock={holdsLock} />}>
      <main id="main" className="col" style={{ gap: 18 }}>
        {overlay && <AdminHandoff run={run} mode="overlay" onAllow={allow} onDecline={decline} onClose={closeOverlay} busy={!!f.deciding} />}
        {stopped && !overlay && <AdminHandoff run={run} mode="inline" onAllow={allow} onDecline={decline} busy={!!f.deciding} />}
        {!stopped && <Hero run={run} f={f} />}
        {run.adminPrompt === 'waiting' && !overlay && <AdminHandoff run={run} mode="inline" onAllow={allow} onDecline={decline} busy={!!f.deciding} />}
        {run.state === 'WAITING_FOR_REBOOT' && <RestartCard run={run} f={f} />}
        {f.decideError && <ErrorState compact error={f.decideError} />}
        <Outcome run={run} />
        <Steps run={run} plan={plan} />
        {!stopped && <Checks run={run} />}
      </main>
    </Page>
  );
}

function progressOf(run: RunProgress) {
  const total = run.verification.length;
  const passed = run.verification.filter((v) => v.state === 'pass').length;
  const done = run.steps.filter((s) => s.state === 'done').length;
  const verifying = ['EXECUTED', 'VERIFYING', 'VERIFIED', 'PARTIALLY_VERIFIED'].includes(run.state);
  return { total, passed, done, verifying };
}

function Hero({ run, f }: { run: RunProgress; f: Follow }) {
  const { total, passed, done, verifying } = progressOf(run);
  const n = run.steps.length;
  const cur = run.steps[run.stepIndex];
  let h = 'Getting ready';
  let sub = 'Running the final check before the first step. Nothing has changed yet.';
  let tone = '';
  switch (run.state) {
    case 'EXECUTING': h = `Running step ${run.stepIndex + 1} of ${n}`; sub = `${cur?.title ?? ''}. Each step is re-checked right before it runs.`; break;
    case 'EXECUTED': case 'VERIFYING': h = 'Checking that it worked'; sub = `${n === 2 ? 'Both steps' : n === 1 ? 'The step' : 'All steps'} ran. It only counts as fixed once every check below passes.`; break;
    case 'VERIFIED': h = 'Fixed and verified'; sub = `Every check passed.${run.watch ? ` ${run.watch.label}.` : ''}`; tone = 'ok'; break;
    case 'PARTIALLY_VERIFIED': h = 'Partly fixed'; sub = run.error?.didNotHappen ?? 'Not every check passed, so this isn’t marked fixed.'; tone = 'warn'; break;
    case 'WAITING_FOR_REBOOT': h = 'Paused for a restart'; sub = 'Progress is saved. Nothing else runs until you restart and approve again.'; tone = 'warn'; break;
    case 'FAILED': h = 'The repair stopped'; sub = 'A step didn’t finish, so later steps didn’t run.'; tone = 'warn'; break;
    case 'BLOCKED': h = 'The repair stopped'; sub = 'A safety check stopped it before the next step.'; tone = 'warn'; break;
    case 'CANCELLED': h = 'Cancelled — nothing more ran'; sub = 'The incident stays open. You can build a new plan whenever you’re ready.'; break;
    case 'RECOVERY_REQUIRED': h = 'The repair was interrupted'; sub = 'We re-check your PC before anything else happens.'; tone = 'warn'; break;
    default: break;
  }
  if (run.adminPrompt === 'waiting') { h = 'Waiting for Windows permission'; sub = 'Nothing more changes until you answer the Windows prompt.'; }
  const value = verifying ? (total ? (passed / total) * 100 : 0) : n ? (done / n) * 100 : 0;
  const ringColor = run.state === 'VERIFIED' ? 'var(--ok)' : run.state === 'PARTIALLY_VERIFIED' ? 'var(--warn)' : 'var(--accent)';
  return (
    <section className={`card ch-hero ${tone}`} aria-labelledby="ch-run-h">
      <ProgressRing value={value} size={124} stroke={8} color={ringColor} label={verifying ? 'Verification checks passed' : 'Steps done'}>
        <span className="ch-ring-label">
          <span className="big">{verifying ? `${passed}/${total}` : `${done}/${n}`}</span>
          <span className="small">{verifying ? 'checks passed' : 'steps done'}</span>
        </span>
      </ProgressRing>
      <div className="col grow" style={{ gap: 14 }}>
        <div className="row between start gap-4">
          <div className="col" style={{ gap: 6 }}>
            <div className="row wrap" style={{ gap: 10 }}>
              <h1 id="ch-run-h" className="t-h1">{h}</h1>
              {run.state === 'VERIFIED' && <StatusChip status="ok" label="Verified" />}
            </div>
            <p className="c-muted" style={{ fontSize: 14 }}>{sub}</p>
          </div>
          <div className="row gap-3">
            {run.state === 'VERIFIED' && <LinkButton to={`/incidents/${run.incidentId}`} variant="success" icon="check">Back to the incident</LinkButton>}
            {run.state === 'PARTIALLY_VERIFIED' && <LinkButton to={`/incidents/${run.incidentId}`} variant="primary" icon="arrowRight">See what we learned</LinkButton>}
            {run.state === 'CANCELLED' && <LinkButton to={`/incidents/${run.incidentId}`}>Back to the incident</LinkButton>}
          </div>
        </div>
        <JournalPills run={run} />
        <span className="ch-jstate">Journal: {journalLabel(run.state)} <code>{run.state}</code></span>
      </div>
      {f.deciding && <span className="sr-only" role="status">Sending your answer…</span>}
    </section>
  );
}

function JournalPills({ run }: { run: RunProgress }) {
  const n = run.steps.length;
  const done = run.steps.filter((s) => s.state === 'done').length;
  const steps = done === n ? (n === 2 ? 'Both steps ran' : n === 1 ? 'Step ran' : 'All steps ran') : `Step ${Math.min(done + 1, n)} of ${n}`;
  const stepsState = done === n ? 'done' : ['EXECUTING', 'WAITING_FOR_REBOOT'].includes(run.state) ? 'now' : run.steps.some((s) => s.state === 'failed' || s.state === 'not_run') ? 'bad' : '';
  const ver = run.state === 'VERIFIED' ? ['Verified', 'done'] : run.state === 'PARTIALLY_VERIFIED' ? ['Partly verified', 'warn'] : run.state === 'VERIFYING' || run.state === 'EXECUTED' ? ['Verifying', 'now'] : ['Verify', ''];
  const pills: [string, string][] = [
    ['Approved', 'done'],
    ['Final check', run.state === 'APPROVED' ? '' : run.state === 'PRECONDITION_CHECK' ? 'now' : 'done'],
    [steps, stepsState],
    [ver[0], ver[1]],
  ];
  return (
    <ol className="ch-journal" aria-label="Journal">
      {pills.map(([label, cls], i) => (
        <li key={i} className="row" style={{ gap: 8 }}>
          <span className={`pill ${cls}`}>{cls === 'done' && <Icon name="check" size={12} />}{cls === 'now' && <Spinner label={label} />}{cls === 'bad' && <Icon name="stop" size={12} />}{label}</span>
          {i < pills.length - 1 && <span className="sep" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

function RestartCard({ run, f }: { run: RunProgress; f: Follow }) {
  const [later, setLater] = useState(false);
  const restartNow = async () => {
    const r = await f.decide(run.executionId, 'restart-now');
    // Demo: the browser reload stands in for the restart; the app boots into Resume (screen 11).
    if (r.ok) window.location.reload();
  };
  const postpone = async () => { const r = await f.decide(run.executionId, 'later'); if (r.ok) setLater(true); };
  return (
    <section className="card warn" aria-labelledby="ch-restart-h">
      <div className="row start gap-4">
        <span className="ch-icon warn lg" aria-hidden="true"><Icon name="restart" size={22} /></span>
        <div className="col" style={{ gap: 4 }}>
          <h2 id="ch-restart-h" className="t-h2">Restart needed to continue</h2>
          <p className="t-small c-text2">Progress saved — the journal is <code className="mono">WAITING_FOR_REBOOT</code></p>
        </div>
      </div>
      <p className="c-text2" style={{ fontSize: 13.5 }}>Save your work first. After the restart Environment Doctor re-checks your PC and asks you again before anything else changes — your approval ends with the restart.</p>
      {later && <p className="t-small c-muted" role="status">Restart postponed. The journal stays saved until you restart.</p>}
      <div className="row gap-3">
        <Button variant="primary" size="lg" icon="restart" onClick={restartNow} disabled={!!f.deciding}>{f.deciding === 'restart-now' ? 'Restarting…' : 'Restart now'}</Button>
        <Button size="lg" onClick={postpone} disabled={!!f.deciding}>Later</Button>
      </div>
    </section>
  );
}

/** Terminal outcomes other than verified: the error pattern (what happened · what didn’t · one next step). */
function Outcome({ run }: { run: RunProgress }) {
  const nav = useNavigate();
  if (run.adminPrompt) return null;
  if ((run.state === 'FAILED' || run.state === 'BLOCKED' || run.state === 'RECOVERY_REQUIRED') && run.error) {
    const to = run.state === 'RECOVERY_REQUIRED' ? '/recovery' : `/incidents/${run.incidentId}`;
    return <ErrorState error={run.error} onRetry={() => nav(to)} retryLabel={run.error.nextStep ?? 'Back to the incident'} />;
  }
  return null;
}

const STEP_STATE: Record<RunProgress['steps'][number]['state'], { label: string; tone: string; icon: 'check' | 'close' | 'clock' | 'stop' | 'arrowRight' }> = {
  pending: { label: 'Waiting', tone: '', icon: 'clock' },
  running: { label: 'Running', tone: 'accent', icon: 'arrowRight' },
  done: { label: 'Done', tone: 'ok', icon: 'check' },
  failed: { label: 'Failed', tone: 'fail', icon: 'close' },
  skipped: { label: 'Skipped', tone: '', icon: 'arrowRight' },
  not_run: { label: 'Did not run', tone: 'warn', icon: 'stop' },
};

function Steps({ run, plan }: { run: RunProgress; plan: Plan | null }) {
  return (
    <section className="card" aria-labelledby="ch-steps-run-h">
      <div className="card-head">
        <h2 id="ch-steps-run-h" className="t-title">Steps</h2>
        <span className="t-small c-subtle">{run.executionId}</span>
      </div>
      <ol className="ch-rows" aria-label="Steps">
        {run.steps.map((s, i) => {
          // A step still “pending” in a run that has ended will never run — say so (never “waiting”).
          const st = STEP_STATE[s.state === 'pending' && !isActiveRun(run.state) ? 'not_run' : s.state];
          const ps = plan?.steps.find((x) => x.id === s.id);
          return (
            <li key={s.id} data-state={s.state} className={s.state === 'running' ? 'now' : ''}>
              <span className={`ch-rowicon ${st.tone}`} aria-hidden="true">{s.state === 'running' ? <Spinner label="Running" /> : <span className="mono" style={{ fontSize: 13 }}>{i + 1}</span>}</span>
              <span className="col grow" style={{ gap: 2 }}>
                <span style={{ fontSize: 14 }}>{s.title}</span>
                {ps && <span className="mono t-small c-subtle">{ps.targetSummary}</span>}
                {s.exitInfo && <span className="t-small c-muted">Exit info: {s.exitInfo} <span className="c-subtle">— information, not proof it worked</span></span>}
              </span>
              <span className={`ch-rowstate ${st.tone === 'ok' ? 'c-ok' : st.tone === 'fail' ? 'c-danger' : st.tone === 'warn' ? 'c-warn' : st.tone === 'accent' ? 'c-accent' : 'c-subtle'}`}>
                <Icon name={st.icon} size={13} />{st.label}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Checks({ run }: { run: RunProgress }) {
  const allRan = run.steps.length > 0 && run.steps.every((s) => s.state === 'done');
  return (
    <section className="card" aria-labelledby="ch-checks-h">
      <div className="card-head">
        <h2 id="ch-checks-h" className="t-title">Verification checks</h2>
        <span className="t-small c-subtle row" style={{ gap: 6 }}><Icon name="shield" size={13} />Run without the AI</span>
      </div>
      <ol className="ch-rows" aria-label="Verification checks">
        {allRan && (
          <li data-kind="info">
            <span className="ch-rowicon" aria-hidden="true"><Icon name="info" size={16} /></span>
            <span className="col grow" style={{ gap: 2 }}>
              <span className="c-muted" style={{ fontSize: 14 }}>Every step reported it finished</span>
              <span className="t-small c-subtle">Noted — but that alone never counts as fixed</span>
            </span>
            <span className="ch-rowstate c-subtle">Info</span>
          </li>
        )}
        {run.verification.map((v) => (
          <li key={v.id} data-check-state={v.state} className={v.state === 'running' ? 'now' : ''}>
            <span className={`ch-rowicon ${v.state === 'pass' ? 'ok' : v.state === 'fail' ? 'fail' : v.state === 'running' ? 'accent' : ''}`} aria-hidden="true">
              {v.state === 'running' ? <Spinner label="Checking" /> : <Icon name={v.state === 'pass' ? 'check' : v.state === 'fail' ? 'close' : 'clock'} size={16} />}
            </span>
            <span className="col grow" style={{ gap: 2 }}>
              <span style={{ fontSize: 14 }}>{v.label}</span>
              <span className="t-small c-subtle"><span className="mono">{v.tier}</span>{v.detail && v.state === 'fail' ? ` · ${v.detail}` : ''}</span>
            </span>
            <span className={`ch-rowstate ${v.state === 'pass' ? 'c-ok' : v.state === 'fail' ? 'c-danger' : v.state === 'running' ? 'c-accent' : 'c-subtle'}`}>
              {v.state === 'pass' ? 'Passed' : v.state === 'fail' ? 'Failed' : v.state === 'running' ? 'Checking…' : 'Waiting'}
            </span>
          </li>
        ))}
        <li data-kind="watch">
          <span className={`ch-rowicon ${run.watch ? 'accent' : 'dashed'}`} aria-hidden="true"><Icon name="eye" size={16} /></span>
          <span className="col grow" style={{ gap: 2 }}>
            <span className={run.watch ? '' : 'c-muted'} style={{ fontSize: 14 }}>Still fine later</span>
            <span className="t-small c-subtle">{run.watch ? `${run.watch.label} · until ${new Date(run.watch.until).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : 'A quiet re-check starts once it’s verified — no action needed from you'}</span>
          </span>
          <span className="ch-rowstate c-subtle">{run.watch ? 'Watching' : 'Later'}</span>
        </li>
      </ol>
    </section>
  );
}

function Aside({ run, holdsLock }: { run: RunProgress; holdsLock: boolean }) {
  const drift = run.drift.length > 0;
  return (
    <>
      <section className="card" aria-labelledby="ch-watch-h">
        <div className="card-head">
          <h2 id="ch-watch-h" className="t-title">Watching for changes</h2>
          {drift ? <StatusChip status="fail" label="Changed" /> : <StatusChip status="ok" label="Stable" />}
        </div>
        <div className="col" style={{ gap: 0 }}>
          <div className="ch-watch"><span>Your PC vs. what you approved</span><span>compared before every step</span></div>
          <div className="ch-watch"><span>Repair lock</span><span>{holdsLock ? 'held — one repair at a time' : 'released'}</span></div>
          <div className="ch-watch"><span>App updates</span><span>{holdsLock ? 'paused until done' : 'allowed'}</span></div>
          {run.watch && <div className="ch-watch"><span>After the fix</span><span>{run.watch.label}</span></div>}
        </div>
      </section>
      <Activity run={run} />
    </>
  );
}

function Activity({ run }: { run: RunProgress }) {
  return (
    <section className="card inset" aria-labelledby="ch-activity-h" style={{ flex: '1 1 auto' }}>
      <div className="card-head">
        <h2 id="ch-activity-h" className="t-title">Activity</h2>
        <Link to="/history" className="t-small" style={{ textDecoration: 'none' }}>Full history</Link>
      </div>
      <ol className="ch-feed" role="log" aria-live="polite" aria-label="Activity">
        {run.activity.length === 0 && <li className="c-subtle">Nothing yet.</li>}
        {run.activity.map((a, i) => (
          <li key={i}>
            <time dateTime={a.at}>{clock(a.at)}</time>
            <span className={`dot ${a.kind === 'ok' ? 'ok' : a.kind === 'warn' ? 'warn' : a.kind === 'error' ? 'fail' : 'neutral'}`} aria-hidden="true" />
            <span className="txt">{a.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ───────────────────────────── queued (E_MUTATION_BUSY) ───────────────────────────── */

function Queued({ run, f, crumbs }: { run: RunProgress; f: Follow; crumbs: Crumbs }) {
  const behind = run.queuedBehind!;
  return (
    <Page crumbs={crumbs} split aside={<Activity run={run} />}>
      <main id="main" className="col" style={{ gap: 18 }}>
        <section className="card ch-queued" role="status" aria-labelledby="ch-queued-h">
          <div className="row start gap-4">
            <span className="ch-icon neutral lg" aria-hidden="true"><Icon name="clock" size={22} /></span>
            <div className="col" style={{ gap: 6 }}>
              <span className="t-overline">Waiting its turn</span>
              <h1 id="ch-queued-h" className="t-h1">Queued behind {behind}</h1>
              <p className="c-muted" style={{ fontSize: 14 }}>
                One repair at a time. Your approved plan waits until the repair on <Link to={`/incidents/${behind}`}>{behind}</Link> is finished. Nothing has run yet.
              </p>
            </div>
          </div>
          <div className="row gap-3">
            <Button onClick={() => void f.decide(run.executionId, 'cancel')} disabled={!!f.deciding} icon="close">{f.deciding === 'cancel' ? 'Cancelling…' : 'Cancel'}</Button>
            <LinkButton to={`/incidents/${behind}`} variant="ghost">See {behind}</LinkButton>
          </div>
        </section>
        {f.decideError && <ErrorState compact error={f.decideError} />}
        <Steps run={run} plan={null} />
      </main>
    </Page>
  );
}

/* ───────────────────────────── board 15 · drift ───────────────────────────── */

function Drift({ run, f, plan, crumbs }: { run: RunProgress; f: Follow; plan: Plan | null; crumbs: Crumbs }) {
  const nav = useNavigate();
  const doneSteps = run.steps.map((s, i) => ({ ...s, n: i + 1 })).filter((s) => s.state === 'done');
  const [choice, setChoice] = useState<'relook' | 'keep' | 'undo'>('relook');
  const CTA = { relook: 'Look again & re-plan', keep: 'Close as partially fixed', undo: 'Build undo plan' } as const;
  const confirm = async () => {
    if (choice === 'undo') {
      await f.decide(run.executionId, 'undo');
      nav(`/incidents/${run.incidentId}/plan?variant=undo`);
      return;
    }
    const r = await f.decide(run.executionId, choice);
    if (r.ok) nav(`/incidents/${run.incidentId}`);
  };
  const aside = (
    <section className="card accent" aria-labelledby="ch-next-h" style={{ gap: 14 }}>
      <h2 id="ch-next-h" className="t-h2">What should happen next?</h2>
      <p className="t-small c-muted">The old diagnosis is out of date. Pick one — nothing runs until you confirm.</p>
      <div role="radiogroup" aria-label="Next step" className="col" style={{ gap: 10 }}>
        <RadioCard checked={choice === 'relook'} onSelect={() => setChoice('relook')} recommended title="Look again & re-plan" body={`Fresh evidence, new diagnosis, new plan for you to approve.${doneSteps.length ? ' Completed steps stay.' : ''}`} />
        <RadioCard checked={choice === 'keep'} onSelect={() => setChoice('keep')} title="Close as partially fixed" body="Keeps what already ran and marks the incident partly fixed. The change on your PC stays as it is." />
        {doneSteps.length > 0 && <RadioCard checked={choice === 'undo'} onSelect={() => setChoice('undo')} title="Build undo plan" body={`Builds a plan that reverses ${doneSteps.length === 1 ? `step ${doneSteps[0].n}` : 'the completed steps'}. It needs its own approval${plan?.requiresAdmin ? ' and admin prompt' : ''}.`} />}
      </div>
      {f.decideError && <ErrorState compact error={f.decideError} />}
      <Button variant="primary" size="lg" className="ch-full" onClick={confirm} disabled={!!f.deciding}>{f.deciding ? 'Working…' : CTA[choice]}</Button>
      <span className="t-small c-subtle" style={{ textAlign: 'center' }}>Nothing runs until you confirm</span>
    </section>
  );
  return (
    <Page crumbs={crumbs} actions={<span className="chip neutral"><Icon name="lock" size={12} />Paused while you decide</span>} split aside={aside}>
      <main id="main" className="col" style={{ gap: 18 }}>
        <section className="card ch-drift-head" role="alert" aria-labelledby="ch-drift-h">
          <div className="row start gap-4">
            <span className="ch-icon danger lg" aria-hidden="true"><Icon name="alert" size={22} /></span>
            <div className="col" style={{ gap: 8 }}>
              <h1 id="ch-drift-h" className="t-h1">Paused — your PC changed mid-repair</h1>
              <p className="c-text2" style={{ fontSize: 14, lineHeight: 1.6 }}>
                Something changed on your PC while we were working, so we stopped <strong>before</strong> the next step ran.
                {' '}<strong>The approval was cancelled</strong> and nothing more will change until you choose.
              </p>
            </div>
          </div>
          <div className="ch-notrun">
            <Icon name="stop" size={16} className="c-warn" />
            <span className="grow"><span className="c-muted">Did not run: </span><strong>{run.notRunStep ?? 'the next step'}</strong></span>
            <StatusChip status="warn" label="Not run" />
          </div>
          <ol className="ch-journal" aria-label="Journal">
            <li className="row" style={{ gap: 8 }}><span className="pill done"><Icon name="check" size={12} />Approved · final check</span><span className="sep" aria-hidden="true" /></li>
            {doneSteps.map((s) => <li key={s.id} className="row" style={{ gap: 8 }}><span className="pill done"><Icon name="check" size={12} />Step {s.n} done</span><span className="sep" aria-hidden="true" /></li>)}
            <li><span className="pill bad"><Icon name="stop" size={12} />{run.notRunStep?.split(' · ')[0] ?? 'Next step'} did not run</span></li>
          </ol>
        </section>

        <section className="card" aria-labelledby="ch-changed-h">
          <div className="card-head">
            <h2 id="ch-changed-h" className="t-title">What changed</h2>
            <span className="t-small c-subtle">At approval → now</span>
          </div>
          <table className="table">
            <thead><tr><th scope="col">What</th><th scope="col">At approval</th><th scope="col">Now</th><th scope="col">Likely source</th></tr></thead>
            <tbody>
              {run.drift.map((d) => (
                <tr key={d.id}>
                  <th scope="row" style={{ textAlign: 'left', fontWeight: 500 }}>{d.what}</th>
                  <td className="mono c-muted">{d.before}</td>
                  <td className="mono c-warn">{d.after}</td>
                  <td className="t-small c-text2">{d.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div className="grid-2">
          <Card className="inset">
            <span className="t-overline">What this means</span>
            <p className="t-small c-text2">The plan was built for how your PC looked when you approved it. Running the next step now could undo or break the new change, so the plan needs a fresh look first.</p>
          </Card>
          <Card className="inset">
            <span className="t-overline">Steps</span>
            <ul className="col" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 4 }}>
              {run.steps.map((s, i) => (
                <li key={s.id} className="row t-small" style={{ gap: 8 }}>
                  <Icon name={s.state === 'done' ? 'check' : 'stop'} size={13} className={s.state === 'done' ? 'c-ok' : 'c-warn'} />
                  <span className="grow">Step {i + 1} · {s.title}</span>
                  <span className={s.state === 'done' ? 'c-ok' : 'c-warn'}>{STEP_STATE[s.state].label}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </main>
    </Page>
  );
}
