/** Board 02 · Home: three pillars (PC, dev tools, projects), what needs you, and the ways in (scan, describe, set up). */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CheckStatus, HealthRow, Pillar } from '../../shared/contracts';
import { useApp } from '../AppContext';
import { Icon, type IconName } from '../components/Icon';
import { Page } from '../components/Shell';
import { EmptyState, LinkButton, LoadingState, ProgressRing, SegmentedControl, StatusChip, StatusDot, timeAgo } from '../components/ui';
import { useApi } from '../hooks/useApi';
import '../styles/start.css';

type Filter = 'all' | 'problems';

const PILLARS: { key: Pillar['key']; name: string; sub: string; icon: IconName }[] = [
  { key: 'pc', name: 'This PC', sub: 'Stability, drivers, hardware', icon: 'monitor' },
  { key: 'dev', name: 'Dev tools', sub: 'Runtimes, PATH, SDKs', icon: 'terminal' },
  { key: 'proj', name: 'Projects', sub: 'What each one needs', icon: 'folder' },
];

const isProblem = (s: CheckStatus) => s === 'warn' || s === 'fail';
/** “Problems only” shows everything that is not known-healthy — unknown is never healthy (UI rule 9). */
const needsLook = (s: CheckStatus) => s !== 'ok';
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

function rowTarget(r: HealthRow): string | null {
  if (r.incidentId) return `/incidents/${encodeURIComponent(r.incidentId)}`;
  if (r.projectId) return `/projects/${encodeURIComponent(r.projectId)}`;
  return null;
}

function PillarCard({ meta, pillar, filter }: { meta: (typeof PILLARS)[number]; pillar?: Pillar; filter: Filter }) {
  const headId = `pillar-${meta.key}`;
  const rows = pillar?.rows ?? [];
  const shown = filter === 'problems' ? rows.filter((r) => needsLook(r.status)) : rows;
  const issues = rows.filter((r) => isProblem(r.status)).length;
  const fails = rows.filter((r) => r.status === 'fail').length;
  const unknown = rows.filter((r) => r.status === 'unknown').length;
  let badge;
  if (!pillar) badge = <StatusChip status="unknown" label="Not scanned" />;
  else if (issues) badge = <StatusChip status={fails ? 'fail' : 'warn'} label={plural(issues, 'issue')} />;
  else if (unknown) badge = <StatusChip status="unknown" label={`${unknown} not checked`} />;
  else badge = <StatusChip status="ok" label="Healthy" />;

  return (
    <section className="card pillar" aria-labelledby={headId} data-pillar={meta.key}>
      <div className="pillar-head">
        <span className="tint-icon neutral sm"><Icon name={meta.icon} size={18} /></span>
        <span className="col grow" style={{ gap: 2 }}>
          <h3 id={headId}>{pillar?.name ?? meta.name}</h3>
          <span className="t-small c-subtle">{pillar?.sub ?? meta.sub}</span>
        </span>
        {badge}
      </div>
      {!pillar && (
        <div className="pillar-empty unknown"><span className="dot unknown" aria-hidden="true" />Not scanned yet — not counted as healthy</div>
      )}
      {pillar && shown.length > 0 && (
        <ul className="pillar-list">
          {shown.map((r) => {
            const to = rowTarget(r);
            const inner = (
              <>
                <StatusDot status={r.status} />
                <span className="grow">{r.name}</span>
                <span className={`note ${r.status}`}>{r.note}</span>
              </>
            );
            return (
              <li key={r.id} data-status={r.status}>
                {to ? <Link to={to} className="list-row">{inner}</Link> : <div className="list-row">{inner}</div>}
              </li>
            );
          })}
        </ul>
      )}
      {pillar && shown.length === 0 && (
        <div className="pillar-empty"><Icon name="check" size={15} stroke={2.2} />No problems here</div>
      )}
    </section>
  );
}

