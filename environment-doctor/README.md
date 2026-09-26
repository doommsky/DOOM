# Environment Doctor

**Sets up, diagnoses, fixes and verifies a PC and its dev environment.** It's a desktop app (Windows first), built from *UI Handoff & Test Plan v1.0* on top of the frozen architecture in *Final Specification v1.2*.

> Working title. v1.3 research found other products using "Environment Doctor", so check trademark, domain and package names before any public release.

## Run it

| You want to… | Do this |
| :- | :- |
| **Use the app on Windows** | Download `Environment-Doctor-<version>-portable.exe` (no install) or `…-nsis.exe` (installer) from the **Environment-Doctor-Windows** artifact of the latest *Environment Doctor* GitHub Actions run, then double-click it. The app is unsigned for now, so on SmartScreen choose **More info → Run anyway**. |
| Build the `.exe` yourself | `cd environment-doctor && npm ci && npm run dist:win` → `release/` (this also works from Linux or macOS without Wine) |
| Develop the UI in a browser (demo data) | `npm run dev` → <http://localhost:5173> |
| Run the desktop app from source | `npm start` |
| Use the CLI | `npm run build:electron && npm run cli -- check` (also `explain <id>`, `fix <id>`, `setup --plan-only`, `list`, `--format json`) |

### Two modes (Settings → General)
- **Live (this PC)** is the default in the desktop app. It runs real read-only checks on this machine and offers a small set of real **user-level** repairs, each with a plan, approval, recovery journal, verification and undo.
- **Demo (sample data)** replays every scenario from the design canvas, including freezes, guided repair across restarts, drift, partial fixes and admin prompts. Nothing touches your PC. The browser build and all automated UI tests use it.

## What's real in this build

| Area | Live on Windows | Notes |
| :- | :- | :- |
| Scan (read-only) | OS/hardware, disks, display drivers + signatures, unsigned driver count, **event-log stability correlation** (unexpected restarts, bug checks, display-driver resets, WHEA), startup items, last Windows update, user + system PATH, Node/npm/pnpm/yarn, Python/pip, Git, Docker engine, WSL, NVIDIA driver + max CUDA, VS Build Tools, secret-looking env var **names only**, project discovery (`package.json`, `pyproject.toml`, compose files) | One bounded PowerShell call (`-NoProfile`, timeouts, output caps). macOS and Linux get the cross-platform subset; everything else shows as *Unknown*. |
| Repairs (typed actions) | Remove dead entries from your PATH · remove duplicate PATH entries · clear temp files older than 7 days · create a project `.venv` · verify the npm cache | All run as your own account (asInvoker). PATH changes save the old value for exact undo. |
| Admin repairs (drivers, restore points, Safe Mode, winget installs) | Listed in **Safe actions** but *not available in this build* | Needs the signed admin helper (spec §3), a later gate. Policy removes these steps from any plan and says why. |
| AI explanations | Off by default. "What the AI sees" shows the redacted preview. | No model is bundled or called in this build (open question in the handoff doc). |

## Safety model (spec v1.2, enforced in `src/engine/engine.ts`, not in the UI)
1. Nothing changes without **Plan & approval**. Each approval is tied to one plan hash, one evidence snapshot and one boot session, lasts 15 minutes, and a restart cancels it.
2. **Only one repair at a time** (global lock). A second repair is queued; it is not treated as an error.
3. The **recovery journal** is written before every step. After a crash or restart, the Resume screen re-checks the real state, and the remaining steps need a fresh approval.
4. **Drift and TOCTOU re-checks** run right before each step. If anything relevant changed, the repair pauses, the step that did *not* run is named, and the approval is cancelled.
5. **"Verified"** only appears after every declared verification check passes. An exit code alone is shown as information, never as success.
6. **Secrets are never read.** Only names and presence are recorded, and evidence is redacted (user name, host name, home path, token-shaped strings) before it is stored.
7. Electron: sandboxed renderer, `contextIsolation`, no Node in the renderer, a two-function contextBridge with a channel allowlist, sender-validated IPC, `app://` protocol with CSP, navigation and new windows blocked, hardened fuses, asInvoker.

## Project layout
```
src/shared/contracts.ts     typed channel map, domain types, error codes (renderer ↔ orchestrator)
src/engine/engine.ts        orchestrator core: approval binding, lock, journal, drift, verification, audit chain
src/engine/orchestrator.ts  facade: settings, live/demo mode, validated channel dispatch
src/engine/demo/            canvas scenarios as deterministic fixtures (+ fault injection)
src/engine/live/            real collectors, rules, user-level actions, bounded exec, durable JSON store
src/electron/               main (broker) + sandboxed preload
src/cli/doctor.ts           CLI (thin client, never mutates)
src/renderer/               React UI: tokens, component library, shell, 22 screens
tests/unit                  engine rules, live collectors, components (+ axe)
tests/e2e                   Playwright flows for AC-01…AC-26 against the demo orchestrator
tests/electron              real desktop app smoke test (bridge, app://, live scan, navigation lock)
```

## Tests
```
npm run typecheck         # renderer + electron configs
npm test                  # vitest: engine safety rules, live collectors, components + axe
npm run test:e2e          # Playwright: acceptance criteria AC-01…AC-26 (builds + serves the renderer)
npm run build && xvfb-run -a npm run test:electron   # desktop app smoke test (drop xvfb-run on Windows/macOS)
```
CI (`.github/workflows/environment-doctor.yml`) runs all of the above on Linux. On a real **Windows** runner it builds the installer and portable `.exe`, runs a live read-only scan via the CLI (`live-scan.json`) and runs the Electron smoke test.

See [`docs/PROJECT.md`](docs/PROJECT.md) for status, decisions, acceptance-criteria traceability and the change log.
