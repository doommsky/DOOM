/** Board 09 · Freeze / crash diagnosis (PC incidents with a crash timeline). */
import { useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { EvidenceRef, Hypothesis, Incident, Plan, TimelineEvent } from '../../../shared/contracts';
import { Page } from '../../components/Shell';
import { Icon, type IconName } from '../../components/Icon';
import { Button, ConfidenceMeter, EvidenceTag, LinkButton, LoopStepper, RadioCard, Spinner } from '../../components/ui';
import {
  CheckAgainButton, CloseIncidentButton, EvidenceIds, IconBox, IncidentMeta, RunBanner, StaleNotice, VetoNote,
  incidentCrumbs, isRootCauseRestated, loopStepFor, runActive, type ViewProps,
} from './shared';
import { activeSteps, usePlanPreview } from './usePlanPreview';

const NOT_PERCENT = 'Likelihood is a label, not a calibrated percentage.';

export function CrashDiagnosis({ inc, run, reload }: ViewProps) {
  const active = runActive(run);
  const stale = !!inc.stale;
  const wantPlans = !active && !stale && inc.status !== 'blocked';
  const rollback = usePlanPreview(inc.id, wantPlans, { variant: 'rollback' });
  const clean = usePlanPreview(inc.id, wantPlans, { variant: 'clean' });
  const step = loopStepFor(inc, run, !!(rollback.plan || clean.plan));

  return (
    <Page
      crumbs={incidentCrumbs(inc.id)}
      actions={<>
        <LinkButton to={`/evidence/preview/${inc.id}`} size="sm" icon="eye">What the AI sees</LinkButton>
        <CheckAgainButton />
        {!active && <CloseIncidentButton inc={inc} onClosed={reload} />}
      </>}
    >
      <RunBanner run={run} inc={inc} />
      {stale && <StaleNotice />}
      <section className="dx-head" aria-label="Incident">
        <div className="dx-head-main">
          <IconBox icon="monitor" tone="danger" />
          <div className="col" style={{ gap: 6, minWidth: 0 }}>
            {inc.symptom && <span className="dx-symptom">“{inc.symptom}”</span>}
            <h1 className="dx-title">{inc.title}</h1>
            <p className="c-text2" style={{ fontSize: 14 }}>{inc.summary}</p>
            <IncidentMeta inc={inc} extra={<span><Icon name="eye" size={13} />Looking only · nothing changed</span>} />
          </div>
        </div>
        <div className="dx-stepper"><LoopStepper current={step} /></div>
      </section>

      <div className={`dx-body ${stale ? 'dx-stale' : ''}`}>
        <div className="dx-main">
          <LikelyCause inc={inc} />
          <CrashTimeline events={inc.timeline} />
        </div>
        <div className="dx-side">
          <Alternatives inc={inc} />
          <FixOptions inc={inc} stale={stale} active={active} rollback={rollback} clean={clean} />
        </div>
      </div>
    </Page>
  );
}

const KIND_ICON: Record<EvidenceRef['kind'], { icon: IconName; cls: string; word: string }> = {
  for: { icon: 'check', cls: 'c-ok', word: 'Supports' },
  against: { icon: 'close', cls: 'c-subtle', word: 'Rules out' },
  neutral: { icon: 'info', cls: 'c-warn', word: 'Context' },
};

function LikelyCause({ inc }: { inc: Incident }) {
  const rc = inc.rootCause;
  const detail = rc?.detail.replace(NOT_PERCENT, '').trim();
  return (
    <section className="card accent dx-likely" aria-labelledby="dx-likely-h">
      <div className="row between">
        <h2 id="dx-likely-h" className="t-overline">Most likely cause</h2>
        <ConfidenceMeter value={rc?.confidence ?? 'unknown'} />
      </div>
      <div className="row gap-4" style={{ alignItems: 'flex-start' }}>
        <IconBox icon="gpu" tone="accent" size="sm" />
        <p className="dx-cause-title">{rc?.title ?? 'No likely cause yet — unknown is a valid answer.'}</p>
      </div>
      {detail && <p className="t-small c-text2">{detail}</p>}
      {inc.evidence.length > 0 && (
        <ul className="dx-reasons" aria-label="What the evidence says">
          {inc.evidence.map((e) => {
            const k = KIND_ICON[e.kind];
            return (
              <li key={e.id} className={`dx-reason ${e.kind}`}>
                <Icon name={k.icon} size={15} className={k.cls} style={{ flexShrink: 0, marginTop: 2 }} />
                <span className="grow"><span className="sr-only">{k.word}: </span>{e.text} <span className="c-subtle">· {e.meta}</span></span>
                <EvidenceTag id={e.id} />
              </li>
            );
          })}
        </ul>
      )}
      <div className="dx-likely-foot">
        <span className="t-small c-subtle">{NOT_PERCENT} Not “Confirmed” until a fix holds.</span>
        <Link to={`/evidence/preview/${inc.id}`} className="t-small">What the AI sees</Link>
      </div>
    </section>
  );
}

// ───────── crash timeline (AC-18): markers are real buttons; a text list mirrors them for screen readers ─────────

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY = 864e5;

function parseAt(at: string, now: Date): number | null {
  const [d = '', t = ''] = at.split('·').map((s) => s.trim());
  const tm = /^(\d{1,2}):(\d{2})$/.exec(t);
  let base: Date | null = null;
  if (/^today$/i.test(d)) base = new Date(now);
  else if (/^yesterday$/i.test(d)) base = new Date(now.getTime() - DAY);
  else {
    const m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})$/.exec(d);
    const mi = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
    if (m && mi >= 0) base = new Date(now.getFullYear(), mi, Number(m[2]));
  }
  if (!base) return null;
  base.setHours(tm ? Number(tm[1]) : 12, tm ? Number(tm[2]) : 0, 0, 0);
  return base.getTime();
}

