/** Board 22 · Settings — general, privacy & AI, diagnostics, updates, data (+ engine mode). Locked settings can't change (AC-25). */
import { useCallback, useId, useState, type ReactNode } from 'react';
import { Link, Navigate, NavLink, useNavigate, useParams } from 'react-router-dom';
import { LOCKED_SETTINGS, type AiMode, type ApiError, type EngineMode, type Settings as SettingsT } from '../../shared/contracts';
import { call } from '../api/client';
import { useApp } from '../AppContext';
import { Icon } from '../components/Icon';
import { Page } from '../components/Shell';
import { Button, Card, Dialog, ErrorState, LinkButton, LoadingState, RadioCard, Toggle } from '../components/ui';
import { useApi } from '../hooks/useApi';
import '../styles/library.css';

const SECTIONS = [
  { key: 'general', label: 'General', dot: 'subtle', intro: 'How Environment Doctor starts, and whether it reads this PC or shows sample data.' },
  { key: 'privacy', label: 'Privacy & AI', dot: 'ok', intro: 'What the AI sees, and where it runs. Your evidence stays on this PC unless you say otherwise.' },
  { key: 'diagnostics', label: 'Diagnostics', dot: 'accent', intro: 'How deep checks go and which project folders are included. Deeper checks can be large or sensitive.' },
  { key: 'updates', label: 'Updates', dot: 'warn', intro: 'Every update is signature-checked and can roll back if its health check fails.' },
  { key: 'data', label: 'Data & storage', dot: 'subtle', intro: 'Everything is stored on this PC. Nothing here is sent anywhere.' },
] as const;
type SectionKey = (typeof SECTIONS)[number]['key'];

/** The user-facing reason for a locked setting (the spec reference stays in the contract, not on screen). */
const lockedReason = (path: string) => LOCKED_SETTINGS[path]?.replace(/\s*\(spec [^)]*\)/, '');

type Save = (path: string, value: unknown) => Promise<boolean>;

function InlineError({ error }: { error: ApiError }) {
  return (
    <div role="alert" className="col t-small" style={{ gap: 2 }}>
      <span className="c-danger">{error.headline}. {error.didNotHappen ?? 'Nothing changed.'}</span>
      {error.nextStep && <span className="c-subtle">Next: {error.nextStep}</span>}
      <details className="c-subtle"><summary>Details</summary><span className="mono">{error.code}</span>{error.detail && <> · {error.detail}</>}</details>
    </div>
  );
}

function ToggleRow({ path, label, note, checked, save, error }: { path: string; label: string; note?: string; checked: boolean; save: Save; error?: ApiError }) {
  const reason = lockedReason(path);
  const noteId = useId();
  return (
    <div className="lib-setrow" data-setting={path}>
      <div className="txt">
        <span className="lbl">
          {label}
          {reason && <span className="lib-tag"><Icon name="lock" size={10} />{checked ? 'Always on' : 'Always off'}</span>}
        </span>
        <span className="note" id={noteId}>{reason ?? note}</span>
        {error && <InlineError error={error} />}
      </div>
      <Toggle checked={checked} label={label} locked={!!reason} lockedReason={reason} describedBy={noteId} onChange={(v) => { void save(path, v); }} />
    </div>
  );
}

function InfoRow({ label, note, value }: { label: string; note?: string; value: ReactNode }) {
  return (
    <div className="lib-setrow">
      <div className="txt"><span className="lbl">{label}</span>{note && <span className="note">{note}</span>}</div>
      <span className="t-small c-text2" style={{ flexShrink: 0 }}>{value}</span>
    </div>
  );
}

