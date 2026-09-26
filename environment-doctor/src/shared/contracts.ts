/**
 * Renderer ↔ orchestrator contracts (Handoff v1.0 §“Data contracts”, spec v1.2 §2, §25).
 *
 * The renderer only reads state and sends intents. It never builds commands, paths or
 * action parameters — it sends IDs the orchestrator gave it. Every type here must be
 * structured-clone safe (plain JSON) because it crosses the Electron contextBridge.
 */

export const CONTRACT_VERSION = '1.0.0';
export const UI_CONFIRMATION_VERSION = 'ui-confirm-3';
export const APPROVAL_TTL_MS = 15 * 60 * 1000;

// ───────────────────────────── primitives ─────────────────────────────

/** Never a number (spec §23). */
export type Confidence = 'confirmed' | 'high' | 'medium' | 'low' | 'unknown';
export type CheckStatus = 'ok' | 'warn' | 'fail' | 'unknown';
export type Risk = 'low' | 'medium' | 'high';
export type Privilege = 'user' | 'admin';
export type OsKind = 'windows' | 'macos' | 'linux';
export type Sensitivity = 'public' | 'internal' | 'sensitive' | 'secret';
export type EngineMode = 'live' | 'demo';
export type AiMode = 'off' | 'local' | 'cloud';

export type JournalState =
  | 'PREPARED' | 'VALIDATED' | 'APPROVED' | 'PRECONDITION_CHECK' | 'READY'
  | 'EXECUTING' | 'EXECUTED' | 'VERIFYING' | 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'FAILED'
  | 'BLOCKED' | 'CANCELLED' | 'WAITING_FOR_REBOOT' | 'RECOVERY_REQUIRED';

export const TERMINAL_STATES: JournalState[] = ['VERIFIED', 'PARTIALLY_VERIFIED', 'FAILED', 'BLOCKED', 'CANCELLED'];

export type ErrorCode =
  | 'E_COLLECTION_TIMEOUT' | 'E_COLLECTION_PERMISSION' | 'E_COLLECTION_UNSUPPORTED' | 'E_COLLECTION_FAILED'
  | 'E_EVIDENCE_STALE' | 'E_EVIDENCE_CONTRADICTORY' | 'E_EVIDENCE_SENSITIVE' | 'E_RULE_UNSUPPORTED'
  | 'E_AI_UNAVAILABLE' | 'E_AI_SCHEMA_INVALID' | 'E_AI_EVIDENCE_INVALID' | 'E_AI_UNGROUNDED'
  | 'E_POLICY_DENIED' | 'E_APPROVAL_EXPIRED' | 'E_APPROVAL_MISMATCH' | 'E_PRECONDITION_FAILED'
  | 'E_DRIFT_DETECTED' | 'E_MUTATION_BUSY' | 'E_ACTION_TIMEOUT' | 'E_ACTION_FAILED' | 'E_ACTION_INTERRUPTED'
  | 'E_REBOOT_REQUIRED' | 'E_RECOVERY_UNKNOWN' | 'E_VERIFICATION_FAILED' | 'E_STORAGE_CORRUPT'
  | 'E_BACKUP_INVALID' | 'E_HELPER_UNTRUSTED' | 'E_SIGNATURE_INVALID' | 'E_SUPPLY_CHAIN_UNTRUSTED'
  | 'E_UPDATE_INVALID' | 'E_VERSION_INCOMPATIBLE' | 'E_NOT_FOUND' | 'E_INVALID_REQUEST';

export interface ApiError {
  code: ErrorCode;
  /** What happened. */
  headline: string;
  /** What did not happen. */
  didNotHappen?: string;
  /** One next step. */
  nextStep?: string;
  detail?: string;
  /** Related ID the UI can open (e.g. the new plan after E_APPROVAL_MISMATCH). */
  ref?: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };

// ───────────────────────────── machine / health ─────────────────────────────

export interface MachineInfo {
  hostname: string;
  os: OsKind;
  osLabel: string;
  arch: string;
  appVersion: string;
  mode: EngineMode;
  guardsOn: boolean;
  bootId: string;
}

