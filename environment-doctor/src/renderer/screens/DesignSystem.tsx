/** Boards 23–25 · Design tokens, component library and states — a living gallery of the real components. */
import { useEffect, useId, useState } from 'react';
import type { ApiError, CheckStatus, Confidence, IncidentStatus } from '../../shared/contracts';
import { Icon, type IconName } from '../components/Icon';
import { Page } from '../components/Shell';
import {
  Banner, Button, Card, Checkbox, ConfidenceMeter, Dialog, EmptyState, ErrorState, EvidenceTag, IncidentStatusChip, Kbd, LinkButton,
  LoadingState, LoopStepper, ProgressRing, RadioCard, SegmentedControl, Skeleton, Spinner, StatusChip, StatusDot, Toggle,
} from '../components/ui';
import '../styles/library.css';

const SURFACES: [string, string][] = [['bg', 'App background'], ['sidebar', 'Navigation'], ['inset', 'Wells, code, fields'], ['surface', 'Cards, panels'], ['raised', 'Selected card'], ['hover', 'Hover'], ['selected', 'Selected segment'], ['border', 'Card borders'], ['border-soft', 'Dividers'], ['border-strong', 'Inputs, buttons'], ['border-accent', 'Emphasised card']];
const INKS: [string, string][] = [['text', 'Primary text'], ['text-2', 'Body in cards'], ['muted', 'Secondary'], ['subtle', 'Meta, captions'], ['faint', 'Decorative only'], ['accent', 'Actions, focus'], ['ok', 'Verified, healthy'], ['warn', 'Attention, admin'], ['danger', 'Failing, blocked']];
const TYPE: [string, string, string][] = [['t-display', 'Looked after like a technician would', '44/1.08 · 600'], ['t-h1', 'Checking that it worked', '26/1.2 · 600'], ['t-h2', 'Other possible causes', '20/1.3 · 600'], ['t-title', 'Recreate the Node link', '15/1.4 · 600'], ['t-body', 'Nothing changes until you approve.', '14/1.55 · 400'], ['t-small', 'Signed by NVIDIA · hash verified', '12.5/1.45 · 400'], ['t-overline', 'Most likely cause', '11 · 500 · caps'], ['mono', 'torch.cuda.is_available() → False', '13 · Geist Mono']];
const SPACE = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
const RADII = ['r-sm', 'r-md', 'r-lg', 'r-xl', 'r-2xl', 'r-pill'];
const CONF: [Confidence, string][] = [['confirmed', 'Proven by a direct, deterministic test. Only this level can say “the cause is”.'], ['high', 'Several independent pieces of evidence agree; no direct test yet.'], ['medium', 'Plausible and supported, with gaps or one contradiction.'], ['low', 'Possible but weakly supported. Shown so it isn’t forgotten.'], ['unknown', 'Couldn’t be checked. Never shown as healthy.']];
const STATUSES: CheckStatus[] = ['ok', 'warn', 'fail', 'unknown'];
const INC_STATUSES: IncidentStatus[] = ['open', 'diagnosing', 'planned', 'running', 'queued', 'waiting_reboot', 'blocked', 'partially_verified', 'verified', 'closed'];
const ICONS: IconName[] = ['pulse', 'alert', 'check', 'close', 'search', 'shield', 'shieldCheck', 'lock', 'sparkle', 'package', 'folder', 'archive', 'history', 'sliders', 'monitor', 'terminal', 'chip', 'gpu', 'disk', 'wifi', 'restart', 'undo', 'wrench', 'eye', 'bolt', 'grid', 'chevronRight', 'chevronDown', 'arrowRight', 'plus', 'play', 'stop', 'bell', 'clock', 'info', 'download', 'user', 'cloud', 'copy', 'external', 'filter'];

