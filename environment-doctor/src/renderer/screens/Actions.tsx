/** Board 20 · Safe actions — the signed, typed catalog. The AI picks from it; it can never run arbitrary commands. */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ActionEntry, Risk } from '../../shared/contracts';
import { Icon, type IconName } from '../components/Icon';
import { Page } from '../components/Shell';
import { Card, EmptyState, ErrorState, LoadingState, SegmentedControl, Toggle, timeAgo } from '../components/ui';
import { useApi } from '../hooks/useApi';
import '../styles/library.css';

type RiskFilter = 'all' | Risk;
const RISK: Record<Risk, { label: string; cls: string }> = { low: { label: 'Low risk', cls: 'ok' }, medium: { label: 'Medium risk', cls: 'warn' }, high: { label: 'High risk', cls: 'fail' } };
const CATEGORY_ICON: Record<ActionEntry['category'], IconName> = { environment: 'terminal', packages: 'package', drivers: 'gpu', system: 'monitor', network: 'wifi', project: 'folder' };
const OS_LABEL = { windows: 'Windows', macos: 'macOS', linux: 'Linux' } as const;
const priv = (a: ActionEntry) => (a.privilege === 'admin' ? 'Admin · UAC' : 'Your account');

function Detail({ a }: { a: ActionEntry }) {
  return (
    <div className="col" style={{ gap: 16 }} aria-live="polite">
      <Card className="accent" style={{ padding: 22, gap: 16 }} aria-labelledby="act-title">
        <div className="col" style={{ gap: 6 }}>
          <span className="mono t-small c-subtle">{a.id} · v{a.version}</span>
          <h2 className="t-h2" id="act-title">{a.title}</h2>
          <p className="c-text2" style={{ fontSize: 13.5 }}>{a.description}</p>
        </div>
        {!a.availableInThisBuild && (
          <div className="lib-callout warn" role="note"><Icon name="lock" size={16} /><span><strong>Not available in this build — needs the signed admin helper.</strong> Plans that need it show the step as removed, and nothing runs.</span></div>
        )}
        <div className="lib-grid-3">
          <div className="lib-tile"><span className="lbl">Risk</span><span className={`val ${a.risk === 'low' ? 'c-ok' : a.risk === 'medium' ? 'c-warn' : 'c-danger'}`} style={{ fontWeight: 600 }}>{RISK[a.risk].label}</span></div>
          <div className="lib-tile"><span className="lbl">Runs as</span><span className="val" style={{ fontWeight: 600 }}>{priv(a)}</span></div>
          <div className="lib-tile"><span className="lbl">Restart</span><span className="val" style={{ fontWeight: 600 }}>{a.reboot ? 'May need one' : 'Not needed'}</span></div>
        </div>
        <div className="col" style={{ gap: 8 }}>
          <h3 className="t-small c-muted" style={{ fontWeight: 600 }}>Checked right before running</h3>
          <ul className="col" style={{ gap: 6, margin: 0, padding: 0, listStyle: 'none' }}>
            {a.preconditions.map((p) => <li key={p} className="row" style={{ gap: 9, fontSize: 13 }}><Icon name="check" size={14} className="c-ok" />{p}</li>)}
          </ul>
        </div>
        <div className="col" style={{ gap: 8 }}>
          <h3 className="t-small c-muted" style={{ fontWeight: 600 }}>Proof it worked</h3>
          <ul className="col" style={{ gap: 6, margin: 0, padding: 0, listStyle: 'none' }}>
            {a.verification.map((v) => <li key={v} className="row" style={{ gap: 9, fontSize: 13 }}><Icon name="shieldCheck" size={14} className="c-accent" />{v}</li>)}
          </ul>
          <span className="t-small c-subtle">“Verified” appears only after every one of these passes — an exit code alone never counts.</span>
        </div>
        <div className="lib-callout"><Icon name="undo" size={16} /><span>{a.undo}</span></div>
        <div className="col gap-1 t-small">
          {a.signed
            ? <span className="row c-ok" style={{ gap: 6 }}><Icon name="shieldCheck" size={14} />Signed catalog entry · version pinned</span>
            : <span className="row c-danger" style={{ gap: 6 }}><Icon name="alert" size={14} />Not signed — this action can’t run</span>}
          <span className="c-subtle">Works on {a.os.map((o) => OS_LABEL[o]).join(', ')}{a.lastUsed ? ` · last used ${timeAgo(a.lastUsed)}` : ''}</span>
        </div>
      </Card>
    </div>
  );
}

