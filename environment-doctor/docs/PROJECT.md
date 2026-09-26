# Environment Doctor — Project Record
**Status:** Active: build complete, ready for testing (v0.9.0)
**Last updated:** 2026-09-26
**Owner:** Dominik Scholtz (product) · built with Claude Code
**Tags:** #build #desktop #electron #windows #testing

## Summary
Environment Doctor is one desktop app that **sets up, diagnoses, fixes and verifies** a PC and its dev environment. This repository folder holds the complete v0.9 implementation of *UI Handoff & Test Plan v1.0* (22 screens + design-system boards) on the frozen *Final Specification v1.2* architecture. It ships as a Windows installer and a portable `.exe`, with a real read-only engine for the live PC and a demo engine that replays every design scenario.

## Source documents
| Document | Role |
| :- | :- |
| Final Specification v1.2 (red-team complete) | Architecture and safety invariants (authoritative) |
| Complete Architecture · Architecture Audit v1.1 | Background for v1.2 |
| v1.3 Product Gap Research & Unified-App Plan | Product direction: Case model, four intents, release boundary (Release 0 = read-only) |
| UI Handoff & Test Plan v1.0 | Screens, contracts, UI safety rules, AC-01…AC-26 |
| Environment Doctor — UI canvas (28 boards) | Visual source for every screen |

## Details

### Actions taken
1. **Contracts** (`src/shared/contracts.ts`): the typed channel map for renderer ↔ orchestrator, following the handoff doc's data contracts table, plus spec error codes and journal states.
2. **Orchestrator engine** (`src/engine/engine.ts`): approval binding (plan hash + evidence snapshot + boot session, 15-minute TTL), global mutation lock with a queue, a recovery journal written before every step, drift and TOCTOU re-checks, a verification gate, undo plans, and a SHA-256 audit chain.
3. **Demo dataset**: all canvas scenarios as fixtures, plus fault injection (`expireApproval`, `mutatePlan`, `helperUntrusted`, `busy`, `drift`, `partial`, `openJournal`, `offline`, `storageRestored`).
4. **Live dataset**: bounded read-only collectors (one PowerShell bundle on Windows), deterministic rules → incidents with evidence and confidence labels, and a user-level action catalog with undo.
5. **Electron shell**: `app://` protocol, sandboxed bundled preload, sender-validated IPC, CSP, navigation lock, tray, quit blocked during repairs, native folder picker for project roots.
6. **Renderer**: design tokens (board 23), component library (board 24), app shell with icon-rail breakpoints (board 28), and 22 screens built by four parallel build agents against the shared contracts.
7. **CLI** (`doctor`): check / explain / fix (read-only, approval in the app) / setup --plan-only / list, with an exit-code contract.
8. **Packaging & CI**: electron-builder NSIS + portable (asInvoker, hardened fuses); GitHub Actions builds on Windows and runs a live scan there.

### Key decisions (ADR-lite)
| # | Decision | Why | Trade-off |
| :- | :- | :- | :- |
| D1 | The orchestrator runs **in Electron main** (same code also runs in the CLI and the browser) instead of a separate user-level process | Ship a working exe now, keep one engine | Main does more than "broker only"; the engine is a separate module with no Electron dependency, so moving it to its own process later is mechanical |
| D2 | **No admin helper in this build**; admin actions are listed but policy removes them from plans | Spec §3 requires a signed helper with its own trust model, and v1.3 says Release 0–1 has no privileged mutation | Driver, restore-point and Safe Mode repairs only run in demo mode |
| D3 | **Demo mode** built into the product | Every screen, fault and AC is testable and demoable without a broken PC | Clearly labelled "Demo" pill; fault injection is refused in live mode |
| D4 | JSON state store with atomic write + fsync + rolling backup instead of SQLite | No native modules, which makes cross-building the exe from any OS trivial | Spec §13 recommends SQLite/WAL; the storage interface (`Host.load/save`) is isolated for a later swap |
| D5 | Electron `runAsNode` fuse **disabled**; CLI ships as `node dist-electron/cli/doctor.js` | Spec §25 security fuses | The packaged exe has no console CLI yet |
| D6 | Renderer never supplies filesystem paths; project folders come only from the native picker in main | Spec §2 ("sends IDs, never paths") | One extra channel (`projects.addRoot`) handled in main |
| D7 | Unsigned build | No code-signing certificate yet (open question) | SmartScreen warning on first run |

### Results (2026-09-26, commit on PR #1)
| Layer | Tool | Result |
| :- | :- | :- |
| Typecheck | `tsc` (renderer + electron configs) | clean |
| Unit | Vitest: engine safety rules (16), live collectors (4), components + axe (6) | **26 / 26 passed**; axe reports 0 violations on the design-system gallery |
| Screen/flow | Playwright, demo engine, 4 specs (`start`, `diagnosis`, `change`, `library`) | **48 / 48 passed**, 96 / 96 with `--repeat-each=2` (no flakes) |
| Desktop | Playwright for Electron | **2 / 2 passed**: security baseline (no Node in the renderer, bridge allowlist, `app://`, navigation lock, live scan) and a **real repair**: create a project `.venv` → verified → undo plan → verified, `.venv` gone |
| Real Windows | GitHub `windows-latest` (Windows 11 build 26100) | Live CLI scan: every collector returned data; Electron smoke passes; NSIS installer + portable exe built |

