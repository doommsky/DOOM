/** Verified / closed incidents: a compact summary (root cause, what ran, verification, watch window). */
import type { RunProgress } from '../../../shared/contracts';
import { Page } from '../../components/Shell';
import { Icon } from '../../components/Icon';
import { ConfidenceMeter, IncidentStatusChip, LinkButton, journalLabel } from '../../components/ui';
import { EvidenceIds, IconBox, IncidentMeta, incidentCrumbs, type ViewProps } from './shared';

const STEP_WORD: Record<RunProgress['steps'][number]['state'], string> = { pending: 'Not run', running: 'Running', done: 'Ran', failed: 'Didn’t finish', skipped: 'Skipped', not_run: 'Did not run' };

export function ResolvedSummary({ inc, run }: ViewProps) {
  const verified = inc.status === 'verified';
  const checks = run?.verification ?? [];
  const allPass = checks.length > 0 && checks.every((c) => c.state === 'pass');
  return (
    <Page
      crumbs={incidentCrumbs(inc.id)}
      actions={<><IncidentStatusChip status={inc.status} /><LinkButton to="/history" size="sm" icon="history">See it in History</LinkButton></>}
    >
      <section className="dx-head" aria-label="Incident">
        <div className="dx-head-main">
          <IconBox icon={verified ? 'shieldCheck' : 'archive'} tone={verified ? 'ok' : 'neutral'} />
          <div className="col" style={{ gap: 8, minWidth: 0 }}>
            <h1 className="dx-title">{inc.title}</h1>
            <IncidentMeta inc={inc} extra={<span>{verified ? 'Verified' : 'Closed'} <time dateTime={inc.updatedAt}>{new Date(inc.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</time></span>} />
          </div>
        </div>
      </section>

      <div className="grid-2 dx-summary">
        <section className="card" aria-labelledby="dx-sum-rc">
          <div className="row between"><h2 id="dx-sum-rc" className="t-title">Root cause</h2>{inc.rootCause && <ConfidenceMeter value={inc.rootCause.confidence} />}</div>
          {inc.rootCause
            ? <>
              <p style={{ fontSize: 15 }}>{inc.rootCause.title}</p>
              {inc.rootCause.detail && <p className="t-small c-muted">{inc.rootCause.detail}</p>}
              {inc.rootCause.evidenceIds.length > 0 && <EvidenceIds ids={inc.rootCause.evidenceIds} />}
            </>
            : <p className="t-small c-muted">{verified ? 'No root cause was recorded.' : 'Closed without a confirmed root cause. Nothing on this PC was changed by closing it.'}</p>}
        </section>

        <section className="card" aria-labelledby="dx-sum-ran">
          <h2 id="dx-sum-ran" className="t-title">What ran</h2>
          {run
            ? <>
              <ul className="dx-sum-list">
                {run.steps.map((s) => (
                  <li key={s.id} className="row gap-3">
                    <Icon name={s.state === 'done' ? 'check' : 'close'} size={15} className={s.state === 'done' ? 'c-ok' : 'c-subtle'} />
                    <span className="grow">{s.title}</span>
                    <span className="t-small c-subtle">{STEP_WORD[s.state]}</span>
                  </li>
                ))}
              </ul>
              <span className="t-small c-subtle">Journal: <span className="mono">{run.state}</span> · {journalLabel(run.state)} · exit codes are information, not proof.</span>
            </>
            : <p className="t-small c-muted">No repair record from this PC for this incident.</p>}
        </section>

        <section className="card" aria-labelledby="dx-sum-ver">
          <div className="row between"><h2 id="dx-sum-ver" className="t-title">Verification</h2>{verified && allPass && <span className="chip ok"><span className="dot ok" aria-hidden="true" />Every check passed</span>}</div>
          {checks.length
            ? <ul className="dx-sum-list">
              {checks.map((c) => (
                <li key={c.id} className="row gap-3">
                  <Icon name={c.state === 'pass' ? 'check' : 'close'} size={15} className={c.state === 'pass' ? 'c-ok' : 'c-danger'} />
                  <span className="grow">{c.label} <span className="mono c-subtle" style={{ fontSize: 11 }}>{c.tier}</span></span>
                  <span className={`t-small ${c.state === 'pass' ? 'c-ok' : c.state === 'fail' ? 'c-danger' : 'c-subtle'}`}>{c.state === 'pass' ? 'Passed' : c.state === 'fail' ? 'Failed' : 'Not run'}</span>
                </li>
              ))}
            </ul>
            : <p className="t-small c-muted">No verification results are stored for this incident on this PC.</p>}
        </section>

        <section className="card" aria-labelledby="dx-sum-watch">
          <h2 id="dx-sum-watch" className="t-title">Watch window</h2>
          {run?.watch
            ? <p className="row gap-3"><Icon name="eye" size={16} className="c-accent" /><span>{run.watch.label} · until <time dateTime={run.watch.until}>{new Date(run.watch.until).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></span></p>
            : <p className="t-small c-muted">Nothing is being watched for this incident.</p>}
          <span className="t-small c-subtle">If the problem comes back, it opens a new incident with fresh evidence.</span>
        </section>
      </div>

      <div className="row gap-3">
        <LinkButton to="/history" icon="history">Open History</LinkButton>
        <LinkButton to="/incidents" variant="ghost">Back to incidents</LinkButton>
      </div>
    </Page>
  );
}