export default function Actions() {
  const { id } = useParams();
  const catalog = useApi('actions.catalog', undefined);
  const [risk, setRisk] = useState<RiskFilter>('all');
  const [adminOnly, setAdminOnly] = useState(false);
  const [q, setQ] = useState('');
  const all = catalog.data ?? [];
  const needle = q.trim().toLowerCase();
  const visible = all.filter((a) => (risk === 'all' || a.risk === risk) && (!adminOnly || a.privilege === 'admin')
    && (!needle || a.title.toLowerCase().includes(needle) || a.id.toLowerCase().includes(needle) || a.description.toLowerCase().includes(needle)));
  const selected = id ? all.find((a) => a.id === id) : visible[0];
  const n = (r: Risk) => all.filter((a) => a.risk === r).length;

  const aside = catalog.data && (selected
    ? <Detail a={selected} />
    : <Card><EmptyState icon="shieldCheck" title={id ? 'That action isn’t in the catalog' : 'Pick an action'} body={id ? 'Only signed catalog actions can ever run.' : undefined} /></Card>);

  return (
    <Page crumbs={id ? [{ label: 'Safe actions', to: '/actions' }, { label: selected?.title ?? id }] : [{ label: 'Safe actions' }]} actions={catalog.data && <span className="t-small c-subtle">{all.length} actions · {all.every((a) => a.signed) ? 'all signed' : 'some unsigned'}</span>} split aside={aside}>
      <div className="col" style={{ gap: 6 }}>
        <h1 className="t-h1">Safe actions</h1>
        <p className="c-muted" style={{ fontSize: 14 }}>The only changes Environment Doctor can ever make.</p>
      </div>
      <div className="lib-callout accent" role="note"><Icon name="shieldCheck" size={16} /><span>The AI can only pick from this signed catalog; it can never run arbitrary commands.</span></div>

      <div className="row between gap-4 wrap">
        <SegmentedControl
          label="Risk" value={risk} onChange={setRisk}
          options={[{ value: 'all', label: 'All', count: all.length }, { value: 'low', label: 'Low', count: n('low') }, { value: 'medium', label: 'Medium', count: n('medium') }, { value: 'high', label: 'High', count: n('high') }]}
        />
        <div className="row gap-4">
          <label className="row" style={{ gap: 8 }}>
            <span className="sr-only">Search actions</span>
            <input className="input" type="search" placeholder="Search actions" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220, height: 36 }} />
          </label>
          <span className="row t-small c-text2" style={{ gap: 10 }}><Toggle checked={adminOnly} onChange={setAdminOnly} label="Only actions that need admin" />Only admin</span>
        </div>
      </div>

      {catalog.loading && !catalog.data && <LoadingState label="Loading the catalog…" />}
      {catalog.error && <ErrorState error={catalog.error} onRetry={catalog.reload} />}
      {catalog.data && (
        <>
          <p className="sr-only" aria-live="polite">{visible.length} action{visible.length === 1 ? '' : 's'} shown</p>
          {visible.length === 0 && <Card><EmptyState icon="search" title="No actions match" body="Try another risk level or search word." /></Card>}
          <ul className="lib-cards" aria-label="Actions" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {visible.map((a) => (
              <li key={a.id} style={{ display: 'flex' }}>
                <Link to={`/actions/${encodeURIComponent(a.id)}`} className="lib-pick top" aria-current={selected?.id === a.id ? 'page' : undefined} data-risk={a.risk}>
                  <span className="lib-icon-box"><Icon name={CATEGORY_ICON[a.category]} size={16} /></span>
                  <span className="col grow" style={{ gap: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{a.title}</span>
                    <span className="mono c-subtle" style={{ fontSize: 11.5, overflowWrap: 'anywhere' }}>{a.id} · v{a.version}</span>
                    <span className="row wrap" style={{ gap: 6 }}>
                      <span className={`lib-tag ${RISK[a.risk].cls}`}>{RISK[a.risk].label}</span>
                      <span className={`lib-tag ${a.privilege === 'admin' ? 'warn' : ''}`}>{priv(a)}</span>
                      {a.reboot && <span className="lib-tag">May need restart</span>}
                      {!a.availableInThisBuild && <span className="lib-tag unknown">Not in this build</span>}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Page>
  );
}