function SelectRow<T extends string | number>({ path, label, note, value, options, save, error }: { path: string; label: string; note?: string; value: T; options: { value: T; label: string }[]; save: Save; error?: ApiError }) {
  const id = useId();
  return (
    <div className="lib-setrow" data-setting={path}>
      <div className="txt">
        <label className="lbl" htmlFor={id}>{label}</label>
        {note && <span className="note">{note}</span>}
        {error && <InlineError error={error} />}
      </div>
      <select id={id} className="lib-select" value={String(value)} onChange={(e) => { const o = options.find((x) => String(x.value) === e.target.value); if (o) void save(path, o.value); }}>
        {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
    </div>
  );
}

function General({ s, save, errors }: { s: SettingsT; save: Save; errors: Record<string, ApiError | undefined> }) {
  const { refresh, checkRecovery, machine } = useApp();
  const nav = useNavigate();
  const [switching, setSwitching] = useState(false);
  const switchMode = async (m: EngineMode) => {
    if (m === s.engine.mode || switching) return;
    setSwitching(true);
    const ok = await save('engine.mode', m);
    setSwitching(false);
    if (!ok) return;
    await Promise.all([refresh(), checkRecovery()]);
    nav('/');
  };
  const modeError = errors['engine.mode'];
  return (
    <>
      <Card className="lib-flush">
        <ToggleRow path="general.launchAtLogin" label="Start when you sign in" note="Runs quietly in the tray. Scans never change anything." checked={s.general.launchAtLogin} save={save} error={errors['general.launchAtLogin']} />
        <ToggleRow path="general.trayIcon" label="Show in the tray" note="Keeps results one click away. Notifications only ever report outcomes — never marketing." checked={s.general.trayIcon} save={save} error={errors['general.trayIcon']} />
        <ToggleRow path="general.scanOnStart" label="Scan when the app starts" note="A light, read-only scan. Nothing changes during a scan." checked={s.general.scanOnStart} save={save} error={errors['general.scanOnStart']} />
        <InfoRow label="Theme" note="The only theme in this version." value="Dark" />
      </Card>

      <section className="col gap-3" aria-labelledby="mode-title">
        <div className="col" style={{ gap: 4 }}>
          <h3 className="t-title" id="mode-title">Mode</h3>
          <p className="t-small c-subtle">Live reads this PC. Demo shows sample problems so you can try everything — nothing on this PC changes.</p>
        </div>
        <div className="grid-2" role="radiogroup" aria-label="Engine mode" aria-busy={switching || undefined}>
          <RadioCard name="live" checked={s.engine.mode === 'live'} onSelect={() => { void switchMode('live'); }} title="Live — this PC" body="Real scans of this PC. Repairs that need admin need the signed helper." />
          <RadioCard name="demo" checked={s.engine.mode === 'demo'} onSelect={() => { void switchMode('demo'); }} title="Demo — sample data" body="A realistic sample PC with problems to explore. Nothing here touches your machine." />
        </div>
        {modeError && <ErrorState error={modeError} compact />}
        <span className="t-small c-subtle" aria-live="polite">{switching ? 'Switching…' : `Now: ${machine?.mode === 'live' ? 'Live — reading this PC' : 'Demo — sample data'}`}</span>
      </section>
    </>
  );
}

function Privacy({ s, save, errors }: { s: SettingsT; save: Save; errors: Record<string, ApiError | undefined> }) {
  const incidents = useApi('incidents.list', undefined);
  const target = incidents.data?.find((i) => !['closed', 'verified'].includes(i.status)) ?? incidents.data?.[0];
  const modes: { value: AiMode; title: string; body: string }[] = [
    { value: 'off', title: 'Off', body: 'Rules and direct tests only. Diagnosis still works — explanations are shorter.' },
    { value: 'local', title: 'On this PC', body: 'Explains problems without anything leaving this PC.' },
    { value: 'cloud', title: 'Cloud AI', body: 'For hard problems. Only redacted evidence, and only after you’ve seen the preview.' },
  ];
  return (
    <>
      <section className="col gap-3" aria-labelledby="ai-title">
        <h3 className="t-title" id="ai-title">Where the AI runs</h3>
        <div className="grid-3" role="radiogroup" aria-label="AI mode">
          {modes.map((m) => <RadioCard key={m.value} name={m.value} checked={s.privacy.aiMode === m.value} onSelect={() => { void save('privacy.aiMode', m.value); }} title={m.title} body={m.body} />)}
        </div>
        {errors['privacy.aiMode'] && <InlineError error={errors['privacy.aiMode']!} />}
        <div className="lib-callout accent"><Icon name="eye" size={16} /><span>Cloud AI always shows the preview screen first: you see exactly what would be sent, can untick anything, and secrets are never included. Cloud provider: {s.privacy.cloudProvider}.</span></div>
      </section>
      <Card className="lib-flush">
        <ToggleRow path="privacy.previewBeforeSend" label="Preview before anything is sent" checked={s.privacy.previewBeforeSend} save={save} error={errors['privacy.previewBeforeSend']} />
        <ToggleRow path="privacy.redactSecrets" label="Never collect or send secrets" checked={s.privacy.redactSecrets} save={save} error={errors['privacy.redactSecrets']} />
        <ToggleRow path="privacy.sendCrashDumps" label="Send full crash dumps" checked={s.privacy.sendCrashDumps} save={save} error={errors['privacy.sendCrashDumps']} />
      </Card>
      <div className="row gap-3">
        {target
          ? <LinkButton to={`/evidence/preview/${encodeURIComponent(target.id)}`} icon="sparkle">See what the AI would receive</LinkButton>
          : <LinkButton to="/evidence" icon="archive">Open the evidence vault</LinkButton>}
      </div>
    </>
  );
}

function Diagnostics({ s, save, errors }: { s: SettingsT; save: Save; errors: Record<string, ApiError | undefined> }) {
  const [root, setRoot] = useState('');
  const inputId = useId();
  const roots = s.diagnostics.projectRoots;
  const add = async () => {
    const v = root.trim();
    if (!v || roots.includes(v)) return;
    if (await save('diagnostics.projectRoots', [...roots, v])) setRoot('');
  };
  return (
    <>
      <Card className="lib-flush">
        <SelectRow path="diagnostics.eventLogDays" label="Event logs to read" note="Older logs help with problems that come and go." value={s.diagnostics.eventLogDays} save={save} error={errors['diagnostics.eventLogDays']}
          options={[7, 14, 30, 60, 90].map((d) => ({ value: d, label: `Last ${d} days` }))} />
        <SelectRow path="diagnostics.escalation" label="How deep checks may go" note="Deeper levels read more and take longer. Anything sensitive still asks first." value={s.diagnostics.escalation} save={save} error={errors['diagnostics.escalation']}
          options={[{ value: 'L2', label: 'L2 · Light' }, { value: 'L3', label: 'L3 · Standard' }, { value: 'L4', label: 'L4 · Deep' }, { value: 'L5', label: 'L5 · Deepest' }]} />
        <ToggleRow path="diagnostics.includeProjects" label="Check projects too" note="Reads requirement files like package.json and pyproject.toml — never your code." checked={s.diagnostics.includeProjects} save={save} error={errors['diagnostics.includeProjects']} />
      </Card>
      <section className="col gap-3" aria-labelledby="roots-title">
        <div className="col" style={{ gap: 4 }}>
          <h3 className="t-title" id="roots-title">Project folders</h3>
          <p className="t-small c-subtle">Folders we look in for projects. Only requirement files are read. Run a scan after changing this.</p>
        </div>
        <Card className="lib-flush">
          {roots.length === 0 && <div className="lib-setrow"><span className="t-small c-subtle">No project folders yet — the Projects page stays empty until you add one.</span></div>}
          {roots.map((r) => (
            <div key={r} className="lib-setrow">
              <Icon name="folder" size={15} className="c-muted" />
              <span className="mono t-small grow" style={{ overflowWrap: 'anywhere' }}>{r}</span>
              <Button size="sm" variant="ghost" aria-label={`Remove ${r}`} onClick={() => { void save('diagnostics.projectRoots', roots.filter((x) => x !== r)); }}>Remove</Button>
            </div>
          ))}
        </Card>
        <form className="row gap-3" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <label htmlFor={inputId} className="sr-only">Project folder to add</label>
          <input id={inputId} className="input" placeholder="Folder path, e.g. D:\work" value={root} onChange={(e) => setRoot(e.target.value)} style={{ maxWidth: 420 }} />
          <Button type="submit" size="sm" icon="plus" disabled={!root.trim()}>Add folder</Button>
        </form>
        {errors['diagnostics.projectRoots'] && <InlineError error={errors['diagnostics.projectRoots']!} />}
      </section>
    </>
  );
}

function Updates({ s, save, errors }: { s: SettingsT; save: Save; errors: Record<string, ApiError | undefined> }) {
  const betaSave: Save = (_p, v) => save('updates.channel', v ? 'beta' : 'stable');
  return (
    <Card className="lib-flush">
      <ToggleRow path="updates.autoCheck" label="Check for updates automatically" note="Downloads are signature-checked. Installing always waits for you." checked={s.updates.autoCheck} save={save} error={errors['updates.autoCheck']} />
      <ToggleRow path="updates.channel" label="Get beta versions" note="Earlier features, a little less tested." checked={s.updates.channel === 'beta'} save={betaSave} error={errors['updates.channel']} />
      <ToggleRow path="updates.blockDuringRepair" label="Never update during a repair" checked={s.updates.blockDuringRepair} save={save} error={errors['updates.blockDuringRepair']} />
    </Card>
  );
}

function Data({ s }: { s: SettingsT }) {
  const { machine } = useApp();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const reset = async () => {
    setBusy(true);
    const r = await call('demo.reset');
    if (!r.ok) { setBusy(false); setError(r.error); setConfirm(false); return; }
    window.location.hash = '#/';
    window.location.reload();
  };
  return (
    <>
      <Card className="lib-flush">
        <InfoRow label="Evidence" note="Older evidence is deleted unless an open incident still needs it." value={`Kept ${s.data.evidenceRetentionDays} days`} />
        <InfoRow label="History" note="The tamper-evident record of scans, approvals and repairs." value={`Kept ${s.data.historyRetentionDays} days`} />
        <InfoRow label="Recovery journal" note="Needed to recover safely after a crash or power cut." value="Until resolved" />
      </Card>
      <div className="row gap-3">
        <LinkButton to="/history" icon="history">Open History</LinkButton>
        {machine?.mode === 'demo' && <Button variant="danger" icon="undo" onClick={() => setConfirm(true)}>Reset demo data</Button>}
      </div>
      {error && <ErrorState error={error} compact />}
      {confirm && (
        <Dialog label="Reset demo data" onClose={() => setConfirm(false)} center width={460}>
          <div className="col gap-3" style={{ padding: 22 }}>
            <h2 className="t-title">Reset demo data?</h2>
            <p className="t-small c-muted">The sample incidents, evidence and history go back to the start and you’ll see First run again. Only demo data is affected — nothing on this PC changes.</p>
            <div className="row end gap-3">
              <Button onClick={() => setConfirm(false)}>Cancel</Button>
              <Button variant="danger" onClick={() => { void reset(); }} disabled={busy}>{busy ? 'Resetting…' : 'Reset demo data'}</Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}

export default function Settings() {
  const { section } = useParams();
  const s = useApi('settings.get', undefined);
  const [errors, setErrors] = useState<Record<string, ApiError | undefined>>({});
  const setData = s.set;

  const save = useCallback<Save>(async (path, value) => {
    const r = await call('settings.set', { path, value });
    if (r.ok) { setData(r.data); setErrors((e) => ({ ...e, [path]: undefined })); return true; }
    setErrors((e) => ({ ...e, [path]: r.error }));
    return false;
  }, [setData]);

  const cur = SECTIONS.find((x) => x.key === section);
  if (!cur) return <Navigate to="/settings/general" replace />;
  const key: SectionKey = cur.key;

  return (
    <Page crumbs={[{ label: 'Settings', to: '/settings/general' }, { label: cur.label }]} actions={<span className="t-small c-subtle">Changes save automatically</span>}>
      <div className="lib-settings">
        <div className="lib-settings-nav">
          <h1 className="t-h1" style={{ marginBottom: 14 }}>Settings</h1>
          <nav aria-label="Settings sections" className="col" style={{ gap: 4 }}>
            {SECTIONS.map((x) => (
              <NavLink key={x.key} to={`/settings/${x.key}`}><span className={`lib-chipdot ${x.dot}`} aria-hidden="true" />{x.label}</NavLink>
            ))}
          </nav>
          <Link to="/design" className="t-small row" style={{ marginTop: 18, gap: 6, padding: '0 12px' }}><Icon name="grid" size={14} />Design system</Link>
        </div>
        <section className="lib-settings-body" aria-labelledby="settings-section-title">
          <div className="col" style={{ gap: 6, paddingTop: 46 }}>
            <h2 className="t-h2" id="settings-section-title">{cur.label}</h2>
            <p className="c-muted" style={{ fontSize: 14 }}>{cur.intro}</p>
          </div>
          {s.loading && !s.data && <LoadingState label="Loading settings…" />}
          {s.error && <ErrorState error={s.error} onRetry={s.reload} />}
          {s.data && key === 'general' && <General s={s.data} save={save} errors={errors} />}
          {s.data && key === 'privacy' && <Privacy s={s.data} save={save} errors={errors} />}
          {s.data && key === 'diagnostics' && <Diagnostics s={s.data} save={save} errors={errors} />}
          {s.data && key === 'updates' && <Updates s={s.data} save={save} errors={errors} />}
          {s.data && key === 'data' && <Data s={s.data} />}
        </section>
      </div>
    </Page>
  );
}
