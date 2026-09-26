/** Board 01 · First run (FullBleed, outside the shell): what it does → where the AI runs → first scan scope. */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AiMode, ApiError, ScanScope } from '../../shared/contracts';
import { call } from '../api/client';
import { Icon } from '../components/Icon';
import { Button, Checkbox, ErrorState, RadioCard } from '../components/ui';
import '../styles/start.css';

const STEPS = ['What it does', 'Privacy', 'First scan'] as const;

const AI_OPTIONS: { value: AiMode; title: string; body: string; meta: string; recommended?: boolean }[] = [
  { value: 'local', title: 'On this PC', body: 'Explanations come from a model running locally. Nothing leaves your machine.', meta: 'Private', recommended: true },
  { value: 'cloud', title: 'On this PC, cloud when needed', body: 'For hard problems, send redacted evidence to a cloud AI — only after you preview it.', meta: 'Smarter on rare problems' },
  { value: 'off', title: 'Off', body: 'Rules and direct tests only. Diagnosis still works; explanations are shorter.', meta: 'No AI at all' },
];

const SCOPES: { key: ScanScope; title: string; body: string }[] = [
  { key: 'pc', title: 'This PC', body: 'Stability, crashes, drivers, disk, memory, updates' },
  { key: 'dev', title: 'Dev tools', body: 'PATH, Node, Python, Git, Docker, WSL, CUDA, build tools' },
  { key: 'proj', title: 'Projects', body: 'Reads package.json, pyproject.toml and similar — never your code' },
];

