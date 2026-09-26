/** Board 03 · Live scan: read-only, live results per area; Stop keeps partial results and marks the rest Unknown. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { ApiError, ScanItem, ScanProgress, ScanScope } from '../../shared/contracts';
import { call } from '../api/client';
import { Icon } from '../components/Icon';
import { Page } from '../components/Shell';
import { Button, Card, ErrorState, LinkButton, LoadingState, ProgressRing, Spinner, StatusDot } from '../components/ui';
import { useStream } from '../hooks/useApi';
import '../styles/start.css';

const COLUMNS: { key: ScanScope; name: string }[] = [
  { key: 'pc', name: 'This PC' },
  { key: 'dev', name: 'Dev tools' },
  { key: 'proj', name: 'Projects' },
];
const FULL: ScanScope[] = ['pc', 'dev', 'proj'];
const FINDING_WORD = { ok: 'Healthy', warn: 'Attention', fail: 'Failing', unknown: 'Unknown' } as const;

const finished = (s: ScanProgress) => s.items.filter((i) => i.state === 'done' || i.state === 'skipped').length;

/** Stream events and replies can arrive out of order; never let an older snapshot overwrite a newer one. */
function newer(prev: ScanProgress | null, next: ScanProgress): ScanProgress {
  if (!prev) return next;
  if (prev.scanId !== next.scanId) return next.scanId > prev.scanId ? next : prev;
  if (prev.state !== 'running' && next.state === 'running') return prev;
  if (prev.state === 'running' && next.state === 'running' && finished(next) < finished(prev)) return prev;
  return next;
}

function ItemRow({ it }: { it: ScanItem }) {
  let slot;
  let res: React.ReactNode = '';
  let cls = '';
  if (it.state === 'waiting') { slot = <span className="wait-dot" aria-hidden="true" />; res = <span className="sr-only">Waiting</span>; }
  else if (it.state === 'running') { slot = <Spinner label={`Checking ${it.name}`} />; res = 'checking…'; }
  else if (it.state === 'skipped') { slot = <StatusDot status="unknown" />; res = 'Not checked'; cls = 'unknown'; }
  else { const st = it.status ?? 'unknown'; slot = <StatusDot status={st} />; res = it.result ?? ''; cls = st; }
  return (
    <li className={it.state} data-state={it.state} data-status={it.state === 'skipped' ? 'unknown' : it.status}>
      <span className="slot">{slot}</span>
      <span className="grow">{it.name}</span>
      <span className={`res ${cls}`}>{res}</span>
    </li>
  );
}

