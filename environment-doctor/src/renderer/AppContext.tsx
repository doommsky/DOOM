import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Health, LockState, MachineInfo, Notice, RecoveryJournal, RunProgress } from '../shared/contracts';
import { getBridge } from './api/client';
import { useStream } from './hooks/useApi';

interface AppState {
  machine: MachineInfo | null;
  health: Health | null;
  lock: LockState | null;
  notices: Notice[];
  toasts: Notice[];
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
  refresh: () => Promise<void>;
  notify: (n: Omit<Notice, 'id' | 'at'>) => void;
  dismissToast: (id: string) => void;
  clearNotices: () => void;
  /** Open recovery journal — while set, every route shows Resume first (Handoff nav rule, AC-20). */
  recovery: RecoveryJournal | null;
  booted: boolean;
  checkRecovery: () => Promise<RecoveryJournal | null>;
  clearRecovery: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [machine, setMachine] = useState<MachineInfo | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [lock, setLock] = useState<LockState | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [toasts, setToasts] = useState<Notice[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [recovery, setRecovery] = useState<RecoveryJournal | null>(null);
  const [booted, setBooted] = useState(false);

  const checkRecovery = useCallback(async () => {
    const r = await getBridge().invoke('recovery.get', undefined);
    const j = r.ok ? r.data : null;
    setRecovery(j);
    return j;
  }, []);

  const refresh = useCallback(async () => {
    const b = getBridge();
    const [m, h, l] = await Promise.all([b.invoke('app.info', undefined), b.invoke('health.get', undefined), b.invoke('lock.get', undefined)]);
    if (m.ok) setMachine(m.data);
    if (h.ok) setHealth(h.data);
    if (l.ok) setLock(l.data);
  }, []);

  useEffect(() => { void Promise.all([refresh(), checkRecovery()]).then(() => setBooted(true)); }, [refresh, checkRecovery]);

  const notify = useCallback((n: Omit<Notice, 'id' | 'at'>) => {
    const full: Notice = { ...n, id: Math.random().toString(36).slice(2), at: new Date().toISOString() };
    setNotices((xs) => [full, ...xs].slice(0, 50));
    setToasts((xs) => [full, ...xs].slice(0, 3));
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== full.id)), 6000);
  }, []);

  useStream('notify', (n) => { setNotices((xs) => [n, ...xs].slice(0, 50)); setToasts((xs) => [n, ...xs].slice(0, 3)); });

  // Keep header lock state + Home in sync with repairs and scans; announce outcomes (board 27 rules).
  useStream('run.progress', (r: RunProgress) => {
    if (['VERIFIED', 'PARTIALLY_VERIFIED', 'BLOCKED', 'FAILED', 'CANCELLED', 'WAITING_FOR_REBOOT'].includes(r.state)) void refresh();
    else if (r.state === 'APPROVED' || r.state === 'PRECONDITION_CHECK') void refresh();
  });
  useStream('scan.progress', (s) => { if (s.state !== 'running') void refresh(); });

  const value = useMemo<AppState>(() => ({
    machine, health, lock, notices, toasts, paletteOpen,
    openPalette: () => setPaletteOpen(true), closePalette: () => setPaletteOpen(false), refresh, notify,
    dismissToast: (id) => setToasts((xs) => xs.filter((x) => x.id !== id)), clearNotices: () => setNotices([]),
    recovery, booted, checkRecovery, clearRecovery: () => setRecovery(null),
  }), [machine, health, lock, notices, toasts, paletteOpen, refresh, notify, recovery, booted, checkRecovery]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
