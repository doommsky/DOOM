/** Board 19 · History & audit — tamper-evident timeline, filters, integrity status. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { HistoryEvent, HistoryList } from '../../shared/contracts';
import { Icon, type IconName } from '../components/Icon';
import { Page } from '../components/Shell';
import { Banner, Button, Card, EmptyState, ErrorState, LoadingState } from '../components/ui';
import { useApi } from '../hooks/useApi';
import { useApp } from '../AppContext';
import '../styles/library.css';

type Filter = 'all' | 'repairs' | 'scans' | 'approvals' | 'security';
const FILTERS: { value: Filter; label: string; dot: string; kinds: HistoryEvent['kind'][] }[] = [
  { value: 'all', label: 'Everything', dot: '', kinds: [] },
  { value: 'repairs', label: 'Repairs', dot: 'accent', kinds: ['action', 'verification'] },
  { value: 'scans', label: 'Scans', dot: 'subtle', kinds: ['scan'] },
  { value: 'approvals', label: 'Approvals', dot: 'accent', kinds: ['approval'] },
  { value: 'security', label: 'Security', dot: 'warn', kinds: ['system', 'drift', 'recovery'] },
];
const KIND: Record<HistoryEvent['kind'], { icon: IconName; tone: string; label: string }> = {
  action: { icon: 'wrench', tone: 'accent', label: 'Repair' },
  verification: { icon: 'check', tone: 'ok', label: 'Verification' },
  scan: { icon: 'pulse', tone: '', label: 'Scan' },
  approval: { icon: 'lock', tone: 'accent', label: 'Approval' },
  system: { icon: 'shield', tone: 'warn', label: 'Security' },
  drift: { icon: 'alert', tone: 'warn', label: 'Drift' },
  recovery: { icon: 'restart', tone: 'warn', label: 'Recovery' },
  diagnosis: { icon: 'search', tone: '', label: 'Diagnosis' },
  settings: { icon: 'sliders', tone: '', label: 'Settings' },
  evidence: { icon: 'archive', tone: '', label: 'Evidence' },
};
const ACTOR: Record<HistoryEvent['actor'], string> = { you: 'You', engine: 'Environment Doctor', windows: 'Windows', ai: 'AI' };

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === new Date(Date.now() - 86400000).toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function Integrity({ h }: { h: HistoryList }) {
  if (h.integrity === 'ok') {
    return (
      <Card className="ok" aria-labelledby="integrity-title">
        <div className="row gap-3"><span className="lib-icon-box" style={{ background: 'var(--ok-tint)', color: 'var(--ok)' }}><Icon name="shieldCheck" size={16} /></span><h2 className="t-title" id="integrity-title">Chain intact</h2></div>
        <p className="c-text2" style={{ fontSize: 13 }}>Each entry is linked to the one before it, so a missing or edited entry would show up here.</p>
        <span className="t-small c-subtle">{h.integrityNote}</span>
      </Card>
    );
  }
  if (h.integrity === 'restored') {
    return (
      <Card className="warn" aria-labelledby="integrity-title">
        <div className="row gap-3"><span className="lib-icon-box" style={{ background: 'var(--warn-tint)', color: 'var(--warn)' }}><Icon name="alert" size={16} /></span><h2 className="t-title" id="integrity-title">Restored from backup</h2></div>
        <p className="c-text2" style={{ fontSize: 13 }}>{h.integrityNote}</p>
        <span className="t-small c-subtle">The recovery journal was not affected.</span>
      </Card>
    );
  }
  return (
    <Card className="danger" role="alert" aria-labelledby="integrity-title">
      <div className="row gap-3"><span className="lib-icon-box" style={{ background: 'var(--danger-tint)', color: 'var(--danger)' }}><Icon name="alert" size={16} /></span><h2 className="t-title" id="integrity-title">History doesn’t add up</h2></div>
      <p className="c-text2" style={{ fontSize: 13 }}>{h.integrityNote}</p>
      <span className="t-small c-subtle">Nothing was changed. Treat older entries with care.</span>
    </Card>
  );
}

export default function History() {
  const { health } = useApp();
  // The shell already shows the app-wide “restored from backup” banner; don't show it twice.
  const shellBanner = health?.banner?.kind === 'backup-restored';
  const hist = useApi('history.list', undefined);
  const settings = useApi('settings.get', undefined);
  const [filter, setFilter] = useState<Filter>('all');

  const events = useMemo(() => hist.data?.events ?? [], [hist.data]);
  const f = FILTERS.find((x) => x.value === filter)!;
  const visible = filter === 'all' ? events : events.filter((e) => f.kinds.includes(e.kind));
  const days = useMemo(() => {
    const out: { day: string; events: HistoryEvent[] }[] = [];
    for (const e of visible) {
      const d = dayLabel(e.at);
      const last = out[out.length - 1];
      if (last && last.day === d) last.events.push(e); else out.push({ day: d, events: [e] });
    }
    return out;
  }, [visible]);

  const since = Date.now() - 30 * 86400000;
  const recent = events.filter((e) => new Date(e.at).getTime() >= since);
  const count = (k: HistoryEvent['kind']) => recent.filter((e) => e.kind === k).length;

  const exportTrail = () => {
    if (!hist.data) return;
    const blob = new Blob([JSON.stringify(hist.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `environment-doctor-history-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const aside = hist.data && (
    <>
      <Integrity h={hist.data} />
      <Card aria-labelledby="h-30">
        <h2 className="t-title" id="h-30">Last 30 days</h2>
        <div className="lib-grid-2">
          <div className="lib-tile"><span className="num">{count('action')}</span><span className="lbl">repair events</span></div>
          <div className="lib-tile"><span className="num c-ok">{count('verification')}</span><span className="lbl">verification results</span></div>
          <div className="lib-tile"><span className="num">{count('scan')}</span><span className="lbl">scans</span></div>
          <div className="lib-tile"><span className="num">{count('approval')}</span><span className="lbl">approval events</span></div>
        </div>
      </Card>
      <Card aria-labelledby="h-kept">
        <h2 className="t-title" id="h-kept">Kept on this PC</h2>
        <div className="lib-line"><span>History</span><span>{settings.data ? `${settings.data.data.historyRetentionDays} days` : '—'}</span></div>
        <div className="lib-line"><span>Evidence</span><span>{settings.data ? `${settings.data.data.evidenceRetentionDays} days` : '—'}</span></div>
        <div className="lib-line"><span>Recovery journal</span><span>Until resolved</span></div>
        <Link to="/settings/data" className="t-small">Change in Settings</Link>
      </Card>
    </>
  );

  return (
    <Page crumbs={[{ label: 'History' }]} actions={<Button size="sm" icon="download" onClick={exportTrail} disabled={!hist.data}>Export audit trail</Button>} split aside={aside}>
      {hist.data?.integrity === 'restored' && !shellBanner && <div className="lib-bannerbox"><Banner kind="warn">History restored from backup. Entries after the last backup may be missing — nothing else changed.</Banner></div>}
      {hist.data?.integrity === 'broken' && <div className="lib-bannerbox"><Banner kind="danger">The audit chain doesn’t match — history may have been edited outside the app. Nothing was changed.</Banner></div>}
      <div className="col" style={{ gap: 6 }}>
        <h1 className="t-h1">History</h1>
        <p className="c-muted" style={{ fontSize: 14 }}>Every scan, decision and change — including anything that ran with admin rights.</p>
      </div>
      <div className="lib-filters" role="group" aria-label="Filter history">
        {FILTERS.map((x) => (
          <button key={x.value} type="button" className="pill-btn" aria-pressed={filter === x.value} onClick={() => setFilter(x.value)}>
            <span className={`lib-chipdot ${x.dot}`} aria-hidden="true" />{x.label}
          </button>
        ))}
      </div>

      {hist.loading && !hist.data && <LoadingState label="Loading history…" />}
      {hist.error && <ErrorState error={hist.error} onRetry={hist.reload} />}
      {hist.data && (
        <Card style={{ padding: '8px 22px' }} aria-label="Timeline">
          {visible.length === 0 && <EmptyState icon="history" title={filter === 'all' ? 'Nothing recorded yet' : 'Nothing of this kind yet'} body="Scans, approvals and repairs are recorded here as they happen." />}
          {days.map((d) => (
            <section key={d.day} aria-label={d.day}>
              <h3 className="t-overline lib-day">{d.day}</h3>
              <ol className="lib-timeline">
                {d.events.map((e) => {
                  const k = KIND[e.kind];
                  return (
                    <li key={e.id} className="lib-event" data-kind={e.kind}>
                      <div className="rail"><span className={`ico ${k.tone}`}><Icon name={k.icon} size={16} label={k.label} /></span><span className="stem" aria-hidden="true" /></div>
                      <div className="body">
                        <div className="col" style={{ gap: 4, minWidth: 0 }}>
                          <span style={{ fontSize: 14, fontWeight: 500 }}>{e.title}</span>
                          <span className="t-small c-muted">{e.detail}</span>
                          <span className="t-small c-subtle">{ACTOR[e.actor]}{e.incidentId && <> · <Link to={`/incidents/${encodeURIComponent(e.incidentId)}`}>{e.incidentId}</Link></>}</span>
                        </div>
                        <div className="col" style={{ gap: 2, alignItems: 'flex-end', flexShrink: 0 }}>
                          <time className="mono t-small c-muted" dateTime={e.at}>{hhmm(e.at)}</time>
                          <span className="mono c-subtle" style={{ fontSize: 11 }} title={`Entry hash ${e.hash}`}>#{e.hash.slice(0, 8)}</span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </Card>
      )}
    </Page>
  );
}