export default function Scan() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const wantStart = params.get('start') === '1';
  const [scan, setScan] = useState<ScanProgress | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<'start' | 'stop' | null>(null);
  const booted = useRef(false);

  const apply = useCallback((s: ScanProgress | null) => { if (s) setScan((p) => newer(p, s)); }, []);
  useStream('scan.progress', apply);

  const start = useCallback(async () => {
    setBusy('start');
    setError(null);
    const r = await call('scan.start', { scopes: FULL });
    if (!r.ok) { setError(r.error); setBusy(null); return; }
    const g = await call('scan.get');
    if (g.ok) apply(g.data);
    setBusy(null);
  }, [apply]);

  const boot = useCallback(async () => {
    setError(null);
    const g = await call('scan.get');
    if (!g.ok) { setError(g.error); return; }
    const cur = g.data;
    if (cur?.state === 'running') apply(cur); // attach to the scan already running
    else if (wantStart || !cur) await start();
    else apply(cur);
    // Drop ?start=1 so Back or a reload doesn't start yet another scan.
    if (wantStart) nav('/scan', { replace: true });
  }, [apply, nav, start, wantStart]);

  useEffect(() => {
    if (!booted.current) { booted.current = true; void boot(); return; }
    // Already on this screen and asked again (e.g. “Run a full scan” from the palette).
    if (wantStart) void start().then(() => nav('/scan', { replace: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantStart]);

  const stop = async () => {
    if (!scan) return;
    setBusy('stop');
    const r = await call('scan.stop', { scanId: scan.scanId });
    if (r.ok) apply(r.data); else setError(r.error);
    setBusy(null);
  };

  const crumbs = [{ label: 'Overview', to: '/' }, { label: 'Scan' }];
  const actions = <span className="row t-small c-muted" style={{ gap: 8 }}><Icon name="eye" size={15} />Looking only — nothing on your PC changes</span>;

  if (error && !scan) return <Page crumbs={crumbs} actions={actions}><ErrorState error={error} onRetry={() => void boot()} /></Page>;
  if (!scan) return <Page crumbs={crumbs} actions={actions}><LoadingState label="Starting the read-only scan…" /></Page>;

  const running = scan.state === 'running';
  const stopped = scan.state === 'stopped';
  const complete = scan.state === 'complete';
  const cols = COLUMNS.filter((c) => scan.items.some((i) => i.column === c.key));
  const notChecked = scan.items.filter((i) => i.state === 'skipped').length;
  const pct = Math.round(scan.percent);

  return (
    <Page crumbs={crumbs} actions={actions}>
      <Card className={`scan-hero ${complete ? 'done' : ''}`} aria-labelledby="scan-h">
        <ProgressRing value={pct} size={92} stroke={7} color={complete ? 'var(--ok)' : stopped ? 'var(--muted)' : undefined} label="Scan progress">
          {pct}%
        </ProgressRing>
        <div className="col grow" style={{ gap: 6 }} aria-live="polite">
          <h1 id="scan-h" className="t-h1" style={{ fontSize: 24 }}>{scan.headline}</h1>
          <p className="c-muted" style={{ fontSize: 14 }}>{running ? scan.current : scan.subline}</p>
          {stopped && notChecked > 0 && (
            <span className="unknown-line"><span className="dot unknown" aria-hidden="true" />{notChecked} not checked — marked Unknown, never healthy</span>
          )}
          <span className="sr-only">{running ? `Scan ${pct}% done` : complete ? 'Scan finished' : 'Scan stopped'}</span>
        </div>
        <div className="row gap-3">
          {running && <Button icon="stop" onClick={() => void stop()} disabled={busy === 'stop'}>{busy === 'stop' ? 'Stopping…' : 'Stop scan'}</Button>}
          {!running && <Button icon="restart" onClick={() => void start()} disabled={busy === 'start'}>Scan again</Button>}
          {!running && <LinkButton to="/incidents" variant="secondary">Open incidents</LinkButton>}
          {!running && <LinkButton to="/" variant="primary" icon="arrowRight">{stopped ? 'See partial results' : 'See results'}</LinkButton>}
        </div>
      </Card>

      {error && <ErrorState error={error} compact />}

      <div className="grid-3" style={{ gap: 14, alignItems: 'start' }}>
        {cols.map((c) => {
          const items = scan.items.filter((i) => i.column === c.key);
          const done = items.filter((i) => i.state === 'done').length;
          return (
            <section key={c.key} className="card scan-col" aria-labelledby={`scan-col-${c.key}`} data-column={c.key}>
              <div className="scan-col-head">
                <h2 id={`scan-col-${c.key}`}>{c.name}</h2>
                <span className="mono t-small c-subtle" aria-label={`${done} of ${items.length} checked`}>{done} / {items.length}</span>
              </div>
              <ul className="scan-items">{items.map((it) => <ItemRow key={it.id} it={it} />)}</ul>
            </section>
          );
        })}
      </div>

      <section className="card inset scan-found" aria-label="Found so far">
        <span className="t-overline" style={{ fontSize: 12 }}>{running ? 'Found so far' : 'Found'}</span>
        {scan.findings.length === 0 && <span className="t-small c-subtle">{running ? 'Nothing yet' : 'No problems found'}</span>}
        {scan.findings.map((f) => {
          const cls = `chip ${f.status === 'ok' ? 'ok' : f.status}`;
          const body = <>{f.status !== 'unknown' && <span className={`dot ${f.status}`} aria-hidden="true" />}<span className="sr-only">{FINDING_WORD[f.status]}: </span>{f.text}</>;
          return f.incidentId
            ? <Link key={f.id} to={`/incidents/${encodeURIComponent(f.incidentId)}`} className={cls}>{body}</Link>
            : <span key={f.id} className={cls}>{body}</span>;
        })}
      </section>

      <p className="t-small c-subtle row" style={{ gap: 8 }}>
        <Icon name="shieldCheck" size={15} />
        A scan only reads. It never installs, deletes or changes settings — fixes always go through a plan you approve.
      </p>
    </Page>
  );
}