const SAMPLE_AI_ERROR: ApiError = { code: 'E_AI_UNAVAILABLE', headline: 'Explanations paused', didNotHappen: 'Nothing was changed. No fix depends on the AI — diagnosis still runs on rules and tests.', nextStep: 'Try again' };
const SAMPLE_PERMISSION: ApiError = { code: 'E_COLLECTION_PERMISSION', headline: 'Security log needs admin', didNotHappen: 'We couldn’t read it, so anything that depends on it is marked Unknown — not healthy.', nextStep: 'Allow once or skip' };
const SAMPLE_EXPIRED: ApiError = { code: 'E_APPROVAL_EXPIRED', headline: 'This approval ran out', didNotHappen: 'Nothing ran. Approvals last 15 minutes or until restart — we’ll re-check your PC before asking again.', nextStep: 'Re-check and review' };

/** WCAG relative-luminance contrast of two #rrggbb colours; null when a value isn't plain hex. */
function contrast(a: string, b: string): number | null {
  const lum = (hex: string) => {
    const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const [r, g, bl] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const la = lum(a), lb = lum(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function useTokens(names: string[]) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const key = names.join(',');
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    setVals(Object.fromEntries(key.split(',').map((n) => [n, cs.getPropertyValue('--' + n).trim()])));
  }, [key]);
  return vals;
}