Found and fixed by these layers during the build: the sandboxed preload couldn't `require` shared code (now bundled, and a missing bridge is a hard error, never a silent demo fallback); Windows inbox display drivers were flagged as "old" because of the 2006-06-21 placeholder date; dead system PATH entries had no incident; undo plans lacked the original repair's saved state; queued repairs never started; a second run for an already-repairing incident was allowed.

### Acceptance-criteria traceability
| AC | Test file | Engine test |
| :- | :- | :- |
| AC-01 First run scopes / cloud off | e2e/start.spec.ts | — |
| AC-02 Problems only filter | e2e/start.spec.ts | — |
| AC-03 Stop scan → Unknown | e2e/start.spec.ts | unit/engine.test.ts |
| AC-04 Palette → Diagnose | e2e/start.spec.ts | — |
| AC-05 No percentages, labels + evidence | e2e/diagnosis.spec.ts | — |
| AC-06 Vetoed hypothesis | e2e/diagnosis.spec.ts | — |
| AC-07 Approve disabled + reason | e2e/change.spec.ts | unit/engine.test.ts |
| AC-08 Final check listed | e2e/change.spec.ts | unit/engine.test.ts |
| AC-09 Expired approval | e2e/change.spec.ts | unit/engine.test.ts |
| AC-10 Plan mismatch | e2e/change.spec.ts | unit/engine.test.ts |
| AC-11 Admin declined | e2e/change.spec.ts | unit/engine.test.ts |
| AC-12 Helper untrusted | e2e/change.spec.ts | unit/engine.test.ts |
| AC-13 Verified only after checks | e2e/change.spec.ts | unit/engine.test.ts |
| AC-14 Queued, not error | e2e/change.spec.ts | unit/engine.test.ts |
| AC-15 Drift names unrun step | e2e/change.spec.ts | unit/engine.test.ts |
| AC-16 Partly fixed | e2e/diagnosis.spec.ts | unit/engine.test.ts |
| AC-17 Sensitive source off | e2e/diagnosis.spec.ts | — |
| AC-18 Timeline keyboard detail | e2e/diagnosis.spec.ts | — |
| AC-19 Journal before restart | e2e/change.spec.ts | unit/engine.test.ts |
| AC-20 Resume first, re-checks gate buttons | e2e/change.spec.ts | unit/engine.test.ts |
| AC-21 New package source flagged | e2e/library.spec.ts | — |
| AC-22 macOS → MPS, no CUDA | e2e/library.spec.ts | — |
| AC-23 Secrets never read | e2e/library.spec.ts | unit/live.test.ts |
| AC-24 AI preview consent | e2e/diagnosis.spec.ts | — |
| AC-25 Locked settings | e2e/library.spec.ts | unit/engine.test.ts |
| AC-26 Keyboard-only | e2e/start.spec.ts, change.spec.ts, library.spec.ts | — |

### Next steps
- [ ] **Test on your Windows PC**: install the exe, run a live scan, try a PATH clean-up with undo, and switch to Demo mode to walk every flow (see "How to test" below).
- [ ] Decide the code-signing publisher (removes SmartScreen warning; shown on the admin prompt).
- [ ] Admin helper (G5): signed catalog, named-pipe ACLs, UAC launch, so driver/restore-point/Safe Mode actions can run live.
- [ ] Pick the on-device model and cloud provider for explanations (screen 21 terms).
- [ ] SQLite/WAL store with a tested backup restore (spec §13), replacing the JSON store behind `Host`.
- [ ] Windows 11 VM fault-injection lab (spec §33) against the live engine.

### How to test (manual checklist)
1. Run the portable exe → **First run**: choose AI location and scan areas → the live scan runs.
2. **Home**: check that unknowns are dashed and not counted; "Problems only" filter.
3. Open any incident → evidence tags, confidence labels (no %), "Other explanations".
4. If PATH has dead entries: **Plan** → tick → Approve → final check → Run → **Verified** → open the same incident → *Undo* plan restores it.
5. **Settings → General → Demo**: repeat with sample data; walk the freeze → guided repair → simulated restart → **Resume** flow.
6. Keyboard only: Ctrl K, Tab/Shift-Tab, arrows in tabs, Esc closes dialogs.

## Artifacts
- App source: `environment-doctor/` · README: `environment-doctor/README.md`
- Windows builds: GitHub Actions → *Environment Doctor* workflow → artifact **Environment-Doctor-Windows**
- Live-scan sample from a real Windows runner: `live-scan.json` in the same artifact
- Design canvas and handoff doc: see Google Drive "Environment Doctor — Index (read me first)"

## Change log
| Version | Date | Change |
| :- | :- | :- |
| 0.9.0 | 2026-09-26 | First complete build: engine (demo + live), Electron shell, 22 screens, CLI, tests, Windows packaging, CI. Integration fixes: bundled sandboxed preload, inbox-driver dates, system-PATH incident, undo from saved state, queued repairs auto-start, one run per incident |
