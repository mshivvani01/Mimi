# Phase 01 status: real screen-time monitoring, activity detection, local history

**Read this first.** This phase was written in a Linux sandbox with **no network access**. `npm install` failed (`ENOTFOUND registry.npmjs.org`), so Electron, React, Vite, Vitest, better-sqlite3 and koffi were **never installed or run**. There is no Windows machine either. What was and was not verified is listed exactly below. Nothing here is reported as passing unless it was executed.

## What was built (all in source, per the Phase 00.5 repository layout)

| Area | Files | Notes |
|---|---|---|
| Time accounting | `electron/monitor/tracker.ts` | State machine producing non-overlapping, timestamped segments. Durations use a monotonic clock; wall time is stored for display only. |
| Windows detection | `electron/monitor/windows-sampler.ts`, `app-identity.ts` | `koffi` FFI to `user32`/`kernel32`: `GetForegroundWindow`, `GetWindowThreadProcessId`, `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)`, `QueryFullProcessImageNameW`, `GetLastInputInfo`, `GetTickCount`. Only the lower-cased exe name is kept. No window titles. |
| Service | `electron/monitor/service.ts` | Single chained-timeout loop (no overlap), lives in the main process with no BrowserWindow dependency. Sleep/lock hooks via Electron `powerMonitor`. |
| SQLite | `electron/db/sqlite.ts`, `repository.ts`, `better-sqlite-adapter.ts`, `migrations/001_initial.sql` | better-sqlite3, parameterised SQL, versioned migrations (each in a transaction), unique partial index allowing only one open segment, corruption quarantine, too-new-schema refusal. |
| Validation | `electron/monitor/validation.ts` | Settings patch, insights range and clear-history confirmation are validated in the main process. |
| IPC | `electron/main.ts`, `electron/preload.ts` | Six new channels, each checks the trusted sender, rejects extra arguments, validates values. No generic passthrough, no SQL, no filesystem access. Phase 00.5 security settings are unchanged. |
| UI | `src/components/*`, `src/lib/useMonitor.ts`, `format.ts` | Home, Insights and Settings read from the monitoring bridge. All `Demo data` was removed. Outside Electron the UI shows "no numbers", not invented ones. Mascot art and styling untouched. |

## How time is calculated

- **Active**: foreground app attributed from the sample that first sees it until the next sample that sees a different state. Error is at most one sample interval (default 3 s). Not millisecond-accurate and does not claim to be.
- **Idle**: when `GetLastInputInfo` idle time reaches the threshold (default 60 s), the active segment ends at the *last input* (now minus idle time) and an idle segment starts there. Returning input ends the idle segment at the moment of that input. Idle is never counted as active.
- **Not measured** (paused, locked, asleep, app not running): no rows are written, so these appear as gaps, not as idle.
- **Unknown**: recorded when the native API fails 3 times in a row, or when no foreground window exists. Never counted as active.
- **Gaps**: a gap larger than `max(15 s, 4 x interval)` between samples is not credited (stall or undetected sleep).
- **Clock changes**: if wall-clock and monotonic deltas disagree by more than 5 s, the segment is closed at the last confirmed point and a new one starts. `end_ts = start_ts + duration_ms` always holds, so history stays self-consistent. Time-zone offset changes also split segments.
- **Midnight**: segments are split at local midnight; `local_date` is the local date of `start_ts`.
- **Crashes**: the open row's end/duration is checkpointed every 15 s. On next start any open row is closed at its last checkpoint (flagged `recovered = 1`); nothing is extrapolated. Worst-case loss is about 15 s.
- **Database failures**: tracker queues unsaved closes/inserts (max 200, drop counter exposed) and retries; the snapshot reports `unsavedSegments`.

## Verification actually performed

Environment: Linux sandbox, Node 22.22.2, global `tsx` and `tsc` only, no network.

| Check | Result |
|---|---|
| `npm install` | **FAILED** (no network, `ENOTFOUND`). `node_modules` was not populated. |
| Engine unit/integration tests: `tsx --test tests-engine/*.test.ts` | **Executed: 54 passed, 0 failed.** Run against real SQLite via Node's built-in `node:sqlite` (same SQL as production), with a fake clock and a fake OS sampler. |
| Typecheck of `electron/**` and `tests-engine/**` (global `tsc`, `@types/node` borrowed from another package) | **Passed for all engine files.** `electron/main.ts` and `electron/preload.ts` could not be fully typechecked because the `electron` types are not installed; the only errors reported were "cannot find module 'electron'" and the implicit-any cascade from it. |
| Typecheck of `src/**` and `tests/**` | **Not run** (React/Vite/Vitest types not installed). |
| Renderer tests `vitest run` (`tests/*.test.ts(x)`) | **Not run.** `tests/app.test.tsx` was rewritten for the new UI but has never executed. It may need small fixes. |
| `npm run build` / `npm run build:electron` | **Not run.** |
| Lint | No linter is configured (as in Phase 00.5). |
| Electron launch / smoke test | **Not run** (no Electron binary). |
| Real Windows integration (koffi calls, powerMonitor, idle, foreground) | **Not run.** The Windows sampler is tested only against a faked native API. The koffi signatures were written from documentation and have **never been executed**. |
| `npm run package` | **Not run.** |

