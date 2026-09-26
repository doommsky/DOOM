/** Shared building blocks for the incident views (boards 05, 09, 16 + resolved summary). */
import { useId, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TERMINAL_STATES, type Hypothesis, type Incident, type JournalState, type RunProgress } from '../../../shared/contracts';
import { useApp } from '../../AppContext';
import { useAction, useApi } from '../../hooks/useApi';
import { Icon, type IconName } from '../../components/Icon';
import { Button, ConfidenceMeter, Dialog, EvidenceTag, LoopStepper, Spinner, journalLabel, timeAgo } from '../../components/ui';

export type LoopStep = Parameters<typeof LoopStepper>[0]['current'];

export interface ViewProps {
  inc: Incident;
  run: RunProgress | null;
  reload: () => void;
}

export const isTerminal = (s: JournalState) => TERMINAL_STATES.includes(s);
/** A run that still holds (or waits for) the repair lock. */
export const runActive = (run: RunProgress | null) => !!run && !isTerminal(run.state);

export const incidentCrumbs = (id: string) => [{ label: 'Incidents', to: '/incidents' }, { label: <span className="mono">{id}</span> }];

/** A hypothesis that restates the root cause (all of the root cause's evidence) is not an “other” explanation. */
export function isRootCauseRestated(h: Hypothesis, inc: Incident) {
  const ids = inc.rootCause?.evidenceIds ?? [];
  return ids.length > 0 && ids.every((x) => h.evidenceIds.includes(x));
}

export function loopStepFor(inc: Incident, run: RunProgress | null, planReady: boolean): LoopStep {
  if (runActive(run)) return 'Act';
  switch (inc.status) {
    case 'diagnosing': return 'Explain';
    case 'planned': return 'Approve';
    case 'queued': case 'running': case 'waiting_reboot': case 'blocked': return 'Act';
    case 'verified': case 'partially_verified': case 'closed': return 'Verify';
    default: return planReady ? 'Approve' : 'Plan';
  }
}

/** Where the incident lives: the project name when it belongs to one, otherwise this PC. */
export function useWhere(inc: Incident) {
  const projects = useApi('projects.list', undefined, []);
  if (!inc.projectId) return inc.type === 'setup' ? 'Set up' : 'This PC';
  return projects.data?.find((p) => p.id === inc.projectId)?.name ?? inc.projectId;
}

export function IncidentMeta({ inc, extra }: { inc: Incident; extra?: ReactNode }) {
  const where = useWhere(inc);
  return (
    <div className="dx-meta">
      <span><Icon name={inc.projectId ? 'folder' : 'monitor'} size={13} />{where}</span>
      <span><Icon name="clock" size={13} />Opened <time dateTime={inc.createdAt} title={new Date(inc.createdAt).toLocaleString()}>{timeAgo(inc.createdAt)}</time></span>
      <span><Icon name="lock" size={13} />Evidence frozen · <span className="mono">{inc.evidenceSnapshot}</span></span>
      {extra}
    </div>
  );
}

export function IconBox({ icon, tone = 'danger', size }: { icon: IconName; tone?: 'danger' | 'warn' | 'ok' | 'accent' | 'neutral'; size?: 'sm' }) {
  return <span className={`dx-iconbox ${tone} ${size ?? ''}`} aria-hidden="true"><Icon name={icon} size={size ? 18 : 22} /></span>;
}

/** Banner for a repair that is still running, queued, waiting for a restart or paused by drift. */
export function RunBanner({ run, inc }: { run: RunProgress | null; inc: Incident }) {
  if (!run) return null;
  const to = `/incidents/${inc.id}/run`;
  if (run.state === 'APPROVED' && run.queuedBehind) {
    return (
      <div className="dx-banner accent" role="status" aria-live="polite">
        <Icon name="clock" size={16} />
        <span className="grow"><strong>Queued behind {run.queuedBehind}</strong> · nothing has run yet. One repair at a time.</span>
        <Link to={to} className="btn sm">Open the repair</Link>
      </div>
    );
  }
  if (!isTerminal(run.state)) {
    return (
      <div className="dx-banner accent" role="status" aria-live="polite">
        {run.state === 'WAITING_FOR_REBOOT' ? <Icon name="restart" size={16} /> : <Spinner label="Repair in progress" />}
        <span className="grow"><strong>A repair is in progress</strong> · {run.adminPrompt === 'waiting' ? 'Waiting for your answer to the Windows admin prompt' : journalLabel(run.state)} <span className="mono c-subtle">({run.state})</span></span>
        <Link to={to} className="btn sm primary">Open the repair</Link>
      </div>
    );
  }
  if (run.state === 'BLOCKED' && inc.status === 'blocked') {
    return (
      <div className="dx-banner warn" role="alert">
        <Icon name="alert" size={16} />
        <span className="grow"><strong>{run.error?.headline ?? 'The repair paused'}</strong>{run.notRunStep ? <> · {run.notRunStep} did not run.</> : run.error?.didNotHappen ? <> · {run.error.didNotHappen}</> : null}</span>
        <Link to={to} className="btn sm">See what changed</Link>
      </div>
    );
  }
  return null;
}

