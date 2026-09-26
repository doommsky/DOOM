/** Board 18 · Evidence vault. Frozen evidence, sensitivity, stored values. Secrets show presence only — never a value (UI rule 10, AC-23). */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { EvidenceItem, Sensitivity } from '../../shared/contracts';
import { Icon } from '../components/Icon';
import { Page } from '../components/Shell';
import { Card, EmptyState, ErrorState, LinkButton, LoadingState, timeAgo } from '../components/ui';
import { useApi } from '../hooks/useApi';
import '../styles/library.css';

type Filter = 'all' | 'normal' | 'partly' | 'secret';
const FILTERS: { value: Filter; label: string }[] = [{ value: 'all', label: 'All' }, { value: 'normal', label: 'Normal' }, { value: 'partly', label: 'Partly hidden' }, { value: 'secret', label: 'Secrets' }];
const bucket = (s: Sensitivity): Filter => (s === 'secret' ? 'secret' : s === 'sensitive' ? 'partly' : 'normal');
const SENS: Record<Filter, { short: string; long: string; cls: string }> = {
  all: { short: '', long: '', cls: '' },
  normal: { short: 'Normal', long: 'Normal', cls: '' },
  partly: { short: 'Partly hidden', long: 'Partly hidden', cls: 'warn' },
  secret: { short: 'Secret', long: 'Secret · presence only', cls: 'fail' },
};
const KEEP: Record<EvidenceItem['retention'], string> = { '30d': '30 days', '90d': '90 days', '1y': '1 year' };
const NEVER_READ = 'present, never read';

/** Defence in depth: a secret field only ever renders a presence placeholder, even if a value slipped through. */
const secretText = (v: string) => (/never read/i.test(v) ? v : NEVER_READ);

function fmtSize(bytes: number) {
  if (!bytes) return '—';
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}
const shortHash = (h: string) => (h.length > 16 ? `${h.slice(0, 4)}…${h.slice(-4)}` : h);
const idKind = (e: EvidenceItem) => (e.id.startsWith('T-') ? 'test' : e.sensitivity === 'secret' ? 'secret' : '');
const collectorLabel = (e: EvidenceItem) => (e.collector.includes('@') ? e.collector : `${e.collector}@${e.collectorVersion}`);

function Detail({ e }: { e: EvidenceItem }) {
  const b = bucket(e.sensitivity);
  const isSecretItem = e.sensitivity === 'secret';
  const firstIncident = e.incidentIds[0];
  return (
    <Card className="lib-main" aria-live="polite" aria-labelledby="ev-title" style={{ padding: '22px 24px', gap: 18 }}>
      <div className="row between start gap-4">
        <div className="col" style={{ gap: 6 }}>
          <span className={`mono t-small ${idKind(e) === 'test' ? 'c-ok' : idKind(e) === 'secret' ? 'c-warn' : 'c-accent'}`}>{e.id}</span>
          <h2 className="t-h2" id="ev-title">{e.title}</h2>
          <span className="t-small c-muted">Source: {e.source}</span>
        </div>
        <span className="row c-ok t-small" style={{ gap: 6, whiteSpace: 'nowrap' }}><Icon name="lock" size={13} />Frozen · can’t be changed</span>
      </div>

      <div className="lib-grid-3">
        <div className="lib-tile"><span className="lbl">Collected by</span><span className="val mono">{collectorLabel(e)}</span></div>
        <div className="lib-tile"><span className="lbl">Captured</span><span className="val" title={new Date(e.capturedAt).toLocaleString()}>{timeAgo(e.capturedAt)}</span></div>
        <div className="lib-tile"><span className="lbl">Size</span><span className="val">{fmtSize(e.size)}</span></div>
        <div className="lib-tile"><span className="lbl">Fingerprint</span><span className="val mono">{isSecretItem ? 'presence only' : shortHash(e.hash)}</span></div>
        <div className="lib-tile"><span className="lbl">Sensitivity</span><span className={`val ${SENS[b].cls === 'fail' ? 'c-danger' : SENS[b].cls === 'warn' ? 'c-warn' : ''}`}>{SENS[b].long}</span></div>
        <div className="lib-tile"><span className="lbl">Kept for</span><span className="val">{KEEP[e.retention]}</span></div>
      </div>

      <div className="col" style={{ gap: 10 }}>
        <div className="row between"><h3 className="t-title" style={{ fontSize: 14 }}>What’s stored</h3><span className="t-small c-subtle">Hidden values never leave this PC</span></div>
        <dl className="lib-stored" aria-label={`Stored fields for ${e.id}`}>
          {e.fields.map((f) => (
            <div key={f.key}>
              <dt>{f.key}</dt>
              {f.secret
                ? (
                  <dd className="secret">
                    <span className="lib-redact-bar" aria-hidden="true" />
                    <Icon name="lock" size={13} label="Locked" />
                    <span>{secretText(f.value)}</span>
                    <span className="lib-tag warn">Secret · never read</span>
                  </dd>
                )
                : <dd>{f.value}</dd>}
            </div>
          ))}
        </dl>
      </div>

      <div className="row gap-3 wrap">
        <span className="t-small c-muted">Used by</span>
        {e.incidentIds.length === 0 && <span className="t-small c-subtle">No incident yet</span>}
        {e.incidentIds.map((id) => <Link key={id} to={`/incidents/${encodeURIComponent(id)}`} className="lib-idlink">{id}</Link>)}
        <span className="grow" />
        {firstIncident && <LinkButton to={`/evidence/preview/${encodeURIComponent(firstIncident)}`} size="sm" icon="sparkle">What the AI would see</LinkButton>}
      </div>
    </Card>
  );
}