interface Placed { e: TimelineEvent; x: number; lane: 0 | 1 }

/** Places events on a 7-day axis ending today; falls back to even spacing when the labels can’t be dated. */
function layout(events: TimelineEvent[], now = new Date()) {
  const times = events.map((e) => parseAt(e.at, now));
  const end = new Date(now); end.setHours(24, 0, 0, 0);
  let start = end.getTime() - 7 * DAY;
  const dated = times.every((t): t is number => t !== null && t <= end.getTime());
  if (dated && times.length) start = Math.min(start, new Date(new Date(Math.min(...(times as number[]))).setHours(0, 0, 0, 0)).getTime());
  const span = end.getTime() - start;
  const useTime = dated && span <= 21 * DAY;
  const xs = events.map((_, i) => useTime ? 3 + 94 * (((times[i] as number) - start) / span) : events.length === 1 ? 50 : 5 + (90 * i) / (events.length - 1));
  const last: [number, number] = [-99, -99];
  const placed: Placed[] = events.map((e, i) => {
    const x = xs[i];
    const lane: 0 | 1 = x - last[0] < 4.5 && x - last[1] >= 4.5 ? 1 : 0;
    last[lane] = x;
    return { e, x, lane };
  });
  const ticks: { x: number; label: string }[] = [];
  if (useTime) {
    const days = Math.round(span / DAY);
    for (let i = 0; i < days; i++) {
      const d = new Date(start + i * DAY + DAY / 2);
      const isToday = d.toDateString() === now.toDateString();
      ticks.push({ x: 3 + 94 * ((i + 0.5) / days), label: isToday ? 'Today' : i === 0 ? d.toLocaleDateString('en', { month: 'short', day: 'numeric' }) : String(d.getDate()) });
    }
  }
  return { placed, ticks, days: useTime ? Math.round(span / DAY) : 0 };
}

const SEV_WORD: Record<TimelineEvent['severity'], string> = { crash: 'Crash', freeze: 'Freeze', warn: 'Warning', info: 'Event', change: 'Change' };

