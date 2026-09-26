/**
 * Board 11 · Resume after restart — /recovery (full bleed, shown before any other screen while a journal is open).
 * UI safety rule 4: a restart ends the approval. We re-verify the real state first; every button stays disabled
 * until the re-checks are done (AC-20), and continuing always goes through a fresh approval.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ApiError, Plan, RecoveryJournal } from '../../shared/contracts';
import { useApp } from '../AppContext';
import { Icon } from '../components/Icon';
import { Button, ErrorState, LoadingState, Spinner, clock } from '../components/ui';
import { usePrefersReducedMotion } from '../hooks/useApi';
import { ask, wait } from './change/api';
import '../styles/change.css';

type Row = RecoveryJournal['rechecks'][number];

export default function Resume() {
  const nav = useNavigate();
  const { clearRecovery, refresh } = useApp();
  const reduced = usePrefersReducedMotion();
  const [journal, setJournal] = useState<RecoveryJournal | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [phase, setPhase] = useState<'loading' | 'checking' | 'done' | 'error'>('loading');
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState<null | 'continue' | 'stop'>(null);
  const [resolveError, setResolveError] = useState<ApiError | null>(null);
  const started = useRef(false);
  const mounted = useRef(true);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const reasonId = useId();
  const ackId = useId();

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const recheck = async () => {
    setPhase('checking');
    setError(null);
    setRows([]);
    // Show real progress while the orchestrator re-checks (each read is a fresh snapshot).
    let seen: Row[] = [];
    const poll = setInterval(() => {
      void ask('recovery.get', undefined).then((g) => {
        if (!mounted.current || !g.ok || !g.data || !g.data.rechecks.length) return;
        seen = g.data.rechecks;
        setRows(seen);
      });
    }, 120);
    const r = await ask('recovery.recheck', undefined);
    clearInterval(poll);
    if (!mounted.current) return;
    if (!r.ok) { setError(r.error); setPhase('error'); return; }
    setJournal(r.data);
    // Reveal the finished list row by row (pending → running → pass) from wherever the live view got to.
    const final = r.data.rechecks;
    let from = 0;
    while (from < final.length && seen[from]?.state === 'pass' && seen[from]?.label === final[from].label) from++;
    const step = reducedRef.current ? 0 : 160;
    for (let i = from; i < final.length; i++) {
      setRows(final.map((x, k) => (k < i ? x : k === i ? { ...x, state: 'running' } : { ...x, state: 'pending' })));
      await wait(step);
      if (!mounted.current) return;
    }
    setRows(final);
    setPhase('done');
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const g = await ask('recovery.get', undefined);
      if (!mounted.current) return;
      if (!g.ok) { setError(g.error); setPhase('error'); return; }
      if (!g.data) { clearRecovery(); nav('/', { replace: true }); return; }
      setJournal(g.data);
      void ask('plan.get', { id: g.data.planId }).then((p) => { if (mounted.current && p.ok) setPlan(p.data); });
      await recheck();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolve = async (decision: 'continue' | 'stop') => {
    setBusy(decision);
    setResolveError(null);
    const r = await ask('recovery.resolve', { decision });
    if (!mounted.current) return;
    setBusy(null);
    if (!r.ok) { setResolveError(r.error); return; }
    clearRecovery();
    void refresh();
    const { incidentId, planId } = r.data;
    if (decision === 'continue' && planId) nav(`/incidents/${incidentId}/plan?planId=${encodeURIComponent(planId)}${plan?.kind === 'guided' ? '&variant=resume' : ''}`, { replace: true });
    else nav(`/incidents/${incidentId}`, { replace: true });
  };

  if (phase === 'loading' && !journal) return <div className="fullbleed"><LoadingState label="Checking for an unfinished repair…" /></div>;

  const title = (sid: string) => plan?.steps.find((s) => s.id === sid)?.title ?? sid;
  const numbered = (sid: string) => {
    const i = plan ? plan.steps.filter((s) => !s.removedReason).findIndex((s) => s.id === sid) : -1;
    return i >= 0 ? `Step ${i + 1} · ${title(sid)}` : title(sid);
  };
  const j = journal!;
  const total = j.completedSteps.length + j.pendingSteps.length + j.unknownSteps.length;
  const done = phase === 'done';
  const allPass = done && rows.length > 0 && rows.every((r) => r.state === 'pass');
  const nextStep = j.pendingSteps[0];
  const safeMode = !!plan && j.completedSteps.some((sid) => /safe mode/i.test(title(sid)));
  const contReason = !done ? 'Waiting for the re-checks to finish.' : !allPass ? 'A re-check didn’t pass, so this repair can’t continue.' : !j.pendingSteps.length ? null : !ack ? 'Tick the box above to continue.' : null;

  return (
    <div className="fullbleed" style={{ paddingTop: safeMode ? 72 : 40 }}>
      {safeMode && <div className="ch-safemode" role="status"><Icon name="info" size={15} />Windows is in Safe Mode — low resolution and no internet is normal right now</div>}
      <div className="ch-resume">
        <main id="main" className="card main" aria-labelledby="ch-resume-h">
          <div className="row gap-4">
            <span className="ch-icon lg" aria-hidden="true"><Icon name="restart" size={24} /></span>
            <div className="col" style={{ gap: 4 }}>
              <span className="t-overline" style={{ color: 'var(--muted)', fontSize: 12 }}>{plan?.kind === 'guided' ? 'Guided repair' : 'Repair'} · {j.incidentId} · {j.completedSteps.length} of {total} steps done</span>
              <h1 id="ch-resume-h" className="t-h1" style={{ fontSize: 28 }}>Welcome back. Checking where we left off.</h1>
            </div>
          </div>
          <p className="c-text2" style={{ fontSize: 15, lineHeight: 1.6 }}>Before doing anything else, we look at what’s actually on your PC now — we never assume the restart went as planned.</p>
          <p className="t-small c-muted row" style={{ gap: 8 }}><Icon name="info" size={14} />{j.reason}</p>

          {phase === 'error' && error
            ? <ErrorState compact error={error} onRetry={() => void recheck()} retryLabel="Check again" />
            : (
              <ol className="ch-rechecks" aria-label="Re-checks" aria-live="polite" aria-busy={!done}>
                {rows.length === 0 && (
                  <li className="running"><span className="ic"><Spinner label="Re-checking" /></span><span className="name">Re-checking your PC…</span><span className="res">checking…</span></li>
                )}
                {rows.map((r, i) => (
                  <li key={i} className={r.state} data-state={r.state}>
                    <span className="ic">{r.state === 'running' ? <Spinner label="Checking" /> : r.state === 'pass' ? <Icon name="check" size={14} stroke={2.4} /> : r.state === 'fail' ? <Icon name="close" size={14} /> : null}</span>
                    <span className="name">{r.label}</span>
                    <span className="res">{r.state === 'pass' ? 'Passed' : r.state === 'fail' ? 'Failed' : r.state === 'running' ? 'checking…' : 'waiting'}</span>
                  </li>
                ))}
              </ol>
            )}

          <div className="ch-sumgrid" aria-label="Where the repair stands">
            <div>
              <span className="t-overline">Done before the restart</span>
              <ul>{j.completedSteps.length ? j.completedSteps.map((s) => <li key={s} className="row" style={{ gap: 6 }}><Icon name="check" size={13} className="c-ok" />{numbered(s)}</li>) : <li className="c-subtle">Nothing yet</li>}</ul>
            </div>
            <div>
              <span className="t-overline">Still to do</span>
              <ul>{j.pendingSteps.length ? j.pendingSteps.map((s) => <li key={s}>{numbered(s)}</li>) : <li className="c-subtle">Nothing left</li>}</ul>
            </div>
            {j.unknownSteps.length > 0 && (
              <div className="unknown">
                <span className="t-overline">Can’t tell yet</span>
                <ul>{j.unknownSteps.map((s) => <li key={s}>We can’t tell if {numbered(s)} ran</li>)}</ul>
              </div>
            )}
          </div>

          <div className="ch-note warn">
            <Icon name="lock" size={16} />
            <span>Your approval ended with the restart — nothing continues until you approve again.{nextStep && <> Next up: <strong>{numbered(nextStep)}</strong>.</>}</span>
          </div>

          {j.pendingSteps.length > 0 && (
            <div className={`ch-ack ${ack ? 'on' : ''}`}>
              <label className="checkbox" htmlFor={ackId}>
                <input id={ackId} type="checkbox" checked={ack} disabled={!done || !allPass} onChange={(e) => setAck(e.target.checked)} />
                <span>I’ve saved my work and I’m ready to review the next steps</span>
              </label>
            </div>
          )}
          {resolveError && <ErrorState compact error={resolveError} />}
          <div className="row gap-3 wrap">
            <Button variant="primary" size="lg" icon="arrowRight" disabled={!!contReason || !!busy} aria-describedby={contReason ? reasonId : undefined} onClick={() => void resolve('continue')}>
              {busy === 'continue' ? 'Preparing…' : j.pendingSteps.length ? 'Continue — review the next steps' : 'Finish up'}
            </Button>
            {contReason && <span id={reasonId} className="ch-reason">{contReason}</span>}
          </div>
        </main>

        <aside aria-label="Recovery details">
          <section className="card" aria-labelledby="ch-journal-h">
            <h2 id="ch-journal-h" className="t-title">Recovery journal</h2>
            <dl>
              <dt>Last saved state</dt><dd>{j.state}</dd>
              <dt>Saved at</dt><dd>{clock(j.savedAt)}</dd>
              <dt>Repair</dt><dd>{j.executionId}</dd>
              <dt>Next step</dt><dd>{nextStep ? title(nextStep) : '—'}</dd>
            </dl>
          </section>
          <section className="card" aria-labelledby="ch-out-h">
            <h2 id="ch-out-h" className="t-title">Want out instead?</h2>
            <p className="t-small c-muted">Stopping changes nothing more. Completed steps stay in place and the incident stays open.</p>
            <Button onClick={() => void resolve('stop')} disabled={!done || !!busy} icon="stop">{busy === 'stop' ? 'Stopping…' : 'Stop here'}</Button>
          </section>
        </aside>
      </div>
    </div>
  );
}