export default function Welcome() {
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  // Default is on-device; cloud is only ever set when the person picks it (AC-01).
  const [ai, setAi] = useState<AiMode>('local');
  const [scope, setScope] = useState<Record<ScanScope, boolean>>({ pc: true, dev: true, proj: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const aiRefs = useRef<(HTMLDivElement | null)[]>([]);

  const chosen = SCOPES.filter((s) => scope[s.key]).map((s) => s.key);

  const saveAi = async () => {
    setBusy(true);
    setError(null);
    const r = await call('settings.set', { path: 'privacy.aiMode', value: ai });
    setBusy(false);
    if (!r.ok) { setError(r.error); return false; }
    return true;
  };

  const next = async () => {
    if (step === 1 && !(await saveAi())) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const startScan = async (scopes: ScanScope[]) => {
    setBusy(true);
    setError(null);
    const r = await call('scan.start', { scopes });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    nav('/scan');
  };

  const onAiKey = (e: React.KeyboardEvent) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const i = AI_OPTIONS.findIndex((o) => o.value === ai);
    const n = (i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + AI_OPTIONS.length) % AI_OPTIONS.length;
    setAi(AI_OPTIONS[n].value);
    aiRefs.current[n]?.querySelector('button')?.focus();
  };

  return (
    <div className="fullbleed">
      <main className="wel" id="main">
        <div className="row between">
          <div className="wel-brand">
            <span className="brand-mark"><Icon name="pulse" size={22} stroke={2.2} /></span>
            Environment Doctor
          </div>
          <ol className="wel-steps" aria-label="Setup steps">
            {STEPS.map((label, i) => (
              <li key={label} aria-current={i === step ? 'step' : undefined} className={i < step ? 'done' : ''}>
                <span className="num" aria-hidden="true">{i < step ? <Icon name="check" size={12} stroke={2.6} /> : i + 1}</span>
                <span>{label}{i < step && <span className="sr-only"> (done)</span>}</span>
                {i < STEPS.length - 1 && <span className="line" aria-hidden="true" />}
              </li>
            ))}
          </ol>
        </div>

        {step === 0 && (
          <section className="col gap-6" aria-labelledby="wel-h">
            <div className="col" style={{ gap: 10 }}>
              <h1 id="wel-h" className="t-display">Your PC and dev setup,<br />looked after like a technician would.</h1>
              <p className="wel-lead">Set things up, find out why something broke, fix it safely — and prove it’s actually fixed.</p>
            </div>
            <div className="grid-3" style={{ gap: 14 }}>
              <div className="wel-feature">
                <span className="tint-icon accent"><Icon name="package" size={20} /></span>
                <h2 className="t-title">Set up</h2>
                <p>Get a project or new PC ready. Dry run first, only what’s missing gets installed.</p>
              </div>
              <div className="wel-feature">
                <span className="tint-icon danger"><Icon name="search" size={20} /></span>
                <h2 className="t-title">Diagnose</h2>
                <p>Freezes, crashes, drivers, PATH, CUDA, Docker. Evidence first, likely cause second.</p>
              </div>
              <div className="wel-feature">
                <span className="tint-icon ok"><Icon name="check" size={20} stroke={2.1} /></span>
                <h2 className="t-title">Fix &amp; verify</h2>
                <p>Only safe, pre-approved actions — each one checked afterwards, with a way back.</p>
              </div>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="col gap-5" aria-labelledby="wel-h">
            <div className="col" style={{ gap: 10 }}>
              <h1 id="wel-h" className="wel-h1">Where should the AI think?</h1>
              <p className="wel-lead" style={{ fontSize: 16 }}>You can change this any time in Settings. Cloud is only used if you pick it.</p>
            </div>
            <div className="wel-ai" role="radiogroup" aria-labelledby="wel-h" onKeyDown={onAiKey}>
              {AI_OPTIONS.map((o, i) => (
                <div key={o.value} ref={(el) => { aiRefs.current[i] = el; }}>
                  <RadioCard checked={ai === o.value} onSelect={() => setAi(o.value)} title={o.title} body={o.body} meta={o.meta} recommended={o.recommended} name={o.value} />
                </div>
              ))}
            </div>
            <div className="wel-always">
              <span className="head">Always, whatever you choose</span>
              <ul>
                <li><Icon name="check" size={15} stroke={2.4} />Secrets are never read</li>
                <li><Icon name="check" size={15} stroke={2.4} />You approve every change</li>
                <li><Icon name="check" size={15} stroke={2.4} />Admin only via Windows’ prompt</li>
              </ul>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="col gap-5" aria-labelledby="wel-h">
            <div className="col" style={{ gap: 10 }}>
              <h1 id="wel-h" className="wel-h1">What should the first scan cover?</h1>
              <p className="wel-lead" style={{ fontSize: 16 }}>Read-only. Takes about 2 minutes. Nothing changes.</p>
            </div>
            <fieldset className="col" style={{ gap: 10, border: 0, margin: 0, padding: 0 }}>
              <legend className="sr-only">Areas to scan</legend>
              {SCOPES.map((s) => (
                <div key={s.key} className={`wel-scope ${scope[s.key] ? 'on' : ''}`}>
                  <Checkbox checked={scope[s.key]} onChange={(v) => setScope((x) => ({ ...x, [s.key]: v }))}>
                    <span className="col" style={{ gap: 3 }}>
                      <span className="t-title">{s.title}</span>
                      <span className="t-small c-muted" style={{ fontSize: 13 }}>{s.body}</span>
                    </span>
                  </Checkbox>
                </div>
              ))}
            </fieldset>
            {chosen.length === 0 && <p className="t-small c-warn" role="status">Pick at least one area to scan.</p>}
          </section>
        )}

        {error && <ErrorState error={error} compact />}

        <div className="wel-foot">
          {step > 0
            ? <Button size="lg" onClick={() => { setError(null); setStep((s) => Math.max(0, s - 1)); }} disabled={busy}>Back</Button>
            : <span className="t-small c-subtle" style={{ fontSize: 13 }}>Windows · macOS · Linux · desktop app and terminal</span>}
          <div className="row gap-3">
            <Button variant="ghost" onClick={() => void startScan(['pc', 'dev', 'proj'])} disabled={busy} title="Keeps the AI setting as it is and scans everything, read-only">
              Skip and scan everything
            </Button>
            {step < STEPS.length - 1
              ? <Button variant="primary" size="lg" onClick={() => void next()} disabled={busy}>Continue</Button>
              : <Button variant="primary" size="lg" icon="play" onClick={() => void startScan(chosen)} disabled={busy || chosen.length === 0}>Run first scan</Button>}
          </div>
        </div>
      </main>
    </div>
  );
}