function Section({ id, title, sub, children }: { id: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <section id={id} className="col gap-4" aria-labelledby={`${id}-title`} style={{ scrollMarginTop: 16 }}>
      <div className="col" style={{ gap: 4 }}>
        <span className="t-overline">{sub}</span>
        <h2 className="t-h2" id={`${id}-title`}>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Tokens() {
  const v = useTokens([...SURFACES.map((s) => s[0]), ...INKS.map((s) => s[0]), ...SPACE, ...RADII, 'dur-fast', 'dur-base', 'spin', 'shadow-dialog', 'font', 'mono']);
  return (
    <>
      <Card aria-labelledby="tok-surf">
        <h3 className="t-title" id="tok-surf">Surfaces &amp; borders</h3>
        <div className="lib-swatches">
          {SURFACES.map(([n, use]) => (
            <div key={n} className="lib-swatch">
              <span className="box" style={{ background: `var(--${n})` }} aria-hidden="true" />
              <span className="mono">--{n}</span><span className="mono c-subtle">{v[n] || '—'}</span><span className="c-muted">{use}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card aria-labelledby="tok-ink">
        <h3 className="t-title" id="tok-ink">Text, accent &amp; status</h3>
        <div className="lib-swatches">
          {INKS.map(([n, use]) => {
            const ratio = v[n] && v.surface ? contrast(v[n], v.surface) : null;
            return (
              <div key={n} className="lib-swatch">
                <span className="box" style={{ background: 'var(--surface)', color: `var(--${n})` }} aria-hidden="true">Aa</span>
                <span className="mono">--{n}</span><span className="mono c-subtle">{v[n] || '—'}</span>
                <span className="c-muted">{ratio ? `${ratio.toFixed(1)}:1 on surface · ${ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : 'decorative only'}` : 'Contrast measured in the app'} · {use}</span>
              </div>
            );
          })}
        </div>
        <p className="t-small c-subtle">Status colours always come with a word or icon — never colour alone. Tints are the same hue at 12–14 % opacity.</p>
      </Card>
      <Card aria-labelledby="tok-type">
          <h3 className="t-title" id="tok-type">Type · Geist / Geist Mono</h3>
          <div>
            {TYPE.map(([cls, sample, spec]) => (
              <div key={cls} className="lib-typerow"><span className="mono t-small c-subtle">{cls.replace('t-', '')}</span><span className={cls}>{sample}</span><span className="t-small c-subtle">{spec}</span></div>
            ))}
          </div>
      </Card>
      <div className="grid-3" style={{ alignItems: 'start' }}>
          <Card aria-labelledby="tok-space">
            <h3 className="t-title" id="tok-space">Spacing · 4 px base</h3>
            {SPACE.map((n) => <div key={n} className="lib-space"><span className="bar" style={{ width: `var(--${n})` }} aria-hidden="true" /><span className="mono">--{n}</span><span className="c-subtle">{v[n] || '—'}</span></div>)}
          </Card>
          <Card aria-labelledby="tok-radius">
            <h3 className="t-title" id="tok-radius">Radius</h3>
            <div className="lib-demo-row">
              {RADII.map((n) => <div key={n} className="col center" style={{ gap: 6 }}><span className="lib-radius" style={{ borderRadius: `var(--${n})` }} aria-hidden="true" /><span className="mono t-small">--{n}</span><span className="t-small c-subtle">{v[n] || '—'}</span></div>)}
            </div>
          </Card>
          <Card aria-labelledby="tok-motion">
            <h3 className="t-title" id="tok-motion">Motion &amp; elevation</h3>
            <span className="t-small"><span className="mono">--dur-fast</span> {v['dur-fast'] || '—'} · hover, press</span>
            <span className="t-small"><span className="mono">--dur-base</span> {v['dur-base'] || '—'} · panels, expand</span>
            <span className="t-small"><span className="mono">--spin</span> {v.spin || '—'} linear · busy indicator</span>
            <span className="t-small c-subtle">All motion stops under prefers-reduced-motion. Elevation = borders; only dialogs get a shadow.</span>
          </Card>
      </div>
      <Card aria-labelledby="tok-conf">
        <h3 className="t-title" id="tok-conf">Confidence scale (never a percentage)</h3>
        <div className="col gap-3">
          {CONF.map(([c, rule]) => <div key={c} className="row gap-4"><span style={{ width: 140 }}><ConfidenceMeter value={c} /></span><span className="t-small c-muted">{rule}</span></div>)}
        </div>
      </Card>
    </>
  );
}

function Components() {
  const [t1, setT1] = useState(true);
  const [cb, setCb] = useState(true);
  const [seg, setSeg] = useState<'all' | 'issues' | 'fixed'>('all');
  const [os, setOs] = useState<'windows' | 'macos' | 'linux'>('windows');
  const [radio, setRadio] = useState<'a' | 'b'>('a');
  const [dialog, setDialog] = useState(false);
  const inputId = useId();
  const lockedNote = useId();
  return (
    <>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <Card aria-labelledby="c-btn">
          <div className="card-head"><h3 className="t-title" id="c-btn">Button</h3><span className="mono t-small c-subtle">&lt;Button variant size icon /&gt;</span></div>
          <div className="lib-demo-row">
            <Button variant="primary">Primary</Button><Button>Secondary</Button><Button variant="danger">Danger</Button><Button variant="success">Success</Button><Button variant="ghost">Ghost link</Button><Button disabled>Disabled</Button><Button variant="primary" disabled>Primary disabled</Button>
          </div>
          <div className="lib-demo-row">
            <Button size="sm">Small 36</Button><Button>Medium 40</Button><Button size="lg" variant="primary" icon="play">Large 46</Button>
            <Button className="icon-btn" aria-label="Notifications (icon-only)" icon="bell" />
            <LinkButton to="/design" icon="arrowRight" size="sm">LinkButton</LinkButton>
          </div>
          <span className="t-small c-subtle">Focus: 2 px accent outline, 2 px offset. Primary actions are at least 44 px tall.</span>
        </Card>

        <Card aria-labelledby="c-status">
          <div className="card-head"><h3 className="t-title" id="c-status">StatusChip · ConfidenceMeter</h3><span className="mono t-small c-subtle">&lt;StatusChip status /&gt;</span></div>
          <div className="lib-demo-row">
            {STATUSES.map((s) => <StatusChip key={s} status={s} />)}
            <StatusChip status="accent" label="Needs you" /><StatusChip status="neutral" label="Closed" /><span className="chip admin">Admin</span>
          </div>
          <div className="lib-demo-row">{INC_STATUSES.map((s) => <IncidentStatusChip key={s} status={s} />)}</div>
          <div className="lib-demo-row">{STATUSES.map((s) => <span key={s} className="row t-small" style={{ gap: 6 }}><StatusDot status={s} />{s}</span>)}</div>
          <div className="lib-demo-row">{CONF.map(([c]) => <ConfidenceMeter key={c} value={c} />)}</div>
        </Card>

        <Card aria-labelledby="c-form">
          <div className="card-head"><h3 className="t-title" id="c-form">Toggle · Checkbox · Segmented</h3><span className="mono t-small c-subtle">&lt;Toggle locked /&gt;</span></div>
          <div className="lib-demo-row">
            <span className="row t-small" style={{ gap: 8 }}><Toggle checked={t1} onChange={setT1} label="Example toggle" />Try me ({t1 ? 'on' : 'off'})</span>
            <span className="row t-small" style={{ gap: 8 }}><Toggle checked locked label="Locked on example" lockedReason="Always on" describedBy={lockedNote} /><span className="lib-tag"><Icon name="lock" size={10} />Always on</span></span>
            <span className="row t-small" style={{ gap: 8 }}><Toggle checked={false} locked label="Locked off example" lockedReason="Always off" /><span className="lib-tag"><Icon name="lock" size={10} />Always off</span></span>
          </div>
          <span className="t-small c-subtle" id={lockedNote}>Locked toggles never change and always say why.</span>
          <Checkbox checked={cb} onChange={setCb}>Checkbox ({cb ? 'ticked' : 'unticked'})</Checkbox>
          <div className="lib-demo-row">
            <SegmentedControl label="Example segmented" value={seg} onChange={setSeg} options={[{ value: 'all', label: 'All', count: 12 }, { value: 'issues', label: 'Issues', count: 3 }, { value: 'fixed', label: 'Fixed' }]} />
            <SegmentedControl role="radiogroup" label="Example radio segmented" value={os} onChange={setOs} options={[{ value: 'windows', label: 'Windows' }, { value: 'macos', label: 'macOS' }, { value: 'linux', label: 'Linux' }]} />
          </div>
        </Card>

        <Card aria-labelledby="c-radio">
          <div className="card-head"><h3 className="t-title" id="c-radio">RadioCard · Input · Kbd</h3><span className="mono t-small c-subtle">&lt;RadioCard recommended /&gt;</span></div>
          <div className="col gap-3" role="radiogroup" aria-label="Example radio cards">
            <RadioCard checked={radio === 'a'} onSelect={() => setRadio('a')} title="Selected" body="Accent border + filled ring" recommended />
            <RadioCard checked={radio === 'b'} onSelect={() => setRadio('b')} title="Default" body="Quiet border" meta="Meta line" />
          </div>
          <div className="row gap-3">
            <label htmlFor={inputId} className="sr-only">Search incidents</label>
            <input id={inputId} className="input" placeholder="Search incidents" />
            <span style={{ flexShrink: 0, whiteSpace: 'nowrap' }}><Kbd>Ctrl K</Kbd></span>
          </div>
        </Card>

        <Card aria-labelledby="c-tags">
          <div className="card-head"><h3 className="t-title" id="c-tags">EvidenceTag · ListRow</h3><span className="mono t-small c-subtle">&lt;EvidenceTag id kind /&gt;</span></div>
          <div className="lib-demo-row">
            <EvidenceTag id="T-3" /><EvidenceTag id="E-104" /><EvidenceTag id="E-88" kind="secret" />
            <span className="t-small c-subtle">Green = direct test · blue = evidence · amber = sensitive</span>
          </div>
          <div className="list">
            <div className="list-row"><StatusDot status="fail" /><span className="grow">Stability</span><span className="note fail">5 freezes in 7 days</span></div>
            <div className="list-row"><StatusDot status="unknown" /><span className="grow">Docker</span><span className="note unknown">Engine off — unknown, not healthy</span></div>
          </div>
        </Card>

        <Card aria-labelledby="c-progress">
          <div className="card-head"><h3 className="t-title" id="c-progress">ProgressRing · Stepper · Busy</h3><span className="mono t-small c-subtle">&lt;ProgressRing value /&gt;</span></div>
          <div className="lib-demo-row">
            <ProgressRing value={0} label="Example progress 0 of 5"><span className="t-small">0/5</span></ProgressRing>
            <ProgressRing value={60} color="var(--warn)" label="Example progress 3 of 5"><span className="t-small">3/5</span></ProgressRing>
            <ProgressRing value={100} color="var(--ok)" label="Example progress 5 of 5"><span className="t-small">5/5</span></ProgressRing>
          </div>
          <LoopStepper current="Act" />
          <div className="lib-demo-row"><Spinner label="Example busy indicator" /><span className="t-small c-muted">Spinner</span></div>
          <div className="col gap-1" style={{ width: 240 }}><Skeleton h={14} w="70%" /><Skeleton h={14} /><span className="t-small c-subtle">Skeleton</span></div>
          <div className="toast" style={{ boxShadow: 'none' }}>
            <span className="dot ok" style={{ marginTop: 6 }} aria-hidden="true" />
            <span className="col grow" style={{ gap: 2 }}><span className="t-small" style={{ fontWeight: 600 }}>INC-0042 fixed and verified</span><span className="t-small c-muted">Toast sample</span></span>
          </div>
        </Card>
      </div>

      <Card aria-labelledby="c-dialog">
        <div className="card-head"><h3 className="t-title" id="c-dialog">Dialog · Banner</h3><span className="mono t-small c-subtle">&lt;Dialog label onClose /&gt;</span></div>
        <div className="lib-demo-row"><Button onClick={() => setDialog(true)}>Open example dialog</Button><span className="t-small c-subtle">Traps focus; Esc closes; focus returns to the opener.</span></div>
        <div className="col gap-3 lib-bannerbox">
          <Banner kind="info" role="status">Info banner — you’re offline; scans still work.</Banner>
          <Banner kind="warn" role="status">Warning banner — history restored from backup.</Banner>
          <Banner kind="danger" role="status">Danger banner — the admin helper failed a safety check. All repairs paused.</Banner>
        </div>
        {dialog && (
          <Dialog label="Example dialog" onClose={() => setDialog(false)} center width={420}>
            <div className="col gap-3" style={{ padding: 22 }}>
              <h4 className="t-title">Example dialog</h4>
              <p className="t-small c-muted">Press Esc or use a button to close.</p>
              <div className="row end gap-3"><Button onClick={() => setDialog(false)}>Close</Button></div>
            </div>
          </Dialog>
        )}
      </Card>

      <Card aria-labelledby="c-icons">
        <div className="card-head"><h3 className="t-title" id="c-icons">Icon set · 24 px grid · 1.8 stroke · round caps</h3><span className="mono t-small c-subtle">&lt;Icon name /&gt;</span></div>
        <ul className="lib-icons" style={{ margin: 0, padding: 0 }}>
          {ICONS.map((n) => <li key={n}><Icon name={n} size={20} /><span className="mono">{n}</span></li>)}
        </ul>
      </Card>
    </>
  );
}

function States() {
  return (
    <div className="grid-3">
      <Card className="lib-state-card" aria-labelledby="s-loading">
        <div className="card-head"><h3 className="t-title" id="s-loading">Loading</h3><span className="mono t-small c-subtle">skeleton</span></div>
        <LoadingState label="Loading evidence…" />
        <span className="t-small c-subtle">Replaced by content, never a spinner alone.</span>
      </Card>
      <Card className="lib-state-card" aria-labelledby="s-empty">
        <div className="card-head"><h3 className="t-title" id="s-empty">Empty · no incidents</h3><span className="mono t-small c-subtle">empty</span></div>
        <EmptyState title="All clear" body="Nothing needs you. The last scan found no problems." action={<LinkButton to="/diagnose" size="sm">Describe a problem</LinkButton>} />
      </Card>
      <Card className="lib-state-card" aria-labelledby="s-empty2">
        <div className="card-head"><h3 className="t-title" id="s-empty2">Empty · no projects</h3><span className="mono t-small c-subtle">empty</span></div>
        <EmptyState icon="folder" title="No projects yet" body="Add a folder. We read requirement files like package.json — never your code." action={<LinkButton to="/settings/diagnostics" size="sm">Add project folder</LinkButton>} />
      </Card>
      <Card className="lib-state-card" aria-labelledby="s-error">
        <div className="card-head"><h3 className="t-title" id="s-error">Error · AI not responding</h3><span className="mono t-small c-subtle">E_AI_UNAVAILABLE</span></div>
        <ErrorState error={SAMPLE_AI_ERROR} onRetry={() => undefined} compact />
      </Card>
      <Card className="lib-state-card" aria-labelledby="s-perm">
        <div className="card-head"><h3 className="t-title" id="s-perm">Error · couldn’t read a source</h3><span className="mono t-small c-subtle">E_COLLECTION_PERMISSION</span></div>
        <ErrorState error={SAMPLE_PERMISSION} compact />
      </Card>
      <Card className="lib-state-card" aria-labelledby="s-offline">
        <div className="card-head"><h3 className="t-title" id="s-offline">Offline</h3><span className="mono t-small c-subtle">banner</span></div>
        <div className="lib-bannerbox"><Banner kind="info" role="status">You’re offline. Scans, diagnosis and most fixes work fully offline.</Banner></div>
        <span className="t-small c-muted">Paused: driver and package downloads · cloud AI (if you turned it on).</span>
        <span className="t-small c-subtle">Banner only — never blocks the app.</span>
      </Card>
      <Card className="lib-state-card" aria-labelledby="s-expired">
        <div className="card-head"><h3 className="t-title" id="s-expired">Approval expired</h3><span className="mono t-small c-subtle">E_APPROVAL_EXPIRED</span></div>
        <ErrorState error={SAMPLE_EXPIRED} onRetry={() => undefined} compact />
        <span className="t-small c-muted" style={{ textAlign: 'center' }}>This approval ran out · Nothing ran</span>
      </Card>
      <Card className="lib-state-card" aria-labelledby="s-busy">
        <div className="card-head"><h3 className="t-title" id="s-busy">Another repair running</h3><span className="mono t-small c-subtle">E_MUTATION_BUSY</span></div>
        <div className="state" style={{ padding: 16 }}>
          <span className="state-icon"><Spinner label="Queued" /></span>
          <span className="t-title" style={{ color: 'var(--text)' }}>Queued behind INC-0043</span>
          <span className="t-small">Only one repair controls your PC at a time. This one starts when the current repair is verified.</span>
          <span className="t-small c-subtle">Position 1 in queue · you can cancel any time</span>
          <Button size="sm">Cancel</Button>
        </div>
      </Card>
      <Card className="lib-state-card" aria-labelledby="s-restored">
        <div className="card-head"><h3 className="t-title" id="s-restored">Data repaired</h3><span className="mono t-small c-subtle">E_STORAGE_CORRUPT</span></div>
        <div className="lib-bannerbox"><Banner kind="warn" role="status">History restored from backup</Banner></div>
        <span className="t-small c-muted">The history failed its integrity check at start-up, so the last backup was restored. The recovery journal was not affected.</span>
        <LinkButton to="/history" size="sm">What happened</LinkButton>
      </Card>
    </div>
  );
}

export default function DesignSystem() {
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ block: 'start' });
  return (
    <Page crumbs={[{ label: 'Settings', to: '/settings/general' }, { label: 'Design system' }]} actions={<span className="t-small c-subtle">tokens.css · ui.tsx · v1.0</span>}>
      <div className="row between start gap-5 wrap">
        <div className="col" style={{ gap: 6 }}>
          <h1 className="t-h1">Design system</h1>
          <p className="c-muted" style={{ fontSize: 14 }}>The real tokens and components every screen is built from, in all their states. Values are read live from the running app.</p>
        </div>
        <div className="row gap-1" role="group" aria-label="Jump to section">
          <Button size="sm" variant="ghost" onClick={() => jump('ds-tokens')}>Tokens</Button>
          <Button size="sm" variant="ghost" onClick={() => jump('ds-components')}>Components</Button>
          <Button size="sm" variant="ghost" onClick={() => jump('ds-states')}>States</Button>
        </div>
      </div>
      <Section id="ds-tokens" title="Design tokens" sub="Board 23 · tokens.css">
        <Tokens />
      </Section>
      <Section id="ds-components" title="Component library" sub="Board 24 · ui.tsx">
        <Components />
      </Section>
      <Section id="ds-states" title="Loading, empty, error & edge states" sub="Board 25 · states">
        <p className="t-small c-muted">Every error says what happened, what didn’t happen, and one next step. Codes appear only in details.</p>
        <States />
      </Section>
    </Page>
  );
}
