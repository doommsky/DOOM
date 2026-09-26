/** Small helpers shared by the change-path screens (Plan, Run, Guided, Resume, AdminHandoff). */
import { useEffect, useState } from 'react';
import type { Channel, JournalState, PlanStep, Req, Res, Result, RunProgress } from '../../../shared/contracts';
import { TERMINAL_STATES } from '../../../shared/contracts';
import { getBridge } from '../../api/client';

/** Deep copy — the in-process demo bridge hands out live engine objects, which must never change under the UI. */
export const copy = <T,>(v: T): T => (v === undefined || v === null ? v : (JSON.parse(JSON.stringify(v)) as T));

/** Calls the orchestrator and returns a private copy of the result. */
export async function ask<C extends Channel>(channel: C, req: Req<C>): Promise<Result<Res<C>>> {
  const r = await getBridge().invoke(channel, req);
  return r.ok ? { ok: true, data: copy(r.data) } : r;
}

/** Ticks once a second while `active` (countdowns). */
export function useNow(active: boolean, every = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [active, every]);
  return now;
}

export const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export const shortHash = (h: string) => (h.length > 12 ? `${h.slice(0, 4)}…${h.slice(-4)}` : h);

export const activeSteps = (steps: PlanStep[]) => steps.filter((s) => !s.removedReason);

export const riskWord = (r: PlanStep['risk']) => (r === 'high' ? 'High' : r === 'medium' ? 'Medium' : 'Low');

/** "Undo: remove the link again." → "remove the link again." */
export const undoShort = (u: string) => u.replace(/^undo:\s*/i, '');

export const isActiveRun = (s: JournalState) => !TERMINAL_STATES.includes(s) && s !== 'RECOVERY_REQUIRED';

/**
 * Stream events arrive in order and always win. A snapshot from run.get / run.decide may be older than a stream
 * event already applied (IPC latency), so it is ignored when it knows less about the same execution.
 */
export function newerRun(prev: RunProgress | null, next: RunProgress): RunProgress {
  if (prev && prev.executionId === next.executionId && next.activity.length < prev.activity.length) return prev;
  return next;
}

/** "1", "1 and 3", "1, 3 and 4" */
export function listJoin(xs: (string | number)[]) {
  const s = xs.map(String);
  return s.length <= 1 ? s.join('') : `${s.slice(0, -1).join(', ')} and ${s[s.length - 1]}`;
}

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
