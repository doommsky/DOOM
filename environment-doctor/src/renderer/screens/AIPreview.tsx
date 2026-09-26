/**
 * Board 21 · What the AI sees (/evidence/preview/:incident). Raw vs redacted, per-item consent.
 * Sending is a no-op in this build: nothing leaves the PC, and unticked items are never part of any request.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { RedactionPair } from '../../shared/contracts';
import { useApp } from '../AppContext';
import { useApi } from '../hooks/useApi';
import { Page } from '../components/Shell';
import { Icon } from '../components/Icon';
import { Button, EmptyState, ErrorState, LinkButton, LoadingState, SegmentedControl } from '../components/ui';
import '../styles/diagnosis.css';

type Mode = 'local' | 'cloud';

export default function AIPreview() {
  const { incident = '' } = useParams();
  const nav = useNavigate();
  const { notify } = useApp();
  const preview = useApi('redaction.preview', { incidentId: incident }, [incident]);
  const settings = useApi('settings.get', undefined, []);
  const [mode, setMode] = useState<Mode>('local');
  const [off, setOff] = useState<Record<string, boolean>>({});

  const aiMode = settings.data?.privacy.aiMode;
  useEffect(() => { if (aiMode) setMode(aiMode === 'cloud' ? 'cloud' : 'local'); }, [aiMode]);
  useEffect(() => { setOff({}); }, [incident]);

  const pairs = preview.data?.pairs ?? [];
  const sent = useMemo(() => pairs.filter((p) => !off[p.id]), [pairs, off]);
  const kb = sent.reduce((a, p) => a + p.kb, 0);
  const cloud = mode === 'cloud';
  const back = `/incidents/${incident}`;

  const send = () => {
    const ids = sent.map((p) => p.id); // only ticked items — unticked IDs are never part of this
    if (!ids.length) return;
    notify(cloud
      ? { kind: 'info', title: 'Nothing was sent', body: `Would send ${ids.length} redacted ${ids.length === 1 ? 'item' : 'items'} (${ids.join(', ')}). No cloud provider is configured in this build.` }
      : { kind: 'info', title: 'Nothing left this PC', body: `An on-device explanation would use ${ids.join(', ')}. Local explanations aren’t available in this build.` });
    nav(back);
  };

  const crumbs = [{ label: 'Evidence', to: '/evidence' }, { label: <span className="mono">{incident}</span>, to: back }, { label: 'What the AI would see' }];
  const actions = (
    <SegmentedControl<Mode>
      label="Where the AI runs" role="radiogroup" value={mode} onChange={setMode}
      options={[
        { value: 'local', label: <><span className="dot ok" aria-hidden="true" />On this PC</> },
        { value: 'cloud', label: <><span className="dot warn" aria-hidden="true" />Cloud AI</> },
      ]}
    />
  );

  if (preview.error) return <Page crumbs={crumbs}><ErrorState error={preview.error} onRetry={() => void preview.reload()} /><LinkButton to={back} variant="ghost">Back to the incident</LinkButton></Page>;
  if (!preview.data) return <Page crumbs={crumbs}><LoadingState label="Preparing the preview…" /></Page>;

  return (
    <Page crumbs={crumbs} actions={actions}>
      <div className="row between wrap" style={{ alignItems: 'flex-end', gap: 20 }}>
        <div className="col" style={{ gap: 6 }}>
          <h1 className="t-h1">Exactly what would leave this PC</h1>
          <p className="c-muted" style={{ fontSize: 14 }}>For <span className="mono" style={{ color: 'var(--text)' }}>{incident}</span>. Names, paths and secrets are replaced before anything is sent. Untick anything you’d rather keep back.</p>
        </div>
        <span className={`aip-mode-note ${mode}`} role="status">
          <Icon name={cloud ? 'cloud' : 'shieldCheck'} size={15} />
          {cloud ? 'Cloud AI · only the redacted items on the right' : 'On-device AI · nothing leaves this PC'}
        </span>
      </div>
      {aiMode === 'off' && <p className="t-small c-muted"><Icon name="info" size={13} /> AI explanations are off in Settings — this is a preview only.</p>}

      {pairs.length === 0
        ? <EmptyState icon="archive" title="No evidence to explain" body="This incident has no collected evidence, so there is nothing an AI could receive." action={<LinkButton to={back}>Back to the incident</LinkButton>} />
        : (
          <div className="aip-cols">
            <section className="card aip-col" aria-labelledby="aip-in-h">
              <div className="aip-col-head">
                <Icon name="monitor" size={16} className="c-muted" />
                <h2 id="aip-in-h" className="t-title" style={{ fontSize: 14 }}>On your PC</h2>
                <span className="t-small c-warn" style={{ marginLeft: 'auto' }}>Highlighted = private</span>
              </div>
              <ul className="aip-list">
                {pairs.map((p) => <RawItem key={p.id} p={p} on={!off[p.id]} toggle={(v) => setOff((o) => ({ ...o, [p.id]: !v }))} />)}
              </ul>
            </section>

            <div className="aip-mid" aria-hidden="true">
              <span className="aip-mid-icon"><Icon name="arrowRight" size={17} /></span>
              <span className="c-subtle" style={{ fontSize: 11 }}>redact</span>
            </div>

            <section className="card aip-col out" aria-labelledby="aip-out-h">
              <div className="aip-col-head">
                <Icon name={cloud ? 'cloud' : 'shieldCheck'} size={16} className="c-accent" />
                <h2 id="aip-out-h" className="t-title" style={{ fontSize: 14 }}>What the AI receives</h2>
                <span className="mono c-subtle" style={{ marginLeft: 'auto', fontSize: 12 }} aria-live="polite" data-testid="aip-count">{sent.length} {sent.length === 1 ? 'item' : 'items'} · {kb.toFixed(1)} KB</span>
              </div>
              {sent.length === 0
                ? <p className="aip-empty">Nothing selected — nothing will be sent.</p>
                : (
                  <ul className="aip-list" aria-label="Items the AI would receive">
                    {sent.map((p) => (
                      <li key={p.id} className="col" style={{ gap: 4, padding: '10px 18px' }} data-sent={p.id}>
                        <span className="row" style={{ gap: 8 }}><span className="mono c-accent" style={{ fontSize: 11 }}>{p.id}</span><span className="t-small c-muted">{p.label}</span></span>
                        <span className="aip-raw">{p.rawA}<mark className="aip-safe">{p.safe}</mark>{p.rawB}</span>
                      </li>
                    ))}
                  </ul>
                )}
            </section>
          </div>
        )}

      <div className="row gap-3 wrap">
        <span className="row t-small c-muted" style={{ gap: 8 }}><Icon name="lock" size={14} />Never sent: {preview.data.neverSent.join(', ')}</span>
        <span className="grow" />
        <LinkButton to={back}>Keep it on this PC</LinkButton>
        <Button variant="primary" icon={cloud ? 'cloud' : 'sparkle'} onClick={send} disabled={sent.length === 0} aria-describedby={sent.length === 0 ? 'aip-why' : undefined}>
          {cloud ? `Send ${sent.length} ${sent.length === 1 ? 'item' : 'items'} to cloud AI` : 'Explain on this PC'}
        </Button>
        {sent.length === 0 && <span id="aip-why" className="sr-only">Nothing is selected.</span>}
      </div>
    </Page>
  );
}

function RawItem({ p, on, toggle }: { p: RedactionPair; on: boolean; toggle: (v: boolean) => void }) {
  const id = `aip-item-${p.id}`;
  return (
    <li className={`aip-item ${on ? '' : 'off'}`} data-item={p.id}>
      <input id={id} type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} aria-describedby={`${id}-raw`} />
      <span className="col" style={{ gap: 4, minWidth: 0 }}>
        <label htmlFor={id}><span className="mono c-accent" style={{ fontSize: 11 }}>{p.id}</span><span className="t-small c-muted">{p.label}</span></label>
        <span id={`${id}-raw`} className="aip-raw">{p.rawA}<mark className="aip-private">{p.rawSecret}</mark><span className="sr-only"> (private)</span>{p.rawB}</span>
      </span>
    </li>
  );
}