/** E_EVIDENCE_STALE pattern: what happened · what did not happen · one next step. */
export function StaleNotice() {
  const nav = useNavigate();
  return (
    <div className="dx-banner warn" role="status">
      <Icon name="clock" size={16} />
      <span className="grow"><strong>This diagnosis is out of date</strong> · Something on this PC changed after the evidence was frozen. No fix can be approved from it.</span>
      <Button size="sm" icon="search" onClick={() => nav('/scan?start=1')}>Check again</Button>
    </div>
  );
}

export function CheckAgainButton() {
  const nav = useNavigate();
  return <Button size="sm" icon="search" onClick={() => nav('/scan?start=1')}>Check again</Button>;
}

/** Closing never touches the PC; it moves the incident to Resolved. Confirmed in a dialog. */
export function CloseIncidentButton({ inc, onClosed }: { inc: Incident; onClosed: () => void }) {
  const [open, setOpen] = useState(false);
  const close = useAction('incident.close');
  const { notify, refresh } = useApp();
  const confirm = async () => {
    const r = await close.run({ id: inc.id });
    if (r.ok) {
      setOpen(false);
      notify({ kind: 'ok', title: `${inc.id} closed`, body: 'Nothing on your PC changed. The evidence stays in the vault.' });
      void refresh();
      onClosed();
    }
  };
  return (
    <>
      <Button size="sm" icon="check" onClick={() => setOpen(true)}>Close incident</Button>
      {open && (
        <Dialog label={`Close ${inc.id}`} onClose={() => setOpen(false)} center width={460}>
          <div className="col gap-4" style={{ padding: 22 }}>
            <h2 className="t-title">Close {inc.id}?</h2>
            <p className="t-small c-muted">It moves to Resolved. Nothing on your PC changes and no fix runs. You can still find it, and its evidence, in History.</p>
            {close.error && <p className="t-small c-danger" role="alert">{close.error.headline} · {close.error.didNotHappen ?? 'Nothing changed.'}</p>}
            <div className="row end gap-3">
              <Button onClick={() => setOpen(false)}>Keep it open</Button>
              <Button variant="primary" onClick={confirm} disabled={close.busy}>{close.busy ? 'Closing…' : 'Close incident'}</Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}

export function EvidenceIds({ ids, empty = 'No evidence yet' }: { ids: string[]; empty?: string }) {
  if (!ids.length) return <span className="t-small c-subtle dx-noev">{empty}</span>;
  return <span className="row wrap" style={{ gap: 6 }}>{ids.map((x) => <EvidenceTag key={x} id={x} />)}</span>;
}

export function VetoNote({ rule }: { rule: string }) {
  return (
    <div className="dx-veto" role="note">
      <Icon name="shield" size={15} />
      <span><strong>Ruled out by rule <span className="mono">{rule}</span>.</strong> It can’t be chosen as the cause and can’t drive any fix.</span>
    </div>
  );
}

const DOT: Record<Hypothesis['confidence'], string> = { confirmed: 'ok', high: 'accent', medium: 'warn', low: 'neutral', unknown: 'unknown' };

/** Expandable hypothesis row (board 05). Label + evidence IDs are always visible; the reasoning expands. */
export function HypothesisRow({ h, open, onToggle }: { h: Hypothesis; open: boolean; onToggle: () => void }) {
  const pid = useId();
  const vetoed = !!h.vetoedByRule;
  return (
    <li className="dx-hyp" data-hypothesis={h.id}>
      <button type="button" className="dx-hyp-toggle" aria-expanded={open} aria-controls={pid} onClick={onToggle}>
        <span className={`dot ${vetoed ? 'neutral' : DOT[h.confidence]}`} aria-hidden="true" />
        <span className={`grow dx-hyp-title ${vetoed ? 'vetoed' : ''}`}>{h.title}</span>
        {vetoed && <span className="chip neutral"><Icon name="lock" size={12} />Ruled out · <span className="mono">{h.vetoedByRule}</span></span>}
        <ConfidenceMeter value={h.confidence} />
        <Icon name="chevronDown" size={14} className="chev" />
      </button>
      <div className="dx-hyp-refs"><span className="t-small c-subtle">Evidence</span><EvidenceIds ids={h.evidenceIds} /></div>
      <div id={pid} className="dx-hyp-panel" hidden={!open} role="region" aria-label={`Reasoning: ${h.title}`}>
        <p>{h.detail}</p>
        {h.test && <p className="t-small"><span className="c-subtle">How to tell: </span>{h.test}</p>}
        {vetoed && <VetoNote rule={h.vetoedByRule!} />}
      </div>
    </li>
  );
}

export function AiNote({ note }: { note?: Incident['aiNote'] }) {
  if (!note) return null;
  const paused = note.code !== 'OK';
  return (
    <div className={`dx-ai-note ${paused ? 'paused' : ''}`}>
      <Icon name={paused ? 'alert' : 'sparkle'} size={16} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{paused && <strong>Explanations paused · rules only. </strong>}{note.text}</span>
    </div>
  );
}
