/** Board 16 · Partly fixed (incident status partially_verified, journal PARTIALLY_VERIFIED). */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { VerificationResult } from '../../../shared/contracts';
import { useApp } from '../../AppContext';
import { useAction, useApi } from '../../hooks/useApi';
import { Page } from '../../components/Shell';
import { Icon } from '../../components/Icon';
import { Button, IncidentStatusChip, RadioCard, Spinner } from '../../components/ui';
import { CheckAgainButton, IconBox, IncidentMeta, incidentCrumbs, type ViewProps } from './shared';
import { activeSteps, usePlanPreview } from './usePlanPreview';

type Next = 'next' | 'keep' | 'undo';

export function PartlyFixed({ inc, run, reload }: ViewProps) {
  const nav = useNavigate();
  const { notify } = useApp();
  const next = usePlanPreview(inc.id, true, { next: true });
  const last = useApi('plan.get', { id: run?.planId ?? '' }, [run?.planId]);
  const decide = useAction('run.decide');
  const [pick, setPick] = useState<Next>('next');
  const [kept, setKept] = useState(false);

  const checks = run?.verification ?? [];
  const failed = checks.filter((c) => c.state === 'fail');
  const passed = checks.filter((c) => c.state === 'pass');
  const notRun = checks.filter((c) => c.state === 'pending' || c.state === 'running');
  const stepsDone = run?.steps.filter((s) => s.state === 'done') ?? [];
  const lastPlan = run?.planId ? last.data : null;
  const nextPlan = next.plan;
  const nextSteps = nextPlan ? activeSteps(nextPlan) : [];

  const opts: { k: Next; title: string; body: string; meta: string; cta: string; recommended?: boolean; disabled?: string }[] = [
    {
      k: 'next', recommended: true, cta: 'Review this plan',
      title: nextPlan ? nextPlan.title : 'Plan the next fix',
      body: nextPlan
        ? `${nextSteps.map((s) => s.title).join(' · ')}. Keeps what already passed.${nextPlan.isolationNote ? ' ' + nextPlan.isolationNote : ''}`
        : next.error ? `${next.error.headline} · ${next.error.didNotHappen ?? 'Nothing will change.'}` : 'Built from what the final check just learned.',
      meta: nextPlan ? riskLine(nextSteps.some((s) => s.risk === 'high') ? 'High' : nextSteps.some((s) => s.risk === 'medium') ? 'Medium' : 'Low', nextPlan.requiresAdmin, nextPlan.requiresReboot) : next.loading ? 'Checking what it needs…' : '',
      disabled: next.error ? next.error.headline : undefined,
    },
    { k: 'keep', title: 'Keep things as they are', body: 'What passed stays. The incident stays open as partly fixed.', meta: 'Nothing changes', cta: 'Keep as partly fixed' },
    {
      k: 'undo', cta: 'Build undo plan',
      title: lastPlan ? `Undo: ${lastPlan.title}` : 'Undo the last fix',
      body: `Not recommended${failed[0] ? ` — “${failed[0].label}” is the remaining problem, not what already passed` : ''}. Needs its own approval.`,
      meta: lastPlan ? riskLine(undefined, lastPlan.requiresAdmin, lastPlan.requiresReboot) : '',
    },
  ];
  const cur = opts.find((o) => o.k === pick)!;

  const act = async () => {
    if (pick === 'next') nav(`/incidents/${inc.id}/plan?next=1`);
    else if (pick === 'undo') nav(`/incidents/${inc.id}/plan?variant=undo`);
    else if (run) {
      const r = await decide.run({ executionId: run.executionId, decision: 'keep' });
      if (r.ok) {
        setKept(true);
        notify({ kind: 'info', title: `${inc.id} kept as partly fixed`, body: 'Nothing changed. What passed stays; the incident stays open.' });
        reload();
      }
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const i = opts.findIndex((o) => o.k === pick);
    const n = (i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1) + opts.length) % opts.length;
    setPick(opts[n].k);
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[n]?.focus();
  };

  return (
    <Page
      crumbs={incidentCrumbs(inc.id)}
      actions={<>
        <IncidentStatusChip status={inc.status} />
        <span className="mono c-warn" style={{ fontSize: 12 }} title="Journal state"><span className="sr-only">Journal state </span>{run?.state ?? 'PARTIALLY_VERIFIED'}</span>
        <CheckAgainButton />
      </>}
    >
      <section className="card dx-partial-hero" aria-labelledby="dx-partial-h">
        <IconBox icon="alert" tone="warn" />
        <div className="col grow" style={{ gap: 8 }}>
          <span className="t-small c-muted">{inc.title}</span>
          <h1 id="dx-partial-h" className="dx-title">Partly fixed — {passed.length} of {checks.length || '?'} checks passed</h1>
          <p className="c-text2" style={{ fontSize: 14.5, maxWidth: 820 }}>
            {lastPlan ? <>“{lastPlan.title}” ran and did part of the job. </> : null}
            {failed.length ? 'The final check showed a problem that is still there, so this incident isn’t marked fixed.' : 'Not every check finished, so this incident isn’t marked fixed.'}
          </p>
          <IncidentMeta inc={inc} />
        </div>
      </section>

      <div className="dx-body">
        <div className="dx-main">
          <section className="card dx-checks" aria-labelledby="dx-checks-h">
            <div className="dx-checks-head"><h2 id="dx-checks-h" className="t-title">Checks</h2>{run?.error && <span className="t-small c-muted">{run.error.didNotHappen}</span>}</div>
            {!run && <p className="t-small c-subtle" style={{ padding: '0 20px 16px' }}>No verification record is available for this repair.</p>}
            {failed.length > 0 && <h3 className="t-overline dx-checks-sub">Still failing</h3>}
            <ul className="dx-check-list">{failed.map((c) => <CheckRow key={c.id} c={c} />)}</ul>
            {passed.length > 0 && <h3 className="t-overline dx-checks-sub">What stayed fixed</h3>}
            <ul className="dx-check-list" aria-label="What stayed fixed">{passed.map((c) => <CheckRow key={c.id} c={c} />)}</ul>
            {notRun.length > 0 && <ul className="dx-check-list">{notRun.map((c) => <CheckRow key={c.id} c={c} />)}</ul>}
            {stepsDone.length > 0 && (
              <p className="t-small c-subtle" style={{ padding: '10px 20px 14px', borderTop: '1px solid var(--border-soft)' }}>
                Steps that ran: {stepsDone.map((s) => s.title).join(' · ')}. Exit codes are information — the checks above are what count.
              </p>
            )}
          </section>

          <section className="card dx-learned" aria-labelledby="dx-learned-h">
            <div className="row between">
              <h2 id="dx-learned-h" className="t-title row" style={{ gap: 8 }}><Icon name="sparkle" size={16} className="c-accent" />What we learned</h2>
              <span className="chip accent">New evidence</span>
            </div>
            {(inc.learned ?? []).length
              ? <ul className="dx-learned-list">{inc.learned!.map((l) => <li key={l}>{l}</li>)}</ul>
              : <p className="t-small c-subtle">The failed check didn’t add new evidence.</p>}
            <span className="t-small c-muted">The next plan starts from this — not from the original diagnosis alone.</span>
          </section>

          <dl className="kv card inset" aria-label="Journal">
            <dt>Journal state</dt><dd>{run?.state ?? 'PARTIALLY_VERIFIED'}</dd>
            {run && <><dt>Execution</dt><dd>{run.executionId}</dd></>}
            {lastPlan && <><dt>Plan hash</dt><dd>{lastPlan.binding.planHash.slice(0, 16)}…</dd></>}
            <dt>Evidence snapshot</dt><dd>{inc.evidenceSnapshot}</dd>
          </dl>
        </div>

        <aside className="card dx-side dx-next" aria-labelledby="dx-next-h">
          <h2 id="dx-next-h" className="t-h2" style={{ fontSize: 16 }}>What next?</h2>
          <div role="radiogroup" aria-labelledby="dx-next-h" className="col gap-3" onKeyDown={onKey}>
            {opts.map((o) => (
              <RadioCard key={o.k} name={o.k} checked={pick === o.k} onSelect={() => setPick(o.k)} recommended={o.recommended} title={o.title} body={o.body} meta={o.meta} />
            ))}
          </div>
          {next.loading && pick === 'next' && <span className="row t-small c-muted"><Spinner label="Preparing the next plan" />Preparing the next plan…</span>}
          {decide.error && <p className="t-small c-danger" role="alert">{decide.error.headline} · {decide.error.didNotHappen ?? 'Nothing changed.'}</p>}
          {kept && pick === 'keep' && <p className="t-small c-ok" role="status">Kept as partly fixed · nothing changed.</p>}
          <Button
            variant="primary" size="lg" onClick={act} style={{ marginTop: 'auto' }}
            disabled={!!cur.disabled || decide.busy || (pick === 'keep' && (!run || kept))}
            aria-describedby={cur.disabled ? 'dx-next-why' : undefined}
          >{decide.busy ? 'Saving…' : cur.cta}</Button>
          {cur.disabled && <span id="dx-next-why" className="t-small c-warn">{cur.disabled}</span>}
          <span className="t-small c-subtle">Every option that changes something goes through its own plan and approval.</span>
        </aside>
      </div>
    </Page>
  );
}