export interface HealthRow {
  id: string;
  name: string;
  note: string;
  status: CheckStatus;
  incidentId?: string;
  projectId?: string;
}

export interface Pillar {
  key: 'pc' | 'dev' | 'proj';
  name: string;
  sub: string;
  rows: HealthRow[];
}

export interface Health {
  machine: MachineInfo;
  pillars: Pillar[];
  lastScanAt?: string;
  /** Rows not checked — never counted toward health (UI rule 9). */
  unknownCount: number;
  problemCount: number;
  checkedCount: number;
  offline: boolean;
  banner?: { kind: 'backup-restored' | 'helper-untrusted' | 'offline' | 'update-rejected'; text: string };
}

// ───────────────────────────── scan ─────────────────────────────

export type ScanScope = 'pc' | 'dev' | 'proj';

export interface ScanItem {
  id: string;
  column: ScanScope;
  name: string;
  state: 'waiting' | 'running' | 'done' | 'skipped';
  status?: CheckStatus;
  result?: string;
  errorCode?: ErrorCode;
}

export interface ScanFinding {
  id: string;
  text: string;
  status: CheckStatus;
  incidentId?: string;
}

export interface ScanProgress {
  scanId: string;
  state: 'running' | 'complete' | 'stopped';
  items: ScanItem[];
  findings: ScanFinding[];
  current: string;
  percent: number;
  headline: string;
  subline: string;
}

// ───────────────────────────── incidents / diagnosis ─────────────────────────────

export type IncidentType = 'dev' | 'pc' | 'setup';
export type IncidentStatus =
  | 'open' | 'diagnosing' | 'planned' | 'running' | 'verified' | 'partially_verified'
  | 'blocked' | 'waiting_reboot' | 'closed' | 'queued';

export interface Hypothesis {
  id: string;
  title: string;
  confidence: Confidence;
  evidenceIds: string[];
  vetoedByRule?: string;
  detail: string;
  /** Suggested test to separate this from the others (spec §22). */
  test?: string;
}

export interface EvidenceRef {
  id: string;
  text: string;
  meta: string;
  kind: 'for' | 'against' | 'neutral';
}

export interface TimelineEvent {
  id: string;
  at: string;
  label: string;
  cause: string;
  evidenceId: string;
  severity: 'crash' | 'freeze' | 'warn' | 'info' | 'change';
}

export interface Incident {
  id: string;
  type: IncidentType;
  title: string;
  summary: string;
  status: IncidentStatus;
  createdAt: string;
  updatedAt: string;
  rootCause?: { title: string; detail: string; confidence: Confidence; evidenceIds: string[] };
  hypotheses: Hypothesis[];
  evidence: EvidenceRef[];
  timeline: TimelineEvent[];
  planId?: string;
  projectId?: string;
  symptom?: string;
  evidenceSnapshot: string;
  stale?: boolean;
  aiNote?: { code: ErrorCode | 'OK'; text: string };
  /** Learned during a partial fix (screen 16). */
  learned?: string[];
  source: 'scan' | 'describe' | 'setup' | 'demo';
}

export interface IncidentSummary {
  id: string;
  type: IncidentType;
  title: string;
  status: IncidentStatus;
  updatedAt: string;
  confidence?: Confidence;
  pillar: 'pc' | 'dev' | 'proj';
}

export interface DiagnoseRequest {
  symptom: string;
  when: 'today' | 'week' | 'update' | 'unsure';
  frequency: 'once' | 'daily' | 'always' | 'random';
  sources: string[];
}

export interface DiagnosisSource {
  key: string;
  name: string;
  note: string;
  sensitive: boolean;
  defaultOn: boolean;
}

// ───────────────────────────── plans / approval / run ─────────────────────────────

export interface PlanStep {
  id: string;
  actionId: string;
  actionVersion: string;
  title: string;
  targetSummary: string;
  risk: Risk;
  privilege: Privilege;
  reboot: boolean;
  undo: string;
  preconditions: string[];
  /** Explains a removed step (E_POLICY_DENIED). */
  removedReason?: string;
  /** Set on undo plans: the step ID this step reverses. */
  undoOf?: string;
}