function CrashTimeline({ events }: { events: TimelineEvent[] }) {
  const { placed, ticks, days } = useMemo(() => layout(events), [events]);
  const [sel, setSel] = useState(events.length - 1);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const cur = events[sel];
  const kinds = Array.from(new Set(events.map((e) => e.severity)));
  const onKey = (ev: React.KeyboardEvent, i: number) => {
    const map: Record<string, number> = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: events.length - 1 };
    if (!(ev.key in map)) return;
    ev.preventDefault();
    const n = Math.max(0, Math.min(events.length - 1, map[ev.key]));
    setSel(n);
    refs.current[n]?.focus();
  };
  if (!events.length) return null;
  return (
    <section className="card dx-timeline" aria-labelledby="dx-tl-h">
      <div className="row between wrap">
        <h2 id="dx-tl-h" className="t-title">Crash timeline{days ? ` · last ${days} days` : ''}</h2>
        <span className="row gap-4 t-small c-muted" aria-hidden="true">
          {kinds.map((k) => <span key={k} className="row" style={{ gap: 6 }}><span className={`dx-legend ${k}`} />{SEV_WORD[k]}</span>)}
        </span>
      </div>
      <div className="dx-track" role="group" aria-label="Crash timeline — choose an event to see its details">
        <span className="dx-track-line" aria-hidden="true" />
        {placed.map(({ e, x, lane }, i) => (
          <button
            key={e.id} ref={(el) => { refs.current[i] = el; }} type="button"
            className={`dx-mark ${e.severity} lane-${lane}`} style={{ left: `${x}%` }}
            aria-label={e.label} aria-pressed={sel === i} title={e.label}
            onClick={() => setSel(i)} onKeyDown={(ev) => onKey(ev, i)}
          ><span /></button>
        ))}
        <div className="dx-axis" aria-hidden="true">{ticks.map((t) => <span key={t.label + t.x} style={{ left: `${t.x}%` }}>{t.label}</span>)}</div>
      </div>
      {cur && (
        <div className="dx-detail" aria-live="polite" data-testid="timeline-detail">
          <span className="mono c-danger" style={{ fontSize: 12, flexShrink: 0 }}><span className="sr-only">{SEV_WORD[cur.severity]} at </span>{cur.at}</span>
          <span className="grow" style={{ fontSize: 13 }}>{cur.cause}</span>
          <EvidenceTag id={cur.evidenceId} />
        </div>
      )}
      <ul className="sr-only" aria-label="Crash timeline as a list">
        {events.map((e) => <li key={e.id}>{e.label}: {e.cause}. Evidence {e.evidenceId}.</li>)}
      </ul>
    </section>
  );
}

function Alternatives({ inc }: { inc: Incident }) {
  const others = inc.hypotheses.filter((h) => !isRootCauseRestated(h, inc));
  return (
    <section className="card" aria-labelledby="dx-alt-h">
      <div className="row between"><h2 id="dx-alt-h" className="t-title">Other possible causes</h2><span className="t-small c-subtle">Each with a test</span></div>
      {others.length === 0 && <p className="t-small c-subtle">No other cause fits the evidence.</p>}
      <ul className="dx-alts">{others.map((h) => <AltRow key={h.id} h={h} />)}</ul>
    </section>
  );
}

/** Title + label + the test that would separate it stay visible; the reasoning expands. */
function AltRow({ h }: { h: Hypothesis }) {
  const [open, setOpen] = useState(false);
  const pid = useId();
  return (
    <li className="dx-alt" data-hypothesis={h.id}>
      <button type="button" className="dx-alt-toggle" aria-expanded={open} aria-controls={pid} onClick={() => setOpen(!open)}>
        <span className={`grow ${h.vetoedByRule ? 'dx-hyp-title vetoed' : ''}`}>{h.title}</span>
        <ConfidenceMeter value={h.confidence} />
        <Icon name="chevronDown" size={14} className="chev" />
      </button>
      <div className="dx-alt-foot">
        {h.test
          ? <p className="dx-test t-small grow"><Icon name="search" size={13} style={{ flexShrink: 0, marginTop: 2 }} /><span><span className="c-subtle">Test: </span>{h.test}</span></p>
          : <span className="grow" />}
        <EvidenceIds ids={h.evidenceIds} />
      </div>
      {h.vetoedByRule && <VetoNote rule={h.vetoedByRule} />}
      <p id={pid} className="t-small c-muted dx-alt-panel" hidden={!open}>{h.detail}</p>
    </li>
  );
}

