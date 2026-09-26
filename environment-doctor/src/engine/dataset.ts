import type {
  ActionEntry, Blueprint, DiagnoseRequest, DiagnosisSource, DriftItem, EvidenceItem, Health, HistoryEvent, Incident,
  MachineInfo, OsKind, Pillar, PlanStep, Project, RedactionPreview, ScanFinding, ScanItem, ScanScope, SetupDryRun,
  VerificationCheck,
} from '../shared/contracts';

/**
 * A Dataset is where facts come from. The engine (approval binding, lock, journal, verification
 * state machine, audit chain) is identical for both; only the source of truth differs:
 *  - DemoDataset: the canvas scenarios (fixtures), deterministic, used by tests and the demo mode.
 *  - LiveDataset: real read-only collectors on this machine + a small catalog of user-level actions.
 */
export interface ScanOutcome {
  pillars: Pillar[];
  findings: ScanFinding[];
  incidents: Incident[];
  evidence: EvidenceItem[];
  projects: Project[];
}

export interface ScanScript {
  items: Omit<ScanItem, 'state'>[];
  /** Runs the collectors. Calls onItem as each finishes. Must respect `signal.stopped`. */
  run(onItem: (id: string, patch: Partial<ScanItem>) => void, signal: { stopped: boolean }): Promise<ScanOutcome>;
}

export interface PlanDraft {
  title: string;
  kind: 'fix' | 'setup' | 'guided';
  steps: PlanStep[];
  verification: VerificationCheck[];
  estimatedMinutes: number;
  isolationNote?: string;
}

export interface StepContext {
  incidentId: string;
  planId: string;
  executionId: string;
  /** Per-execution scratch (e.g. saved PATH for undo). Persisted with the journal. */
  memo: Record<string, string>;
}

export interface StepOutcome {
  ok: boolean;
  info: string;
  errorCode?: 'E_ACTION_FAILED' | 'E_ACTION_TIMEOUT' | 'E_PRECONDITION_FAILED' | 'E_POLICY_DENIED';
}

export interface CheckOutcome {
  pass: boolean;
  detail: string;
}

export interface Dataset {
  readonly mode: 'live' | 'demo';
  machine(): Promise<MachineInfo>;
  seed(): { incidents: Incident[]; evidence: EvidenceItem[]; projects: Project[]; pillars: Pillar[]; history: Omit<HistoryEvent, 'hash' | 'prevHash'>[]; scanned: boolean };
  scanScript(scopes: ScanScope[], ctx: { projects: Project[] }): ScanScript;
  diagnosisSources(): DiagnosisSource[];
  diagnose(req: DiagnoseRequest, ctx: { incidents: Incident[]; evidence: EvidenceItem[] }): Promise<{ incident: Incident; evidence: EvidenceItem[] }>;
  planFor(incident: Incident, opts: { next?: boolean; variant?: string }): PlanDraft | null;
  catalog(): ActionEntry[];
  blueprints(): Blueprint[];
  setupDryRun(blueprintId: string, os: OsKind, ctx: { projects: Project[] }): Promise<SetupDryRun & { draft?: PlanDraft }>;
  redaction(incident: Incident, evidence: EvidenceItem[]): RedactionPreview;
  /** Current fingerprint of the state a plan depends on (spec §7/§15). */
  fingerprint(steps: PlanStep[], ctx: StepContext): Promise<Record<string, string>>;
  precheck(step: PlanStep, ctx: StepContext): Promise<{ label: string; ok: boolean }[]>;
  execute(step: PlanStep, ctx: StepContext): Promise<StepOutcome>;
  verify(check: VerificationCheck, ctx: StepContext): Promise<CheckOutcome>;
  undo?(step: PlanStep, ctx: StepContext): Promise<StepOutcome>;
  drift?(before: Record<string, string>, after: Record<string, string>): DriftItem[];
  healthExtras?(): Partial<Health>;
}