export interface VerificationCheck {
  id: string;
  tier: 'V1' | 'V2' | 'V3' | 'V4' | 'V5';
  label: string;
}

export interface BindingSummary {
  planHash: string;
  evidenceSnapshot: string;
  expiresAt: string;
  expiresOnReboot: true;
  uiConfirmationVersion: string;
  approvalId?: string;
  bootId: string;
}

export interface Plan {
  id: string;
  incidentId: string;
  title: string;
  kind: 'fix' | 'setup' | 'guided';
  steps: PlanStep[];
  verification: VerificationCheck[];
  binding: BindingSummary;
  requiresAdmin: boolean;
  requiresReboot: boolean;
  estimatedMinutes: number;
  /** Alternative safer target (v1.3 “prefer isolation”). */
  isolationNote?: string;
  status: 'draft' | 'approved' | 'expired' | 'superseded' | 'executed';
}

export interface ApprovalRequest {
  planId: string;
  planHash: string;
  uiConfirmationVersion: string;
  acknowledged: boolean;
}

export interface Approval {
  approvalId: string;
  planId: string;
  planHash: string;
  approvedAt: string;
  expiresAt: string;
  bootId: string;
  /** Conditions re-checked in the final check (AC-08). */
  finalCheck: { label: string; ok: boolean }[];
}

export interface DriftItem {
  id: string;
  what: string;
  before: string;
  after: string;
  source: string;
}

export interface VerificationResult {
  id: string;
  label: string;
  tier: VerificationCheck['tier'];
  state: 'pending' | 'running' | 'pass' | 'fail';
  detail?: string;
}

export interface ActivityItem {
  at: string;
  text: string;
  kind: 'info' | 'ok' | 'warn' | 'error';
}

export interface RunProgress {
  executionId: string;
  incidentId: string;
  planId: string;
  state: JournalState;
  stepIndex: number;
  steps: { id: string; title: string; state: 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'not_run'; exitInfo?: string }[];
  verification: VerificationResult[];
  drift: DriftItem[];
  activity: ActivityItem[];
  error?: ApiError;
  /** The step that did NOT run because of drift (UI rule 6). */
  notRunStep?: string;
  queuedBehind?: string;
  adminPrompt?: 'waiting' | 'declined' | 'timeout' | 'untrusted' | null;
  watch?: { until: string; label: string };
}

export interface LockState {
  held: boolean;
  incidentId?: string;
  executionId?: string;
  since?: string;
  queue: string[];
}

export interface RecoveryJournal {
  executionId: string;
  incidentId: string;
  planId: string;
  state: JournalState;
  reason: string;
  completedSteps: string[];
  pendingSteps: string[];
  unknownSteps: string[];
  savedAt: string;
  rechecks: { label: string; state: 'pending' | 'running' | 'pass' | 'fail' }[];
}

// ───────────────────────────── evidence / redaction ─────────────────────────────

export interface EvidenceItem {
  id: string;
  title: string;
  source: string;
  collector: string;
  collectorVersion: string;
  capturedAt: string;
  hash: string;
  size: number;
  sensitivity: Sensitivity;
  retention: '30d' | '90d' | '1y';
  incidentIds: string[];
  /** Normalised, redacted fields. Secret values are never present (UI rule 10). */
  fields: { key: string; value: string; secret?: boolean }[];
}

export interface RedactionPair {
  id: string;
  label: string;
  rawA: string;
  /** Masked private part as shown locally — for secrets this is a placeholder, never the value. */
  rawSecret: string;
  rawB: string;
  safe: string;
  kb: number;
}

export interface RedactionPreview {
  incidentId: string;
  pairs: RedactionPair[];
  neverSent: string[];
}

// ───────────────────────────── setup / projects ─────────────────────────────

export type SetupRowKind = 'install' | 'update' | 'keep' | 'skip' | 'blocked';