type FixKey = 'rollback' | 'clean';

function planMeta(p: Plan | null, loading: boolean, fallback: string) {
  if (loading) return 'Checking what this needs…';
  if (!p) return fallback;
  const n = activeSteps(p).length;
  return [`${n} ${n === 1 ? 'step' : 'steps'}`, `about ${p.estimatedMinutes} min`, p.requiresReboot ? (p.kind === 'guided' ? 'guided across restarts' : 'needs a restart') : 'no restart', p.requiresAdmin ? 'admin' : ''].filter(Boolean).join(' · ');
}

function FixOptions({ inc, stale, active, rollback, clean }: { inc: Incident; stale: boolean; active: boolean; rollback: ReturnType<typeof usePlanPreview>; clean: ReturnType<typeof usePlanPreview> }) {
  const nav = useNavigate();
  const [pick, setPick] = useState<FixKey>('clean');
  const opts: { k: FixKey; title: string; body: string; plan: ReturnType<typeof usePlanPreview> }[] = [
    { k: 'rollback', title: 'Quick: roll back the driver', body: 'Go back to the driver that worked before the update.', plan: rollback },
    { k: 'clean', title: 'Thorough: clean driver reinstall', body: 'Remove the driver in Safe Mode, then install a verified clean copy.', plan: clean },
  ];
  const cur = opts.find((o) => o.k === pick)!;
  const unavailable = !cur.plan.loading && !!cur.plan.error;
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const i = opts.findIndex((o) => o.k === pick);
    const n = (i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1) + opts.length) % opts.length;
    setPick(opts[n].k);
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[n]?.focus();
  };
  const go = () => nav(pick === 'clean' ? `/incidents/${inc.id}/guided` : `/incidents/${inc.id}/plan?variant=rollback`);
  return (
    <section className="card dx-fixes" aria-labelledby="dx-fix-h">
      <h2 id="dx-fix-h" className="t-title">Two ways to fix it</h2>
      {active
        ? <p className="t-small c-muted">A repair is already running for this incident. <Link to={`/incidents/${inc.id}/run`}>Open the repair</Link></p>
        : (
          <>
            <div role="radiogroup" aria-labelledby="dx-fix-h" className="col gap-3" onKeyDown={onKey}>
              {opts.map((o) => (
                <RadioCard
                  key={o.k} name={o.k} checked={pick === o.k} onSelect={() => setPick(o.k)} recommended={o.k === 'clean'}
                  title={o.title} body={o.body}
                  meta={o.plan.error ? `Not available: ${o.plan.error.headline}` : planMeta(o.plan.plan, o.plan.loading, '')}
                />
              ))}
            </div>
            <p className="t-small c-subtle">Either way you review every step and approve it first. Nothing changes until then.</p>
            {cur.plan.loading && <span className="row t-small c-muted"><Spinner label="Checking the fix" />Checking what this fix needs…</span>}
            <Button variant="primary" size="lg" icon={pick === 'clean' ? 'wrench' : 'undo'} onClick={go} disabled={stale || unavailable} aria-describedby={stale || unavailable ? 'dx-fix-why' : undefined}>
              {pick === 'clean' ? 'Start guided repair' : 'Plan the rollback'}
            </Button>
            {(stale || unavailable) && <span id="dx-fix-why" className="t-small c-warn">{stale ? 'This diagnosis is out of date — check again first.' : `${cur.plan.error!.headline} · ${cur.plan.error!.didNotHappen ?? 'Nothing will change.'}`}</span>}
          </>
        )}
    </section>
  );
}