function riskLine(risk: string | undefined, admin: boolean, reboot: boolean) {
  return [risk ? `${risk} risk` : '', admin ? 'admin' : 'no admin', reboot ? '1 restart' : 'no restart'].filter(Boolean).join(' · ');
}

const CHECK_WORD: Record<VerificationResult['state'], string> = { pass: 'Passed', fail: 'Failed', pending: 'Not run — an earlier check failed', running: 'Checking…' };

function CheckRow({ c }: { c: VerificationResult }) {
  const tone = c.state === 'pass' ? 'pass' : c.state === 'fail' ? 'fail' : 'pending';
  return (
    <li className={`dx-check ${tone}`}>
      <span className={`dx-check-icon ${tone}`} aria-hidden="true">{c.state === 'pass' ? <Icon name="check" size={15} /> : c.state === 'fail' ? <Icon name="close" size={15} /> : null}</span>
      <span className="col grow" style={{ gap: 4 }}>
        <span style={{ fontSize: 14 }}>{c.label} <span className="mono c-subtle" style={{ fontSize: 11 }}>{c.tier}</span></span>
        {c.detail && c.state === 'fail' && <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>{c.detail}</span>}
      </span>
      <span className={`t-small ${tone === 'pass' ? 'c-ok' : tone === 'fail' ? 'c-danger' : 'c-subtle'}`} style={{ fontWeight: 600 }}>{CHECK_WORD[c.state]}</span>
    </li>
  );
}