export interface SetupRow {
  id: string;
  name: string;
  kind: SetupRowKind;
  current?: string;
  target?: string;
  source: string;
  publisher: string;
  signature: 'verified' | 'unsigned' | 'unknown';
  admin: boolean;
  restart: boolean;
  newSource?: boolean;
  note?: string;
  group: string;
}

export interface Blueprint {
  id: string;
  name: string;
  description: string;
}

export interface SetupDryRun {
  blueprintId: string;
  os: OsKind;
  rows: SetupRow[];
  totals: { install: number; update: number; keep: number; skip: number; blocked: number };
  downloadMb: number;
  needsAdmin: boolean;
  needsRestart: boolean;
  newSources: string[];
  isolationNote?: string;
  planId?: string;
}

export interface Requirement {
  id: string;
  name: string;
  needs: string;
  have: string;
  status: CheckStatus;
  source: string;
  incidentId?: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  stack: string;
  status: CheckStatus;
  summary: string;
  requirements: Requirement[];
  lastChecked?: string;
}

// ───────────────────────────── catalog / history / settings ─────────────────────────────

export interface ActionEntry {
  id: string;
  version: string;
  title: string;
  description: string;
  category: 'environment' | 'packages' | 'drivers' | 'system' | 'network' | 'project';
  risk: Risk;
  privilege: Privilege;
  reboot: boolean;
  undo: string;
  preconditions: string[];
  verification: string[];
  os: OsKind[];
  signed: boolean;
  availableInThisBuild: boolean;
  lastUsed?: string;
}

export interface HistoryEvent {
  id: string;
  at: string;
  kind: 'scan' | 'diagnosis' | 'approval' | 'action' | 'verification' | 'drift' | 'recovery' | 'settings' | 'evidence' | 'system';
  title: string;
  detail: string;
  incidentId?: string;
  actor: 'you' | 'engine' | 'windows' | 'ai';
  hash: string;
  prevHash: string;
}

export interface HistoryList {
  events: HistoryEvent[];
  integrity: 'ok' | 'restored' | 'broken';
  integrityNote: string;
}

export interface Settings {
  general: { launchAtLogin: boolean; trayIcon: boolean; scanOnStart: boolean; theme: 'dark' };
  privacy: { aiMode: AiMode; cloudProvider: string; redactSecrets: true; sendCrashDumps: false; previewBeforeSend: true };
  diagnostics: { eventLogDays: number; includeProjects: boolean; projectRoots: string[]; escalation: 'L2' | 'L3' | 'L4' | 'L5' };
  updates: { channel: 'stable' | 'beta'; autoCheck: boolean; blockDuringRepair: true };
  data: { evidenceRetentionDays: number; historyRetentionDays: number };
  engine: { mode: EngineMode };
}

/** Settings that can never be turned off (AC-25). */
export const LOCKED_SETTINGS: Record<string, string> = {
  'privacy.redactSecrets': 'Always on — secrets are never stored or sent (spec §11).',
  'privacy.sendCrashDumps': 'Always off — full crash dumps never leave this PC.',
  'privacy.previewBeforeSend': 'Always on — you see exactly what a cloud AI would receive first.',
  'updates.blockDuringRepair': 'Always on — the app never updates itself mid-repair (spec §9).',
};

export interface CommandEntry {
  id: string;
  label: string;
  hint: string;
  group: 'Go to' | 'Run' | 'Incidents' | 'Diagnose';
  route: string;
}

// ───────────────────────────── demo / test controls ─────────────────────────────

/** Fault injection for demo mode and tests (spec §33) — rejected in live mode. */
export type Fault =
  | 'none' | 'expireApproval' | 'mutatePlan' | 'helperUntrusted' | 'busy' | 'drift'
  | 'partial' | 'adminDecline' | 'openJournal' | 'offline' | 'storageRestored';

// ───────────────────────────── channel map ─────────────────────────────

