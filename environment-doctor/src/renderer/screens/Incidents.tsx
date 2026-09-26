/** Board 17 · Incidents: every problem, its likely cause, where it lives, and whether it was proven fixed. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { IncidentStatus, IncidentSummary } from '../../shared/contracts';
import { useApp } from '../AppContext';
import { Icon } from '../components/Icon';
import { Page } from '../components/Shell';
import { Button, Card, ConfidenceMeter, EmptyState, ErrorState, IncidentStatusChip, LinkButton, LoadingState, PageTitle, SegmentedControl, timeAgo } from '../components/ui';
import { useApi } from '../hooks/useApi';
import '../styles/start.css';

type Tab = 'open' | 'resolved' | 'all';

const isResolved = (s: IncidentStatus) => s === 'verified' || s === 'closed';
const PILLAR_NAME: Record<IncidentSummary['pillar'], string> = { pc: 'This PC', dev: 'Dev tools', proj: 'Projects' };

export default function Incidents() {
  const { health } = useApp();
  const list = useApi('incidents.list', undefined);
  const [tab, setTab] = useState<Tab>('open');
  const [q, setQ] = useState('');

  /** Where an incident lives: the project name when a project row points at it, else its area. */
  const where = useMemo(() => {
    const projRows = health?.pillars.find((p) => p.key === 'proj')?.rows ?? [];
    return (i: IncidentSummary) => (i.pillar === 'proj' ? projRows.find((r) => r.incidentId === i.id)?.name ?? PILLAR_NAME.proj : PILLAR_NAME[i.pillar]);
  }, [health]);

  const all = useMemo(() => list.data ?? [], [list.data]);
  const counts = useMemo(() => ({
    open: all.filter((i) => !isResolved(i.status)).length,
    resolved: all.filter((i) => isResolved(i.status)).length,
    all: all.length,
  }), [all]);

  const needle = q.trim().toLowerCase();
  const rows = all.filter((i) => (tab === 'all' || (tab === 'resolved') === isResolved(i.status))
    && (!needle || `${i.id} ${i.title} ${where(i)}`.toLowerCase().includes(needle)));

  const openByArea = (['pc', 'dev', 'proj'] as const).map((k) => ({ k, n: all.filter((i) => !isResolved(i.status) && i.pillar === k).length }));
  const monthAgo = Date.now() - 30 * 86400000;
  const resolvedRecent = all.filter((i) => isResolved(i.status) && new Date(i.updatedAt).getTime() >= monthAgo).length;
  const needsYou = all.filter((i) => i.status === 'open' || i.status === 'planned').length;

  const aside = (
    <>
      <Card aria-labelledby="inc-patterns">
        <div className="row gap-3">
          <span className="tint-icon accent sm"><Icon name="sparkle" size={16} /></span>
          <h2 id="inc-patterns" className="t-title">Patterns</h2>
        </div>
        <div className="pattern">
          <span className="t-small" style={{ fontWeight: 500, color: 'var(--text)', fontSize: 13 }}>Open problems by area</span>
          <ul className="col" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 4 }}>
            {openByArea.map(({ k, n }) => (
              <li key={k} className="row between t-small c-muted"><span>{PILLAR_NAME[k]}</span><span className="mono">{n}</span></li>
            ))}
          </ul>
        </div>
        <div className="pattern">
          <span className="t-small" style={{ fontWeight: 500, color: 'var(--text)', fontSize: 13 }}>{needsYou} waiting for you</span>
          <span className="t-small c-muted">Open with a diagnosis or a fix ready to review. Nothing runs until you approve a plan.</span>
        </div>
        <div className="pattern">
          <span className="t-small" style={{ fontWeight: 500, color: 'var(--text)', fontSize: 13 }}>{resolvedRecent} resolved in the last 30 days</span>
          <span className="t-small c-muted">Resolved means verified by its checks, or closed by you.</span>
        </div>
      </Card>
      <Card aria-labelledby="inc-key">
        <h2 id="inc-key" className="t-title">Status key</h2>
        <div className="key-row"><span className="dot accent" aria-hidden="true" />Needs you — waiting for a decision</div>
        <div className="key-row"><span className="dot warn" aria-hidden="true" />Investigating or partly fixed</div>
        <div className="key-row"><span className="dot ok" aria-hidden="true" />Verified — fixed and proven by checks</div>
        <div className="key-row"><span className="dot unknown" aria-hidden="true" />Unknown — an honest “we couldn’t tell”</div>
        <p className="t-small c-subtle">Confidence is a label, not a calibrated percentage.</p>
      </Card>
    </>
  );

  return (
    <Page crumbs={[{ label: 'Incidents' }]} actions={<LinkButton to="/diagnose" variant="primary" size="sm" icon="plus">Report a problem</LinkButton>} split aside={aside}>
      <PageTitle title="Incidents" sub="Every problem, what caused it, what was done, and proof it worked." />
      <div className="inc-toolbar">
        <SegmentedControl<Tab>
          label="Incident status" value={tab} onChange={setTab}
          options={[{ value: 'open', label: 'Open', count: counts.open }, { value: 'resolved', label: 'Resolved', count: counts.resolved }, { value: 'all', label: 'All', count: counts.all }]}
        />
        <label className="inc-search">
          <Icon name="search" size={15} />
          <span className="sr-only">Search incidents</span>
          <input type="search" placeholder="Search by ID, problem or project" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>

      {list.loading && !list.data && <LoadingState label="Loading incidents…" />}
      {list.error && <ErrorState error={list.error} onRetry={() => void list.reload()} />}
      {list.data && (
        <Card className="inc-card" aria-label={`${tab === 'all' ? 'All' : tab === 'open' ? 'Open' : 'Resolved'} incidents`}>
          {rows.length === 0 ? (
            <EmptyState
              icon="search" title={needle ? 'No incidents match' : tab === 'open' ? 'Nothing open' : 'No incidents here yet'}
              body={needle ? `Nothing matches “${q.trim()}” in ${tab === 'all' ? 'any incident' : `${tab} incidents`}.` : tab === 'open' ? 'No problems are waiting for you.' : undefined}
              action={needle ? <Button size="sm" onClick={() => setQ('')}>Clear search</Button> : undefined}
            />
          ) : (
            <table className="inc-table">
              <colgroup><col /><col style={{ width: 132 }} /><col style={{ width: 118 }} /><col style={{ width: 158 }} /><col style={{ width: 104 }} /></colgroup>
              <thead>
                <tr><th scope="col">Problem</th><th scope="col">Where</th><th scope="col">Cause</th><th scope="col">Status</th><th scope="col">Updated</th></tr>
              </thead>
              <tbody>
                {rows.map((i) => {
                  return (
                    <tr key={i.id} className={i.status === 'open' ? 'needs' : ''} data-incident={i.id}>
                      <td>
                        <Link to={`/incidents/${encodeURIComponent(i.id)}`} className="inc-title">{i.title}<span className="sr-only">, {i.id}</span></Link>
                        <span className="mono inc-id" aria-hidden="true">{i.id}</span>
                      </td>
                      <td className="inc-where">{where(i)}</td>
                      <td><ConfidenceMeter value={i.confidence ?? 'unknown'} showLabel /></td>
                      <td><IncidentStatusChip status={i.status} /></td>
                      <td className="t-small c-subtle"><time dateTime={i.updatedAt}>{timeAgo(i.updatedAt)}</time></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </Page>
  );
}
