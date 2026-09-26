/** Board 24 · component library. Every screen is built from these. */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ApiError, CheckStatus, Confidence, IncidentStatus, JournalState } from '../../shared/contracts';
import { Icon, type IconName } from './Icon';

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
type BtnSize = 'sm' | 'md' | 'lg';

export function Button({ variant = 'secondary', size = 'md', icon, children, className = '', ...rest }: { variant?: BtnVariant; size?: BtnSize; icon?: IconName } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`btn ${variant === 'secondary' ? '' : variant} ${size === 'md' ? '' : size} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={size === 'lg' ? 17 : 15} />}
      {children}
    </button>
  );
}

export function LinkButton({ to, variant = 'secondary', size = 'md', icon, children, ...rest }: { to: string; variant?: BtnVariant; size?: BtnSize; icon?: IconName; children: ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return (
    <Link to={to} className={`btn ${variant === 'secondary' ? '' : variant} ${size === 'md' ? '' : size}`} {...rest}>
      {icon && <Icon name={icon} size={size === 'lg' ? 17 : 15} />}
      {children}
    </Link>
  );
}

const STATUS_WORD: Record<CheckStatus, string> = { ok: 'Healthy', warn: 'Attention', fail: 'Failing', unknown: 'Unknown' };

/** Status is never colour alone: always a word plus a dot/dash (a11y + UI rule 9). */
export function StatusChip({ status, label }: { status: CheckStatus | 'accent' | 'neutral'; label?: string }) {
  const word = label ?? (status in STATUS_WORD ? STATUS_WORD[status as CheckStatus] : '');
  return (
    <span className={`chip ${status}`}>
      {status !== 'unknown' && <span className={`dot ${status}`} aria-hidden="true" />}
      {word}
    </span>
  );
}

export function StatusDot({ status }: { status: CheckStatus }) {
  return <span className={`dot ${status}`} role="img" aria-label={STATUS_WORD[status]} />;
}

const CONF: Record<Confidence, { label: string; bars: number }> = {
  confirmed: { label: 'Confirmed', bars: 5 }, high: { label: 'High', bars: 4 }, medium: { label: 'Medium', bars: 3 }, low: { label: 'Low', bars: 1 }, unknown: { label: 'Unknown', bars: 0 },
};

/** Confidence is a label, never a percentage (spec §23, UI rule 8). */
export function ConfidenceMeter({ value, showLabel = true }: { value: Confidence; showLabel?: boolean }) {
  const c = CONF[value];
  return (
    <span className={`conf ${value}`} data-confidence={value}>
      <span className="conf-bars" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <span key={i} className={i < c.bars ? 'on' : ''} />)}</span>
      {showLabel ? <span>{c.label}</span> : <span className="sr-only">{c.label}</span>}
    </span>
  );
}
export const confidenceLabel = (c: Confidence) => CONF[c].label;

export function Toggle({ checked, onChange, label, locked, lockedReason, describedBy }: { checked: boolean; onChange?: (v: boolean) => void; label: string; locked?: boolean; lockedReason?: string; describedBy?: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label} aria-disabled={locked || undefined} aria-describedby={describedBy}
      className={`toggle ${locked ? 'locked' : ''}`} title={locked ? lockedReason : undefined}
      onClick={() => { if (!locked) onChange?.(!checked); }}
    />
  );
}

export function Checkbox({ checked, onChange, children, id }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; id?: string }) {
  const auto = useId();
  return (
    <label className="checkbox" htmlFor={id ?? auto}>
      <input id={id ?? auto} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

export function SegmentedControl<T extends string>({ value, onChange, options, label, role = 'tablist' }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; label: string; role?: 'tablist' | 'radiogroup' }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
    onChange(options[n].value);
    refs.current[n]?.focus();
  };
  return (
    <div className="seg" role={role} aria-label={label}>
      {options.map((o, i) => {
        const sel = o.value === value;
        return (
          <button
            key={o.value} ref={(el) => { refs.current[i] = el; }} type="button" role={role === 'tablist' ? 'tab' : 'radio'}
            aria-selected={role === 'tablist' ? sel : undefined} aria-checked={role === 'radiogroup' ? sel : undefined}
            tabIndex={sel ? 0 : -1} onClick={() => onChange(o.value)} onKeyDown={(e) => onKey(e, i)}
          >
            {o.label}{o.count !== undefined && <span className="c-subtle">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function RadioCard({ checked, onSelect, title, body, meta, recommended, name }: { checked: boolean; onSelect: () => void; title: ReactNode; body?: ReactNode; meta?: ReactNode; recommended?: boolean; name?: string }) {
  return (
    <button type="button" role="radio" aria-checked={checked} className="radio-card" onClick={onSelect} data-name={name}>
      <span className="ring" aria-hidden="true" />
      <span className="col gap-1 grow">
        <span className="row between"><span className="t-title">{title}</span>{recommended && <span className="chip accent">Recommended</span>}</span>
        {body && <span className="t-small c-muted">{body}</span>}
        {meta && <span className="t-small c-subtle">{meta}</span>}
      </span>
    </button>
  );
}

export const Kbd = ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>;

export function EvidenceTag({ id, kind }: { id: string; kind?: 'test' | 'secret' | 'evidence' }) {
  const k = kind ?? (id.startsWith('T-') ? 'test' : 'evidence');
  return <Link to={`/evidence/${encodeURIComponent(id)}`} className={`etag ${k === 'evidence' ? '' : k}`} aria-label={`Evidence ${id}`}>{id}</Link>;
}

export function ProgressRing({ value, size = 64, stroke = 5, color, label, children }: { value: number; size?: number; stroke?: number; color?: string; label: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <span className="ring-wrap" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#22272E" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color ?? 'var(--accent)'} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(c * v) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dasharray var(--dur-base)' }} />
      </svg>
      {children && <span className="ring-label">{children}</span>}
    </span>
  );
}

const LOOP = ['Observe', 'Explain', 'Plan', 'Approve', 'Act', 'Verify'] as const;
export function LoopStepper({ current }: { current: (typeof LOOP)[number] }) {
  const idx = LOOP.indexOf(current);
  return (
    <ol className="stepper" aria-label="Repair progress" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {LOOP.map((s, i) => (
        <li key={s} className="row gap-1" style={{ gap: 6 }}>
          <span className={`st ${i < idx ? 'done' : i === idx ? 'now' : ''}`} aria-current={i === idx ? 'step' : undefined}>
            {i < idx ? <Icon name="check" size={13} /> : <span className="mono">{i + 1}</span>}{s}
          </span>
          {i < LOOP.length - 1 && <span className="sep" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

export function Card({ children, className = '', as: As = 'section', ...rest }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' | 'aside' } & React.HTMLAttributes<HTMLElement>) {
  return <As className={`card ${className}`} {...rest}>{children}</As>;
}

export function Spinner({ label = 'Working' }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function Skeleton({ h = 16, w = '100%' }: { h?: number; w?: number | string }) {
  return <span className="skeleton" style={{ display: 'block', height: h, width: w }} aria-hidden="true" />;
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="col gap-3" role="status" aria-live="polite" style={{ padding: 8 }}>
      <span className="sr-only">{label}</span>
      <Skeleton h={28} w="40%" /><Skeleton h={90} /><Skeleton h={90} /><Skeleton h={60} w="70%" />
    </div>
  );
}

/** Every error: what happened · what did not happen · one next step. The code appears only in details. */
export function ErrorState({ error, onRetry, retryLabel, compact }: { error: ApiError; onRetry?: () => void; retryLabel?: string; compact?: boolean }) {
  return (
    <div className={`state error ${compact ? '' : 'card'}`} role="alert" style={compact ? { padding: 16 } : undefined}>
      <span className="state-icon"><Icon name="alert" size={20} /></span>
      <span className="t-title" style={{ color: 'var(--text)' }}>{error.headline}</span>
      {error.didNotHappen && <span className="t-small">{error.didNotHappen}</span>}
      {onRetry && <Button size="sm" onClick={onRetry}>{retryLabel ?? error.nextStep ?? 'Try again'}</Button>}
      {!onRetry && error.nextStep && <span className="t-small c-subtle">Next: {error.nextStep}</span>}
      <details className="t-small c-subtle"><summary>Details</summary><span className="mono">{error.code}</span>{error.detail && <pre className="code" style={{ textAlign: 'left', marginTop: 6 }}>{error.detail}</pre>}</details>
    </div>
  );
}

export function EmptyState({ icon = 'check', title, body, action }: { icon?: IconName; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="state">
      <span className="state-icon"><Icon name={icon} size={20} /></span>
      <span className="t-title" style={{ color: 'var(--text)' }}>{title}</span>
      {body && <span className="t-small">{body}</span>}
      {action}
    </div>
  );
}

export function PageTitle({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="row between start gap-5">
      <div className="col" style={{ gap: 6 }}>
        <h1 className="t-h1">{title}</h1>
        {sub && <p className="c-muted" style={{ fontSize: 14 }}>{sub}</p>}
      </div>
      {actions && <div className="row gap-3">{actions}</div>}
    </div>
  );
}

/** Focus-trapping dialog: Esc closes, focus returns to the opener (a11y). */
export function Dialog({ label, onClose, children, center, width }: { label: string; onClose: () => void; children: ReactNode; center?: boolean; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const el = ref.current!;
    const focusables = () => Array.from(el.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'));
    (focusables()[0] ?? el).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    el.addEventListener('keydown', onKey);
    return () => { el.removeEventListener('keydown', onKey); opener?.focus?.(); };
  }, [onClose]);
  return (
    <div className={`overlay ${center ? 'center' : ''}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} style={width ? { width } : undefined}>{children}</div>
    </div>
  );
}

