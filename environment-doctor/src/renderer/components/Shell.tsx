/** AppShell (Handoff “Page layouts”): sidebar 244 px (icon rail < 1440 px) + 60 px header. */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useApp } from '../AppContext';
import { Icon, type IconName } from './Icon';
import { Banner, Crumbs, Dialog, ProgressRing, timeAgo } from './ui';

const MONITOR: [string, string, IconName][] = [['/', 'Overview', 'grid'], ['/incidents', 'Incidents', 'alert'], ['/evidence', 'Evidence', 'archive'], ['/projects', 'Projects', 'folder']];
const CONTROL: [string, string, IconName][] = [['/setup', 'Set up', 'package'], ['/actions', 'Safe actions', 'shieldCheck'], ['/history', 'History', 'history'], ['/settings/general', 'Settings', 'sliders']];

function Sidebar() {
  const { machine, health, openPalette } = useApp();
  const openIncidents = health ? health.pillars.flatMap((p) => p.rows).filter((r) => r.status === 'fail' || r.status === 'warn').map((r) => r.incidentId).filter(Boolean) : [];
  const count = new Set(openIncidents).size;
  const rows = health?.pillars.flatMap((p) => p.rows) ?? [];
  const checked = rows.filter((r) => r.status !== 'unknown');
  const okPct = checked.length ? (checked.filter((r) => r.status === 'ok').length / Math.max(1, rows.length)) * 100 : 0;
  const item = ([to, label, icon]: [string, string, IconName]) => (
    <NavLink key={to} to={to} end={to === '/'} className="nav-item" aria-label={label} title={label}>
      <Icon name={icon} /><span className="nav-text grow">{label}</span>
      {label === 'Incidents' && count > 0 && <span className="nav-count" aria-label={`${count} open`}>{count}</span>}
    </NavLink>
  );
  return (
    <nav aria-label="Primary" className="sidebar">
      <Link to="/" className="brand" style={{ textDecoration: 'none', color: 'inherit' }} aria-label="Environment Doctor home">
        <span className="brand-mark"><Icon name="pulse" size={18} stroke={2.2} /></span>
        <span className="brand-text col" style={{ gap: 0 }}><span className="brand-name">Environment Doctor</span><span className="brand-sub">{machine ? `${machine.os === 'windows' ? 'Windows' : machine.os === 'macos' ? 'macOS' : 'Linux'} · v${machine.appVersion}` : ' '}</span></span>
      </Link>
      <button type="button" className="search-btn" onClick={openPalette} aria-label="Search or run (Ctrl K)">
        <Icon name="search" size={15} stroke={2} /><span className="search-text grow">Search or run…</span><kbd>Ctrl K</kbd>
      </button>
      <div className="nav-group"><div className="nav-label t-overline">Monitor</div>{MONITOR.map(item)}</div>
      <div className="nav-group"><div className="nav-label t-overline">Control</div>{CONTROL.map(item)}</div>
      <div className="machine-card">
        <div className="row gap-3">
          <ProgressRing value={okPct} size={36} stroke={3.5} color="var(--ok)" label="Checked items that are healthy" />
          <div className="col" style={{ gap: 1, minWidth: 0 }}>
            <span className="mono" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>{machine?.hostname ?? '…'}</span>
            <span style={{ fontSize: 11 }} className="c-subtle">{machine?.osLabel}</span>
          </div>
        </div>
        {machine?.guardsOn === false
          ? <div className="row c-danger" style={{ fontSize: 12, gap: 6 }}><Icon name="shield" size={14} stroke={2.2} />Repairs paused</div>
          : <div className="row c-ok" style={{ fontSize: 12, gap: 6 }}><Icon name="shield" size={14} stroke={2.2} />All safety guards on</div>}
      </div>
    </nav>
  );
}