export default function Home() {
  const { health, refresh } = useApp();
  const [filter, setFilter] = useState<Filter>('all');
  const incidents = useApi('incidents.list', undefined);
  const settings = useApi('settings.get', undefined);

  useEffect(() => { void refresh(); }, [refresh]);

  const summary = useMemo(() => {
    const rows = health?.pillars.flatMap((p) => p.rows) ?? [];
    const problemRows = rows.filter((r) => isProblem(r.status)).sort((a, b) => (a.status === 'fail' ? 0 : 1) - (b.status === 'fail' ? 0 : 1));
    // One problem = one incident (several rows can share a cause) or one row without an incident yet.
    const ids: string[] = [];
    let loose = 0;
    for (const r of problemRows) {
      if (!r.incidentId) loose++;
      else if (!ids.includes(r.incidentId)) ids.push(r.incidentId);
    }
    const titles = ids.map((id) => incidents.data?.find((i) => i.id === id)?.title).filter((t): t is string => !!t);
    const shared = ids.filter((id) => problemRows.filter((r) => r.incidentId === id).length > 1).length;
    const ok = rows.filter((r) => r.status === 'ok').length;
    return { rows, problems: ids.length + loose, titles, looseRows: problemRows.filter((r) => !r.incidentId), shared, ok };
  }, [health, incidents.data]);

  if (!health) return <Page crumbs={[{ label: 'Overview' }]}><LoadingState label="Loading your PC’s health…" /></Page>;

  const runScan = <LinkButton to="/scan?start=1" variant="primary" size="sm" icon="play">Run scan</LinkButton>;

  if (!health.lastScanAt) {
    return (
      <Page crumbs={[{ label: 'Overview' }]} actions={runScan}>
        <EmptyState
          icon="search" title="No scan yet"
          body="Run a read-only scan to see how your PC, dev tools and projects are doing. Nothing changes during a scan."
          action={<LinkButton to="/scan?start=1" variant="primary" size="lg" icon="play">Run first scan</LinkButton>}
        />
      </Page>
    );
  }

  const { problems, titles, looseRows, shared, ok, rows } = summary;
  const unknown = health.unknownCount;
  const headline = problems > 0
    ? `${plural(problems, 'problem')} need${problems === 1 ? 's' : ''} you`
    : unknown > 0 ? 'No problems in what was checked' : 'Everything checked is healthy';
  const parts = [...titles, ...looseRows.map((r) => `${r.name}: ${r.note}`)];
  const sub = problems > 0
    ? `${parts.slice(0, 3).join(' · ')}${parts.length > 3 ? ` · and ${parts.length - 3} more` : ''}.${shared ? ' Some share a cause, so one fix can clear several rows.' : ''}`
    : 'Nothing needs you right now. Run a scan any time — it only looks, nothing changes.';
  const aiMode = settings.data?.privacy.aiMode;
  const aiLabel = aiMode === 'local' ? 'AI on this PC' : aiMode === 'cloud' ? 'AI: cloud when needed' : aiMode === 'off' ? 'AI off' : null;
  const okPct = rows.length ? (ok / rows.length) * 100 : 0;

  return (
    <Page
      crumbs={[{ label: <>Overview <span className="c-subtle t-small">· scanned <time dateTime={health.lastScanAt}>{timeAgo(health.lastScanAt)}</time></span></> }]}
      actions={<>{aiLabel && <Link to="/settings/privacy" className="chip neutral" style={{ textDecoration: 'none' }}>{aiLabel}</Link>}{runScan}</>}
    >
      <div className="home-hero">
        <section className="card" aria-labelledby="home-h">
          <ProgressRing value={okPct} size={104} stroke={8} color="var(--ok)" label={`${ok} of ${rows.length} checks healthy. Unknown items are not counted as healthy.`}>
            <span className="big">{ok}</span><span className="small">of {rows.length} healthy</span>
          </ProgressRing>
          <div className="col grow" style={{ gap: 10, minWidth: 0 }}>
            <h1 id="home-h" className="home-headline">{headline}</h1>
            <p className="c-muted" style={{ fontSize: 14, lineHeight: 1.5 }}>{sub}</p>
            {unknown > 0 && (
              <span className="unknown-line"><span className="dot unknown" aria-hidden="true" />{unknown} not checked — not counted as healthy</span>
            )}
            <Link to="/diagnose" className="home-describe">
              <Icon name="search" size={15} />
              <span className="grow">Something else wrong? Describe a problem…</span>
              <span className="cta">Diagnose</span>
            </Link>
          </div>
        </section>
        <Link to="/setup" className="home-setup">
          <span className="tint-icon accent sm"><Icon name="package" size={18} /></span>
          <span className="t-title" style={{ fontSize: 16 }}>Set up a project or new PC</span>
          <span className="t-small c-muted" style={{ fontSize: 13 }}>Dry run first. Installs only what’s missing, then proves it works.</span>
          <span className="cta">Start setup<Icon name="arrowRight" size={14} /></span>
        </Link>
      </div>

      <div className="row between">
        <h2 className="t-title">Health by area</h2>
        <SegmentedControl<Filter>
          label="Filter health rows" value={filter} onChange={setFilter}
          options={[{ value: 'all', label: 'All' }, { value: 'problems', label: 'Problems only' }]}
        />
      </div>

      <div className="grid-3" style={{ gap: 14, alignItems: 'start' }}>
        {PILLARS.map((m) => <PillarCard key={m.key} meta={m} pillar={health.pillars.find((p) => p.key === m.key)} filter={filter} />)}
      </div>
    </Page>
  );
}
