/** Board 08 · Describe a problem (/diagnose). Free-text symptom, timing, and the read-only sources to collect. */
import { useEffect, useId, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { ApiError, DiagnoseRequest, DiagnosisSource } from '../../shared/contracts';
import { useAction, useApi } from '../hooks/useApi';
import { Page } from '../components/Shell';
import { Icon } from '../components/Icon';
import { Button, EmptyState, ErrorState, LoadingState, Toggle } from '../components/ui';
import '../styles/diagnosis.css';

const MAX = 500;
const SENSITIVE_LABEL = 'Sensitive · stays on this PC';

const EXAMPLES: { label: string; tone: 'fail' | 'accent' | 'warn' }[] = [
  { label: 'My laptop keeps freezing', tone: 'fail' }, { label: 'Blue screen after sleep', tone: 'fail' }, { label: 'PyTorch can’t see my GPU', tone: 'accent' },
  { label: 'npm run dev fails', tone: 'accent' }, { label: 'PC is slow to start', tone: 'warn' }, { label: 'Docker won’t start', tone: 'accent' },
];
const WHENS: { k: DiagnoseRequest['when']; label: string }[] = [{ k: 'today', label: 'Today' }, { k: 'week', label: 'This week' }, { k: 'update', label: 'After an update' }, { k: 'unsure', label: 'Not sure' }];
const FREQS: { k: DiagnoseRequest['frequency']; label: string }[] = [{ k: 'once', label: 'Once' }, { k: 'daily', label: 'Daily' }, { k: 'always', label: 'All the time' }, { k: 'random', label: 'Randomly' }];

/** Same heuristic as the board: a hint only — the orchestrator decides what the diagnosis is. */
export function understoodHint(text: string) {
  const low = text.toLowerCase();
  const pc = /freez|crash|blue|bsod|restart|slow|sleep|driver|hang/.test(low);
  const dev = /node|npm|pip|python|cuda|torch|docker|git|path|build/.test(low);
  if (!text.trim()) return 'Tell us what you see';
  if (pc && dev) return 'Sounds like a PC and a dev-setup problem';
  if (pc) return 'Sounds like a PC stability problem';
  if (dev) return 'Sounds like a dev-environment problem';
  return 'We’ll run a broad check';
}

export default function Describe() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const sources = useApi('diagnose.sources', undefined, []);
  const start = useAction('diagnose.start');
  const [text, setText] = useState(() => (params.get('q') ?? '').slice(0, MAX));
  const [when, setWhen] = useState<DiagnoseRequest['when']>('unsure');
  const [freq, setFreq] = useState<DiagnoseRequest['frequency']>('random');
  const [on, setOn] = useState<Record<string, boolean>>({});
  const ids = { text: useId(), hint: useId(), count: useId(), when: useId(), freq: useId(), why: useId() };

  // Prefill follows the query (palette “Diagnose: …” can navigate here while already open).
  const q = params.get('q');
  useEffect(() => { if (q !== null) setText(q.slice(0, MAX)); }, [q]);

  // Sensitive sources are always OFF until the user turns them on (AC-17), whatever the default says.
  useEffect(() => {
    if (sources.data) setOn(Object.fromEntries(sources.data.map((s) => [s.key, s.defaultOn && !s.sensitive])));
  }, [sources.data]);

  const list = sources.data ?? [];
  const onCount = list.filter((s) => on[s.key]).length;
  const sensitiveOn = list.some((s) => s.sensitive && on[s.key]);
  const hint = useMemo(() => understoodHint(text), [text]);
  const empty = !text.trim();

  const submit = async () => {
    if (empty) return;
    const r = await start.run({ symptom: text.trim(), when, frequency: freq, sources: list.filter((s) => on[s.key]).map((s) => s.key) });
    if (r.ok) nav(`/incidents/${r.data.incidentId}`);
  };

  return (
    <Page
      crumbs={[{ label: 'Incidents', to: '/incidents' }, { label: 'New diagnosis' }]}
      actions={<span className="row t-small c-muted" style={{ gap: 8 }}><Icon name="eye" size={15} />Looking only — nothing changes during a diagnosis</span>}
    >
      <div className="ask-layout">
      <div className="ask-primary">
      <div className="col" style={{ gap: 8 }}>
        <h1 className="ask-h1">What’s going wrong?</h1>
        <p className="c-muted" style={{ fontSize: 15 }}>Describe it like you’d tell a technician. PC problems and dev-setup problems both work.</p>
      </div>

      <div className={`ask-box ${text ? 'filled' : ''}`}>
        <label htmlFor={ids.text} className="t-overline">Describe the problem</label>
        <textarea
          id={ids.text} className="ask-textarea" rows={3} maxLength={MAX} value={text}
          placeholder="e.g. My laptop keeps freezing, usually after it wakes from sleep"
          aria-describedby={`${ids.hint} ${ids.count}`}
          onChange={(e) => setText(e.target.value.slice(0, MAX))}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); } }}
        />
        <span className="row between">
          <span id={ids.hint} className="row t-small c-subtle" style={{ gap: 7 }} aria-live="polite"><Icon name="sparkle" size={14} />{hint}</span>
          <span id={ids.count} className="mono c-subtle" style={{ fontSize: 11.5 }}><span aria-hidden="true">{text.length} / {MAX}</span><span className="sr-only">{text.length} of {MAX} characters</span></span>
        </span>
      </div>

      <div className="col" style={{ gap: 10 }}>
        <h2 className="t-overline">Common problems</h2>
        <div className="ask-chips">
          {EXAMPLES.map((x) => (
            <button key={x.label} type="button" className="ask-chip" onClick={() => setText(x.label)} aria-label={`Use example: ${x.label}`}>
              <span className={`dot ${x.tone}`} aria-hidden="true" />{x.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid-2">
        <div className="card" style={{ padding: '16px 18px', gap: 10 }}>
          <h2 id={ids.when} className="t-small" style={{ fontSize: 13, fontWeight: 600 }}>When did it start?</h2>
          <div className="ask-pills" role="group" aria-labelledby={ids.when}>
            {WHENS.map((w) => <button key={w.k} type="button" className="pill-btn" aria-pressed={when === w.k} onClick={() => setWhen(w.k)}>{w.label}</button>)}
          </div>
        </div>
        <div className="card" style={{ padding: '16px 18px', gap: 10 }}>
          <h2 id={ids.freq} className="t-small" style={{ fontSize: 13, fontWeight: 600 }}>How often?</h2>
          <div className="ask-pills" role="group" aria-labelledby={ids.freq}>
            {FREQS.map((w) => <button key={w.k} type="button" className="pill-btn" aria-pressed={freq === w.k} onClick={() => setFreq(w.k)}>{w.label}</button>)}
          </div>
        </div>
      </div>

      {start.error && <ErrorState error={start.error} onRetry={() => void submit()} retryLabel="Try again" />}

      <div className="row gap-4 wrap" style={{ marginTop: 'auto' }}>
        <Button variant="primary" size="lg" icon={start.busy ? undefined : 'search'} onClick={submit} disabled={empty || start.busy} aria-busy={start.busy || undefined} aria-describedby={empty ? ids.why : undefined}>
          {start.busy ? 'Looking…' : 'Start diagnosis'}
        </Button>
        {empty
          ? <span id={ids.why} className="t-small c-muted">Describe the problem first.</span>
          : <span className="t-small c-muted">About {sensitiveOn ? '4' : '2'} minutes · {onCount} {onCount === 1 ? 'source' : 'sources'} · you can keep working</span>}
      </div>
      </div>
      <SourcesAside list={list} on={on} setOn={setOn} onCount={onCount} loading={sources.loading} error={sources.error} retry={() => void sources.reload()} />
      </div>
    </Page>
  );
}

function SourcesAside({ list, on, setOn, onCount, loading, error, retry }: {
  list: DiagnosisSource[]; on: Record<string, boolean>; setOn: (f: (o: Record<string, boolean>) => Record<string, boolean>) => void;
  onCount: number; loading: boolean; error: ApiError | null; retry: () => void;
}) {
  return (
    <aside className="card ask-aside" aria-labelledby="ask-src-h">
      <div className="row between">
        <h2 id="ask-src-h" className="t-title">What we’ll look at</h2>
        {list.length > 0 && <span className="t-small c-subtle" aria-live="polite">{onCount} of {list.length} on</span>}
      </div>
      <p className="t-small c-muted">Read-only sources on this PC. Anything sensitive stays off until you turn it on.</p>
      {loading && !list.length && <LoadingState label="Loading sources…" />}
      {error && <ErrorState error={error} onRetry={retry} compact />}
      {!loading && !error && list.length === 0 && <EmptyState title="No sources available" body="This build can’t collect diagnosis evidence." />}
      <ul className="ask-src-list">
        {list.map((s) => {
          const noteId = `ask-src-note-${s.key}`;
          const showNote = s.note && s.note !== SENSITIVE_LABEL;
          return (
            <li key={s.key} className="ask-src" data-source={s.key}>
              <span className={`ask-src-icon ${s.sensitive ? 'sensitive' : ''}`} aria-hidden="true">
                {s.sensitive ? <Icon name="lock" size={14} className="c-warn" /> : <span className={`dot ${on[s.key] ? 'ok' : 'neutral'}`} />}
              </span>
              <span className="col grow" style={{ gap: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13.5 }}>{s.name}</span>
                <span id={noteId} className={`ask-src-note ${s.sensitive ? 'sensitive' : ''}`}>
                  {s.sensitive ? SENSITIVE_LABEL : s.note}{s.sensitive && showNote ? ` · ${s.note}` : ''}
                </span>
              </span>
              <Toggle checked={!!on[s.key]} onChange={(v) => setOn((o) => ({ ...o, [s.key]: v }))} label={s.name} describedBy={noteId} />
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
