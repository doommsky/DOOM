/**
 * Board 26 · Admin permission hand-off — waiting, declined, timed out, helper untrusted.
 * UI safety rule 7: admin rights come only through the real Windows prompt. This explains what that prompt
 * must show; the app never asks for a password and never hides or skips the prompt. In demo mode a clearly
 * labelled simulated prompt stands in for Windows (run.decide admin-allow / admin-decline).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Plan, RunProgress } from '../../shared/contracts';
import { useApp } from '../AppContext';
import { ask } from '../screens/change/api';
import { Icon } from './Icon';
import { Button, Card, Dialog, LinkButton } from './ui';
import '../styles/change.css';

export const PUBLISHER = 'Environment Doctor';
export const HELPER = 'Environment Doctor admin helper';

export function AdminHandoff({ run, onAllow, onDecline, mode = 'overlay', onClose, busy }: {
  run: RunProgress;
  onAllow: () => void;
  onDecline: () => void;
  /** overlay = centred modal dialog (default); inline = the same content in the page (after the dialog is closed). */
  mode?: 'overlay' | 'inline';
  onClose?: () => void;
  busy?: boolean;
}) {
  const state = run.adminPrompt;
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Move focus to the title once the dialog has placed it, so the prompt is announced before any button.
  useEffect(() => {
    if (mode !== 'overlay') return;
    const t = setTimeout(() => titleRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [mode, state]);
  if (!state) return null;

  const content = <Content run={run} state={state} onAllow={onAllow} onDecline={onDecline} busy={busy} titleRef={titleRef} />;
  if (mode === 'inline') return <Card className={`ch-inline-uac ${state === 'untrusted' ? 'ch-untrusted' : ''}`} aria-label="Admin permission">{content}</Card>;
  const label = state === 'waiting' ? 'Windows is asking for permission' : state === 'untrusted' ? 'The admin helper failed a safety check' : 'Admin permission — nothing changed';
  return (
    <Dialog key={state} label={label} center width={580} onClose={onClose ?? noop}>
      <div className={state === 'untrusted' ? 'ch-untrusted' : ''}>{content}</div>
    </Dialog>
  );
}

function noop() { /* the Windows prompt, not this explanation, decides */ }

function Content({ run, state, onAllow, onDecline, busy, titleRef }: { run: RunProgress; state: NonNullable<RunProgress['adminPrompt']>; onAllow: () => void; onDecline: () => void; busy?: boolean; titleRef: React.Ref<HTMLHeadingElement> }) {
  const { machine } = useApp();
  const nav = useNavigate();
  const demo = machine?.mode === 'demo';
  const idx = Math.max(0, Math.min(run.stepIndex, run.steps.length - 1));
  const step = run.steps[idx];
  const stepLabel = step ? `Step ${idx + 1} · ${step.title}` : 'The next step';

  const [plan, setPlan] = useState<Plan | null>(null);
  useEffect(() => {
    if (state !== 'declined' && state !== 'timeout') return;
    let alive = true;
    void ask('plan.get', { id: run.planId }).then((r) => { if (alive && r.ok) setPlan(r.data); });
    return () => { alive = false; };
  }, [state, run.planId]);
  const userSteps = plan ? plan.steps.filter((s) => !s.removedReason && s.privilege === 'user').length : null;

  if (state === 'waiting') {
    return (
      <div className="ch-uac">
        <Header icon="shield" tone="warn" pulse titleRef={titleRef} title="Windows is asking for permission">
          Choose <strong>Yes</strong> in the Windows prompt to let the admin helper run {step ? <>step {idx + 1} ({step.title})</> : 'the next step'}. It closes itself as soon as the admin steps are done.
        </Header>
        <div className="ch-uac-check">
          <span className="t-overline">Check the Windows prompt shows</span>
          <dl>
            <div><dt>Program</dt><dd>{HELPER}</dd></div>
            <div><dt>Verified publisher</dt><dd>{PUBLISHER}</dd></div>
            <div><dt>For</dt><dd>{stepLabel}</dd></div>
          </dl>
          <span className="t-small c-warn">If the publisher says “Unknown”, choose No.</span>
        </div>
        <p className="t-small c-muted row start" style={{ gap: 8 }}>
          <Icon name="lock" size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          Environment Doctor never asks for your password and never hides or skips this prompt. Only Windows can give admin rights.
        </p>
        {demo && (
          <section className="ch-sim" aria-label="Simulated Windows prompt — demo mode">
            <div className="ch-sim-label"><Icon name="monitor" size={13} />Simulated Windows prompt — demo mode</div>
            <div className="ch-sim-body">
              <span className="t-small c-muted">User Account Control</span>
              <span className="q">Do you want to allow this app to make changes to your device?</span>
              <div className="ch-sim-app">
                <span className="ch-icon" aria-hidden="true"><Icon name="shieldCheck" size={18} /></span>
                <span className="col" style={{ gap: 0 }}>
                  <strong>{HELPER}</strong>
                  <span className="t-small c-muted">Verified publisher: {PUBLISHER}</span>
                </span>
              </div>
              <div className="ch-sim-btns">
                <Button variant="primary" onClick={onAllow} disabled={busy}>Yes</Button>
                <Button onClick={onDecline} disabled={busy}>No</Button>
              </div>
            </div>
          </section>
        )}
        <div className="ch-uac-foot">
          <span className="grow">Don’t see it? Check the taskbar.</span>
        </div>
      </div>
    );
  }

  if (state === 'untrusted') {
    return (
      <div className="ch-uac">
        <div role="alert" className="col" style={{ gap: 12 }}>
          <Header icon="close" tone="danger" titleRef={titleRef} title="Stopped — the admin helper failed a safety check">
            <strong className="c-danger">All repairs are paused.</strong> Its signature didn’t match what we expect, so it was never given permission. This can mean a damaged install or tampering. Nothing ran.
          </Header>
        </div>
        <div className="ch-uac-check">
          <span className="t-overline">Repair the app install</span>
          <ol className="t-small c-text2" style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <li>Close Environment Doctor.</li>
            <li>Download the installer again from the official site and run it. Your history and evidence are kept.</li>
            <li>Open Environment Doctor — it checks the helper’s signature before any repair.</li>
          </ol>
        </div>
        <details className="t-small c-subtle">
          <summary>Details</summary>
          <pre className="code" style={{ marginTop: 6 }}>{`E_HELPER_UNTRUSTED · expected publisher ${PUBLISHER}\nNo changes made · all repairs paused`}</pre>
        </details>
        <div className="ch-uac-foot">
          <Button variant="primary" onClick={() => nav('/settings/updates')}>Repair the app install</Button>
          <LinkButton to="/history">View history</LinkButton>
          <span className="grow">Repairs stay paused until fixed</span>
        </div>
      </div>
    );
  }

  // declined | timeout
  const declined = state === 'declined';
  return (
    <div className="ch-uac">
      <Header icon={declined ? 'shieldCheck' : 'clock'} tone={declined ? 'ok' : 'neutral'} titleRef={titleRef} title={declined ? 'No problem — you chose No' : 'The prompt closed without an answer'}>
        {declined ? 'The admin helper never started.' : 'Windows closes its prompt after a while, so the admin helper never started.'} We’ll re-check your PC before asking again.
      </Header>
      <p className="ch-nothing"><Icon name="check" size={15} />Nothing changed.</p>
      {userSteps === 0
        ? <p className="t-small c-muted">Every step in this fix needs admin rights, so there’s nothing to run without them.</p>
        : (
          <div className="ch-uac-check">
            <span className="t-small c-text2">{userSteps ? `${userSteps} step${userSteps > 1 ? 's' : ''} can run with your own account.` : 'Some steps may run with your own account.'} They get their own plan and approval.</span>
          </div>
        )}
      <div className="ch-uac-foot">
        {userSteps !== 0 && <LinkButton to={`/incidents/${run.incidentId}/plan?variant=user-only`} variant="primary" icon="user">Run only the steps that don’t need admin</LinkButton>}
        <LinkButton to={`/incidents/${run.incidentId}`}>Keep incident open</LinkButton>
        <LinkButton to={`/incidents/${run.incidentId}/${plan?.kind === 'guided' ? 'guided' : 'plan'}`} variant="ghost">Try again</LinkButton>
      </div>
      <span className="t-small c-subtle">Logged as: {declined ? 'declined by you' : 'timed out'}</span>
    </div>
  );
}

function Header({ icon, tone, title, children, pulse, titleRef }: { icon: 'shield' | 'shieldCheck' | 'close' | 'clock'; tone: 'warn' | 'ok' | 'danger' | 'neutral'; title: string; children: ReactNode; pulse?: boolean; titleRef: React.Ref<HTMLHeadingElement> }) {
  return (
    <div className="row start gap-4">
      <span className={`ch-icon lg ${tone} ${pulse ? 'pulse' : ''}`} aria-hidden="true"><Icon name={icon} size={24} /></span>
      <div className="col" style={{ gap: 6 }}>
        <h2 className="ch-uac-title" tabIndex={-1} ref={titleRef}>{title}</h2>
        <p className="c-text2" style={{ fontSize: 14, lineHeight: 1.55 }}>{children}</p>
      </div>
    </div>
  );
}