export default function Evidence() {
  const { id } = useParams();
  const list = useApi('evidence.list', {});
  const [filter, setFilter] = useState<Filter>('all');
  const items = list.data ?? [];
  const visible = items.filter((e) => filter === 'all' || bucket(e.sensitivity) === filter);
  const selected = id ? items.find((e) => e.id === id) : visible[0];
  const secretFields = items.reduce((n, e) => n + e.fields.filter((f) => f.secret).length, 0);
  const totalBytes = items.reduce((n, e) => n + e.size, 0);

  return (
    <Page crumbs={id ? [{ label: 'Evidence', to: '/evidence' }, { label: id }] : [{ label: 'Evidence' }]} actions={<span className="t-small c-subtle">Stored on this PC · frozen once captured</span>}>
      <div className="row between gap-5 wrap" style={{ alignItems: 'flex-end' }}>
        <div className="col" style={{ gap: 6 }}>
          <h1 className="t-h1">Evidence vault</h1>
          <p className="c-muted" style={{ fontSize: 14 }}>Everything we looked at, exactly as captured. Nothing here can be edited after a diagnosis uses it.</p>
        </div>
        {items.length > 0 && (
          <div className="row gap-3">
            <div className="lib-stat"><span className="num">{items.length}</span><span className="t-small c-subtle">items · {fmtSize(totalBytes)}</span></div>
            <div className="lib-stat"><Icon name="lock" size={15} className="c-warn" /><span className="t-small c-muted">{secretFields} secret{secretFields === 1 ? '' : 's'} never read</span></div>
          </div>
        )}
      </div>

      {list.loading && !list.data && <LoadingState label="Loading evidence…" />}
      {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.data && items.length === 0 && (
        <Card><EmptyState icon="archive" title="No evidence yet" body="Evidence appears here after a scan or a diagnosis. Scans only read — nothing changes." action={<LinkButton to="/scan" size="sm" variant="primary">Run a scan</LinkButton>} /></Card>
      )}

      {items.length > 0 && (
        <div className="lib-two">
          <Card className="lib-list wide lib-flush" aria-label="Evidence items">
            <div className="lib-filters" role="group" aria-label="Filter by sensitivity" style={{ padding: '14px 14px 10px' }}>
              {FILTERS.map((f) => (
                <button key={f.value} type="button" className="pill-btn" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
                  {f.label}<span className="c-subtle">{f.value === 'all' ? items.length : items.filter((e) => bucket(e.sensitivity) === f.value).length}</span>
                </button>
              ))}
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {visible.map((e) => {
                const b = bucket(e.sensitivity);
                return (
                  <li key={e.id}>
                    <Link to={`/evidence/${encodeURIComponent(e.id)}`} className="lib-evrow" aria-current={selected?.id === e.id ? 'page' : undefined}>
                      <span className={`lib-evid ${idKind(e)}`}>{e.id}</span>
                      <span className="col grow" style={{ gap: 3 }}>
                        <span style={{ fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</span>
                        <span className="t-small c-subtle">{e.source} · {timeAgo(e.capturedAt)}</span>
                      </span>
                      <span className={`lib-tag ${SENS[b].cls}`}>{b === 'secret' && <Icon name="lock" size={11} />}{SENS[b].short}</span>
                    </Link>
                  </li>
                );
              })}
              {visible.length === 0 && <li className="t-small c-subtle" style={{ padding: 16 }}>No items in this group.</li>}
            </ul>
          </Card>
          {selected
            ? <Detail e={selected} />
            : <Card className="lib-main"><EmptyState icon="archive" title={id ? `Evidence ${id} isn’t here` : 'Pick an item'} body={id ? 'It may have passed its retention time and been deleted.' : undefined} action={id ? <LinkButton to="/evidence" size="sm">Show all evidence</LinkButton> : undefined} /></Card>}
        </div>
      )}
    </Page>
  );
}
