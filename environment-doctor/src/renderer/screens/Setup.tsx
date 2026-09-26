/** Board 12 · Set up (dry run). Blueprint + OS → install/update/keep plan; every change still goes through 06 Plan & approval. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ApiError, OsKind, SetupDryRun, SetupRow, SetupRowKind } from '../../shared/contracts';
import { call } from '../api/client';
import { useApp } from '../AppContext';
import { Icon } from '../components/Icon';
import { Page } from '../components/Shell';
import { Card, EmptyState, ErrorState, LinkButton, LoadingState, RadioCard, SegmentedControl, Skeleton } from '../components/ui';
import { useApi } from '../hooks/useApi';
import '../styles/library.css';

const OS_OPTIONS: { value: OsKind; label: string }[] = [{ value: 'windows', label: 'Windows' }, { value: 'macos', label: 'macOS' }, { value: 'linux', label: 'Linux' }];
const KIND_LABEL: Record<SetupRowKind, string> = { install: 'Install', update: 'Update', keep: 'Keep', skip: 'Skip', blocked: 'Blocked' };
const isOs = (v: string | null): v is OsKind => v === 'windows' || v === 'macos' || v === 'linux';

function formatSize(mb: number) {
  if (mb <= 0) return 'Nothing to download';
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb} MB`;
}

function Signature({ row }: { row: SetupRow }) {
  // Only rows that would download something carry a meaningful signature.
  if (row.kind === 'keep' || row.kind === 'skip') return null;
  if (row.signature === 'verified') return <span className="row c-ok t-small" style={{ gap: 5 }}><Icon name="shieldCheck" size={13} />Signed</span>;
  if (row.signature === 'unsigned') return <span className="lib-tag warn">This package couldn’t be verified</span>;
  return <span className="lib-tag unknown">Signature not checked</span>;
}

function RowView({ row }: { row: SetupRow }) {
  const version = row.current && row.target && row.current !== row.target ? `${row.current} → ${row.target}` : row.target ?? row.current ?? '—';
  return (
    <tr className={`lib-setup-row ${row.newSource ? 'newsource' : ''}`} data-row={row.id}>
      <td><span className={`lib-kind ${row.kind}`}>{KIND_LABEL[row.kind]}</span></td>
      <th scope="row">
        <span className="col" style={{ gap: 3 }}>
          <span className="row wrap" style={{ gap: 8, fontSize: 13.5 }}>
            <span data-testid="setup-row-name">{row.name}</span>
            {row.admin && row.kind !== 'keep' && row.kind !== 'skip' && <span className="chip admin">Admin</span>}
            {row.restart && row.kind !== 'keep' && row.kind !== 'skip' && <span className="lib-tag"><Icon name="restart" size={11} />Restart</span>}
            {row.newSource && <span className="chip warn"><Icon name="alert" size={12} />New source — needs your approval</span>}
          </span>
          {row.note && <span className={`t-small ${row.kind === 'blocked' ? 'c-danger' : row.kind === 'skip' ? 'c-accent' : 'c-subtle'}`}>{row.note}</span>}
        </span>
      </th>
      <td className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>{version}</td>
      <td>
        <span className="col" style={{ gap: 3 }}>
          <span className="t-small c-muted">{row.source}{row.publisher && row.publisher !== '—' && row.publisher !== row.source ? ` · ${row.publisher}` : ''}</span>
          <Signature row={row} />
        </span>
      </td>
    </tr>
  );
}

export default function Setup() {
  const { machine } = useApp();
  const [params, setParams] = useSearchParams();
  const blueprints = useApi('blueprints.list', undefined);
  const osParam = params.get('os');
  const os: OsKind = isOs(osParam) ? osParam : machine?.os ?? 'windows';
  const bp = params.get('blueprint') ?? blueprints.data?.[0]?.id ?? '';

  const choose = (next: { blueprint?: string; os?: OsKind }) => {
    setParams({ blueprint: next.blueprint ?? bp, os: next.os ?? os }, { replace: true });
  };

  const [dry, setDry] = useState<SetupDryRun | null>(null);
  const [incidentId, setIncidentId] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const runDry = useCallback(async () => {
    if (!bp) return;
    const n = ++seq.current;
    setLoading(true);
    setError(null);
    const r = await call('setup.dryRun', { blueprintId: bp, os });
    if (n !== seq.current) return;
    if (!r.ok) { setError(r.error); setLoading(false); return; }
    let inc: string | null = null;
    if (r.data.planId) {
      const p = await call('plan.get', { id: r.data.planId });
      if (n !== seq.current) return;
      if (p.ok) inc = p.data.incidentId;
      else { setError(p.error); setLoading(false); return; }
    }
    setDry(r.data);
    setIncidentId(inc);
    setLoading(false);
  }, [bp, os]);
  useEffect(() => { void runDry(); }, [runDry]);

  const groups = useMemo(() => {
    const out: { name: string; rows: SetupRow[] }[] = [];
    for (const r of dry?.rows ?? []) {
      const g = out.find((x) => x.name === r.group);
      if (g) g.rows.push(r); else out.push({ name: r.group, rows: [r] });
    }
    return out;
  }, [dry]);

  const bpName = blueprints.data?.find((b) => b.id === bp)?.name;
  const changes = dry ? dry.totals.install + dry.totals.update : 0;
  const stale = loading || (dry && (dry.blueprintId !== bp || dry.os !== os));

  const onBpKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const list = blueprints.data ?? [];
    if (!list.length || !['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const i = Math.max(0, list.findIndex((b) => b.id === bp));
    const n = (i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
    choose({ blueprint: list[n].id });
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[n]?.focus();
  };

  return (
    <Page
      crumbs={[{ label: 'Set up' }]}
      actions={<SegmentedControl role="radiogroup" label="Operating system" value={os} onChange={(v) => choose({ os: v })} options={OS_OPTIONS} />}
    >
      <div className="col" style={{ gap: 6 }}>
        <h1 className="t-h1">Set up this machine for a project</h1>
        <p className="c-muted" style={{ fontSize: 14 }}>We check first, install only what’s missing, and prove it works afterwards. It uses the package managers you already have.</p>
      </div>

      {blueprints.error && <ErrorState error={blueprints.error} onRetry={blueprints.reload} />}
      {blueprints.loading && !blueprints.data && <div className="lib-grid-4"><Skeleton h={78} /><Skeleton h={78} /><Skeleton h={78} /><Skeleton h={78} /></div>}
      {blueprints.data && (
        <div className="lib-grid-4" role="radiogroup" aria-label="Blueprint" onKeyDown={onBpKey}>
          {blueprints.data.map((b) => <RadioCard key={b.id} name={b.id} checked={b.id === bp} onSelect={() => choose({ blueprint: b.id })} title={b.name} body={b.description} />)}
        </div>
      )}

      {error && <ErrorState error={error} onRetry={runDry} retryLabel="Run the dry run again" />}
      {!error && !dry && bp && <LoadingState label="Checking what’s already on this machine…" />}

      {!error && dry && (
        <div className="lib-two">
          <Card className={`lib-main lib-flush ${stale ? 'lib-busy' : ''}`} aria-busy={stale ? true : undefined} aria-labelledby="setup-dry-title">
            <div className="lib-flush-head">
              <div className="col" style={{ gap: 2 }}>
                <h2 className="t-title" id="setup-dry-title">Dry run — nothing is installed yet</h2>
                <span className="t-small c-subtle">{bpName ?? dry.blueprintId} · {OS_OPTIONS.find((o) => o.value === dry.os)?.label}</span>
              </div>
              <span className="t-small c-subtle" aria-live="polite">{stale ? 'Checking…' : `${dry.rows.length} items checked`}</span>
            </div>
            {dry.rows.length === 0
              ? <EmptyState title="Nothing in this blueprint applies here" body="No tools were found for this operating system." />
              : (
                <table className="table lib-table lib-setup-table">
                  <thead><tr><th scope="col">Action</th><th scope="col">What</th><th scope="col">Version</th><th scope="col">From</th></tr></thead>
                  {groups.map((g) => (
                    <tbody key={g.name}>
                      <tr className="lib-group"><th scope="colgroup" colSpan={4} className="t-overline">{g.name}</th></tr>
                      {g.rows.map((r) => <RowView key={r.id} row={r} />)}
                    </tbody>
                  ))}
                </table>
              )}
          </Card>

          <aside className="lib-side" aria-label="Summary">
            <Card>
              <h2 className="t-title">Summary</h2>
              <div className="lib-grid-3">
                <div className="lib-tile"><span className="num c-accent">{dry.totals.install}</span><span className="lbl">to install</span></div>
                <div className="lib-tile"><span className="num c-warn">{dry.totals.update}</span><span className="lbl">to update</span></div>
                <div className="lib-tile"><span className="num c-ok">{dry.totals.keep}</span><span className="lbl">already fine</span></div>
              </div>
              {(dry.totals.skip > 0 || dry.totals.blocked > 0) && (
                <div className="row gap-3 t-small c-muted">
                  {dry.totals.skip > 0 && <span>{dry.totals.skip} skipped</span>}
                  {dry.totals.blocked > 0 && <span className="c-danger">{dry.totals.blocked} blocked</span>}
                </div>
              )}
              <div className="lib-line"><span>Download</span><span>{formatSize(dry.downloadMb)}</span></div>
              <div className="lib-line"><span>Restart needed</span><span>{dry.needsRestart ? 'Yes' : 'No'}</span></div>
              <div className="lib-line"><span>Needs admin</span><span>{dry.needsAdmin ? `Yes — ${dry.os === 'windows' ? 'Windows' : dry.os === 'macos' ? 'macOS' : 'the system'} will ask` : 'No'}</span></div>
            </Card>

            {dry.isolationNote && (
              <div className="lib-callout accent"><Icon name="sparkle" size={16} /><span>{dry.isolationNote}</span></div>
            )}

            {dry.newSources.length > 0
              ? (
                <div className="lib-callout warn" role="note" aria-label="New package sources">
                  <Icon name="alert" size={16} />
                  <span>
                    <strong>{dry.newSources.length === 1 ? 'A new package source is needed' : `${dry.newSources.length} new package sources are needed`}</strong>
                    <ul>{dry.newSources.map((s) => <li key={s}>{s}</li>)}</ul>
                    Nothing is added without your explicit approval. You’ll see it again on the plan before anything is installed — sources are never added silently.
                  </span>
                </div>
              )
              : <div className="lib-callout ok"><Icon name="shieldCheck" size={16} /><span>No new package sources will be added.</span></div>}

            {dry.planId && incidentId
              ? (
                <div className="col gap-1">
                  <LinkButton to={`/incidents/${encodeURIComponent(incidentId)}/plan?planId=${encodeURIComponent(dry.planId)}`} variant="primary" size="lg" icon="arrowRight" aria-disabled={stale ? true : undefined} onClick={(e) => { if (stale) e.preventDefault(); }}>
                    Review plan
                  </LinkButton>
                  <span className="t-small c-subtle">{changes} change{changes === 1 ? '' : 's'} to review. You’ll see every step, what needs admin and exactly what you’re approving before anything runs.</span>
                </div>
              )
              : <NoPlan dry={dry} />}
          </aside>
        </div>
      )}
    </Page>
  );
}

function NoPlan({ dry }: { dry: SetupDryRun }) {
  const changes = dry.totals.install + dry.totals.update;
  if (changes === 0 && dry.totals.blocked === 0) {
    return <div className="lib-callout ok" role="status"><Icon name="check" size={16} /><span><strong>Everything is already in place</strong><br />Nothing needs installing or updating for this blueprint.</span></div>;
  }
  if (changes === 0) {
    return <div className="lib-callout warn" role="status"><Icon name="alert" size={16} /><span><strong>Nothing can be installed yet</strong><br />{dry.totals.blocked} item{dry.totals.blocked === 1 ? ' is' : 's are'} blocked. Fix what blocks {dry.totals.blocked === 1 ? 'it' : 'them'} first — the note on each row says what.</span></div>;
  }
  return (
    <div className="col gap-3">
      <div className="lib-callout" role="status"><Icon name="info" size={16} /><span><strong>No new plan</strong><br />A setup for this blueprint already ran or is waiting. Open it from Incidents.</span></div>
      <LinkButton to="/incidents" icon="arrowRight">Open Incidents</LinkButton>
    </div>
  );
}