export interface Channels {
  'app.info': { req: void; res: MachineInfo };
  'health.get': { req: void; res: Health };
  'scan.start': { req: { scopes: ScanScope[] }; res: { scanId: string } };
  'scan.stop': { req: { scanId: string }; res: ScanProgress };
  'scan.get': { req: void; res: ScanProgress | null };
  'incidents.list': { req: void; res: IncidentSummary[] };
  'incident.get': { req: { id: string }; res: Incident };
  'incident.close': { req: { id: string }; res: IncidentSummary };
  'diagnose.sources': { req: void; res: DiagnosisSource[] };
  'diagnose.start': { req: DiagnoseRequest; res: { incidentId: string } };
  'plan.get': { req: { id: string }; res: Plan };
  'plan.forIncident': { req: { incidentId: string; next?: boolean; variant?: 'rollback' | 'clean' | 'user-only' | 'undo' | 'resume' }; res: Plan };
  'approval.submit': { req: ApprovalRequest; res: Approval };
  'run.start': { req: { approvalId: string; planHash: string }; res: RunProgress };
  'run.get': { req: { incidentId: string }; res: RunProgress | null };
  'run.decide': { req: { executionId: string; decision: 'keep' | 'undo' | 'relook' | 'cancel' | 'admin-allow' | 'admin-decline' | 'restart-now' | 'later' }; res: RunProgress };
  'lock.get': { req: void; res: LockState };
  'recovery.get': { req: void; res: RecoveryJournal | null };
  'recovery.recheck': { req: void; res: RecoveryJournal };
  'recovery.resolve': { req: { decision: 'continue' | 'stop' }; res: { incidentId: string; planId?: string } };
  'evidence.list': { req: { incidentId?: string }; res: EvidenceItem[] };
  'evidence.get': { req: { id: string }; res: EvidenceItem };
  'redaction.preview': { req: { incidentId: string }; res: RedactionPreview };
  'blueprints.list': { req: void; res: Blueprint[] };
  'setup.dryRun': { req: { blueprintId: string; os: OsKind }; res: SetupDryRun };
  'projects.list': { req: void; res: Project[] };
  'project.get': { req: { id: string }; res: Project };
  'actions.catalog': { req: void; res: ActionEntry[] };
  'history.list': { req: void; res: HistoryList };
  'settings.get': { req: void; res: Settings };
  'settings.set': { req: { path: string; value: unknown }; res: Settings };
  'palette.commands': { req: void; res: CommandEntry[] };
  'demo.fault': { req: { fault: Fault }; res: { fault: Fault } };
  'demo.reset': { req: void; res: { ok: true } };
}

export type Channel = keyof Channels;
export type Req<C extends Channel> = Channels[C]['req'];
export type Res<C extends Channel> = Channels[C]['res'];

export const CHANNELS = [
  'app.info', 'health.get', 'scan.start', 'scan.stop', 'scan.get', 'incidents.list', 'incident.get',
  'incident.close', 'diagnose.sources', 'diagnose.start', 'plan.get', 'plan.forIncident', 'approval.submit',
  'run.start', 'run.get', 'run.decide', 'lock.get', 'recovery.get', 'recovery.recheck', 'recovery.resolve',
  'evidence.list', 'evidence.get', 'redaction.preview', 'blueprints.list', 'setup.dryRun', 'projects.list',
  'project.get', 'actions.catalog', 'history.list', 'settings.get', 'settings.set', 'palette.commands',
  'demo.fault', 'demo.reset',
] as const satisfies readonly Channel[];

export interface Streams {
  'scan.progress': ScanProgress;
  'run.progress': RunProgress;
  'notify': Notice;
}
export type Stream = keyof Streams;
export const STREAMS = ['scan.progress', 'run.progress', 'notify'] as const satisfies readonly Stream[];

export interface Notice {
  id: string;
  kind: 'info' | 'ok' | 'warn' | 'error';
  title: string;
  body?: string;
  route?: string;
  at: string;
}

/** What the preload exposes as `window.envDoctor` (narrow contextBridge — spec §25). */
export interface EnvDoctorBridge {
  invoke<C extends Channel>(channel: C, req: Req<C>): Promise<Result<Res<C>>>;
  subscribe<S extends Stream>(stream: S, cb: (data: Streams[S]) => void): () => void;
  platform: 'electron' | 'browser';
}