Tests that use mocks: everything in `tests-engine/service.test.ts` that involves `FakeSampler`, and the `WindowsSampler` tests with a faked `WinApi`. These are **not** Windows integration tests.

## Things you must do on a networked Windows machine

1. `npm install`. **The `package-lock.json` is stale**: `package.json` gained `better-sqlite3`, `koffi`, `tsx`, `@types/better-sqlite3` but the lockfile could not be regenerated offline. Use `npm install` (not `npm ci`) once and commit the new lockfile.
2. The `postinstall` script runs `electron-builder install-app-deps`, which fetches or rebuilds `better-sqlite3` for Electron 33. A prebuilt binary is normally downloaded; otherwise you need Visual Studio Build Tools (C++ workload) and Python. `koffi` ships prebuilt N-API binaries and needs no compiler. Both are listed in `asarUnpack` for packaging.
3. `npm run typecheck`, `npm test` (needs Node 22+ for `node:sqlite` in `test:engine`), `npm run build`, `npm start`. Fix whatever surfaces: especially `tests/app.test.tsx` and the koffi calls.
4. Manual Windows checks:
   - Open Mimi, use a few apps for ~1 minute, confirm Home's "In front" and today total change and the total is about your real active time.
   - Stop touching input for longer than the idle threshold: status becomes "Idle", and today's active total stops growing. Move the mouse: it resumes.
   - Close the window. Confirm `mimi.exe` is still in Task Manager and use Mimi again from the Start menu (second launch restores the window). Today's total should include time while the window was closed.
   - Win+L, unlock; sleep/wake: totals must not grow while locked or asleep.
   - Pause in Settings: Task Manager still shows Mimi, but no new rows are written (`%APPDATA%\Mimi\mimi-activity.db`; open with any SQLite viewer).
   - Run a process as Administrator and focus it: it should appear as "Unidentified app" (Mimi is not elevated, so `OpenProcess` is denied).
   - Kill `mimi.exe` in Task Manager mid-session, relaunch: the last segment should be recovered (`recovered = 1`).
   - Change the system clock by an hour: no huge or negative durations appear.
   - Settings > Clear activity history: confirm, then Home and Insights return to the empty state.

## Known limitations and decisions

- **No tray yet (Phase 02).** To satisfy "closing the dashboard does not stop monitoring", the process now stays alive after the window closes when `keepRunningWhenClosed` is on (default on). There is no tray icon, so the only ways back are launching Mimi again or Task Manager, and the only way out is **Settings > Quit Mimi** (or Task Manager). This is visible, user-controlled and documented in the UI, and is not hidden persistence. Turn the setting off to quit on window close.
- **Monitoring is on by default** with a plain-language disclosure in Settings. There is no first-run consent screen yet.
- **Display names** come from a small built-in table plus title-casing the exe name. Version-resource names (`FileDescription`) are not read. UWP apps hosted by `ApplicationFrameHost.exe` appear under that host name.
- **Browser tabs** are not distinguished (only "Google Chrome" etc.), by design for privacy.
- **Fullscreen video/reading** with no input is counted as idle after the threshold; input is evidence of computer activity, not of attention.
- **Multiple monitors / virtual desktops**: only the single foreground window is sampled.
- **Shutdown/log-off** has no dedicated hook; the 15 s checkpoint + recovery covers it.
- The existing Phase 00 localStorage settings (reminder intervals, quiet hours, etc.) are unchanged and still not acted on. The old `monitoringEnabled` localStorage flag was removed; monitoring settings now live in SQLite.
- Main-process IPC handlers and the `powerMonitor` wiring in `main.ts` have no automated tests (they need Electron). The pure validation they call is tested.
- `src/types/mimi.d.ts` mirrors `electron/monitor/types.ts` by hand.
- No daily/app summary tables: aggregates are computed from the segments table, so there is a single source of truth. Add summary tables only if the history grows large enough to need them.

## Acceptance criteria

| # | Criterion | Status |
|---|---|---|
| 1 | Real Windows foreground + idle detection implemented | Implemented in code; **not run on Windows** |
| 2 | Intervals computed without double counting | Implemented; **unit-tested (passed)** |
| 3 | Active and idle separated | Implemented; **tested (passed)** |
| 4 | History persists in SQLite | Implemented; **tested with node:sqlite (passed)**; better-sqlite3 not run |
| 5 | Dashboard displays stored measurements | Implemented; renderer tests written but **not run** |
| 6 | Closing the dashboard does not stop monitoring | Implemented (service independent of windows, process stays alive); service-level test passed, **real window close not run** |
| 7 | Pausing prevents new active records | Implemented; **tested (passed)** |
| 8 | Mascot artwork and UI intact | Assets and styles untouched (additions only); **not visually re-checked** |
| 9 | Tests/builds executed and reported truthfully | Partly: see table above |
| 10 | Cumulative ZIP created and verified | See final delivery message |

## Next (not started)

Phase 02: tray, startup, reminder engine, floating mascot window. Before that: run the Windows checklist above and fix what it finds.