function NotificationsButton() {
  const { notices, clearNotices } = useApp();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  return (
    <>
      <button type="button" className="btn icon-btn" aria-label={`Notifications${notices.length ? ` (${notices.length})` : ''}`} onClick={() => setOpen(true)}>
        <Icon name="bell" size={16} />
      </button>
      {open && (
        <Dialog label="Notifications" onClose={() => setOpen(false)} width={420}>
          <div className="row between" style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-soft)' }}>
            <h2 className="t-title">Notifications</h2>
            <div className="row">{notices.length > 0 && <button type="button" className="btn ghost sm" onClick={clearNotices}>Clear all</button>}<button type="button" className="btn icon-btn" aria-label="Close" onClick={() => setOpen(false)}><Icon name="close" size={15} /></button></div>
          </div>
          <div className="list" style={{ maxHeight: 420, overflowY: 'auto' }}>
            {notices.length === 0 && <p className="c-subtle t-small" style={{ padding: 18 }}>Nothing new. Only outcomes that need you or finished repairs show here — never marketing.</p>}
            {notices.map((n) => (
              <button key={n.id} type="button" className="list-row" style={{ padding: '12px 18px' }} onClick={() => { setOpen(false); if (n.route) nav(n.route); }}>
                <span className={`dot ${n.kind === 'error' ? 'fail' : n.kind === 'warn' ? 'warn' : n.kind === 'ok' ? 'ok' : 'accent'}`} aria-hidden="true" />
                <span className="col grow" style={{ gap: 2 }}><span className="t-small" style={{ color: 'var(--text)', fontWeight: 500 }}>{n.title}</span>{n.body && <span className="t-small c-subtle">{n.body}</span>}</span>
                <span className="t-small c-subtle">{timeAgo(n.at)}</span>
              </button>
            ))}
          </div>
        </Dialog>
      )}
    </>
  );
}

/** Screen-level header content: breadcrumbs left, actions right. The lock pill (UI rule 5) is always shown when a repair holds the lock. */
export function Page({ crumbs, actions, children, split, aside, bleed }: { crumbs: { label: ReactNode; to?: string }[]; actions?: ReactNode; children: ReactNode; split?: boolean; aside?: ReactNode; bleed?: boolean }) {
  const { lock, machine } = useApp();
  return (
    <>
      <header className="header">
        <Crumbs items={crumbs} />
        <div className="row gap-3">
          {actions}
          {machine?.mode === 'demo' && <Link to="/settings/general" className="demo-pill" title="Demo data — no changes are made to this PC">Demo</Link>}
          {lock?.held && (
            <Link to={`/incidents/${lock.incidentId}/run`} className="lock-pill" aria-label={`Repair running on ${lock.incidentId}. One repair at a time.`}>
              <Icon name="lock" size={13} />Repairing {lock.incidentId}
            </Link>
          )}
          <NotificationsButton />
        </div>
      </header>
      {split
        ? <div className="content-split"><div className="primary">{children}</div><aside className="aside" aria-label="Details">{aside}</aside></div>
        : bleed ? children : <main className="content" id="main">{children}</main>}
    </>
  );
}

export function Shell() {
  const { health, openPalette, toasts, dismissToast } = useApp();
  const nav = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openPalette]);
  const b = health?.banner;
  return (
    <div className="shell">
      <a href="#main" className="sr-only">Skip to content</a>
      <Sidebar />
      <div className="main">
        {b && b.kind === 'helper-untrusted' && <Banner kind="danger" role="alert">{b.text} <button type="button" className="btn ghost sm" onClick={() => nav('/settings/updates')}>Repair the app install</button></Banner>}
        {b && b.kind === 'backup-restored' && <Banner kind="warn">{b.text} <Link to="/history">What happened</Link></Banner>}
        {b && b.kind === 'offline' && <Banner kind="info">{b.text}</Banner>}
        <Outlet />
      </div>
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className="toast" role="status">
            <span className={`dot ${t.kind === 'error' ? 'fail' : t.kind === 'warn' ? 'warn' : t.kind === 'ok' ? 'ok' : 'accent'}`} style={{ marginTop: 6 }} aria-hidden="true" />
            <span className="col grow" style={{ gap: 2 }}><span className="t-small" style={{ fontWeight: 600 }}>{t.title}</span>{t.body && <span className="t-small c-muted">{t.body}</span>}</span>
            {t.route && <button type="button" className="btn ghost sm" onClick={() => { dismissToast(t.id); nav(t.route!); }}>View</button>}
            <button type="button" className="btn icon-btn" style={{ width: 28, height: 28 }} aria-label="Dismiss" onClick={() => dismissToast(t.id)}><Icon name="close" size={13} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