const INC_STATUS: Record<IncidentStatus, { label: string; kind: CheckStatus | 'accent' | 'neutral' }> = {
  open: { label: 'Needs you', kind: 'accent' }, diagnosing: { label: 'Investigating', kind: 'warn' }, planned: { label: 'Fix ready', kind: 'accent' },
  running: { label: 'Repairing', kind: 'accent' }, verified: { label: 'Verified', kind: 'ok' }, partially_verified: { label: 'Partly fixed', kind: 'warn' },
  blocked: { label: 'Paused', kind: 'warn' }, waiting_reboot: { label: 'Waiting for restart', kind: 'warn' }, closed: { label: 'Closed', kind: 'neutral' }, queued: { label: 'Queued', kind: 'neutral' },
};
export function IncidentStatusChip({ status }: { status: IncidentStatus }) {
  const s = INC_STATUS[status];
  return <StatusChip status={s.kind} label={s.label} />;
}
export const incidentStatusLabel = (s: IncidentStatus) => INC_STATUS[s].label;

const JOURNAL: Partial<Record<JournalState, string>> = {
  PREPARED: 'Prepared', VALIDATED: 'Validated', APPROVED: 'Approved', PRECONDITION_CHECK: 'Final check', READY: 'Ready', EXECUTING: 'Running',
  EXECUTED: 'Steps ran', VERIFYING: 'Verifying', VERIFIED: 'Verified', PARTIALLY_VERIFIED: 'Partly fixed', FAILED: 'Failed', BLOCKED: 'Paused',
  CANCELLED: 'Cancelled', WAITING_FOR_REBOOT: 'Waiting for restart', RECOVERY_REQUIRED: 'Needs recovery',
};
export const journalLabel = (s: JournalState) => JOURNAL[s] ?? s;

export function Banner({ kind, children, role }: { kind: 'warn' | 'danger' | 'info'; children: ReactNode; role?: 'alert' | 'status' }) {
  return <div className={`banner ${kind}`} role={role ?? (kind === 'danger' ? 'alert' : 'status')}><Icon name={kind === 'info' ? 'info' : 'alert'} size={15} />{children}</div>;
}

export function Crumbs({ items }: { items: { label: ReactNode; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="crumbs">
      {items.map((it, i) => (
        <span key={i} className="row" style={{ gap: 8 }}>
          {i > 0 && <Icon name="chevronRight" size={14} style={{ color: 'var(--faint)' }} />}
          {it.to ? <Link to={it.to}>{it.label}</Link> : <span aria-current="page">{it.label}</span>}
        </span>
      ))}
    </nav>
  );
}

export function timeAgo(isoStr?: string) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  const sameDay = new Date().toDateString() === d.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const y = new Date(Date.now() - 86400000).toDateString() === d.toDateString();
  if (y) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
export const clock = (isoStr: string) => new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
