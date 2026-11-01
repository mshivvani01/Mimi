# Mimi — Your Little Screen-Time Buddy (Phase 00)

Windows desktop wellness companion built with Electron, React, TypeScript, and Vite.
Phase 00 is the foundation only: app shell, dashboard, settings UI, mascot component, and secure Electron setup.
Phase 00.5 added the mascot PNG artwork, an app icon, and Electron security hardening (see `docs/PHASE-00.5-STATUS.md`).
**Screen-time monitoring, reminders, tray, startup, and the floating mascot are NOT implemented yet.**

## Install
    npm install

## Run (development)
    npm run dev
Starts Vite on port 5173, compiles the Electron main/preload scripts, and opens the app window.

## Test / typecheck
    npm test
    npm run typecheck
No linter is configured in Phase 00.

## Build
    npm run build      # renderer -> dist/, Electron -> dist-electron/
    npm start          # build, then launch the built app
    npm run package    # Windows NSIS installer via electron-builder (output in release/)

## Mascot assets
    npm run assets:mascot   # re-render src/assets/mascot/*.png and the manifest from src/components/MimiArt.tsx

## Launch smoke test (development only)
    npm run build
    MIMI_SMOKE_TEST=1 npx electron .      # logs SMOKE_RESULT {...} and exits
On a headless Linux box wrap it in `xvfb-run -a` and add `--no-sandbox --disable-gpu` (container workarounds only).
Optional `MIMI_SMOKE_SCREENSHOT=/path/out.png` saves a screenshot.

## Layout
- `electron/` main process and preload bridge (context isolation on, sandbox on, node integration off, one validated IPC channel)
- `src/` React renderer: `components/`, `lib/`, `mascot/`, `styles/`, `assets/`
- `tests/` Vitest + Testing Library
- `scripts/` mascot PNG generator
- `build/` app icon (`icon.ico`, `icon.png`)
- `docs/` mascot design notes and the Phase 00 status report

See `docs/PHASE-00-STATUS.md` for exactly what is and isn't done.


## Phase 01: screen-time monitoring

Mimi now has a local monitoring engine in the Electron main process (foreground app + idle time via Windows APIs, stored in SQLite).
See `docs/PHASE-01-STATUS.md` for what is implemented, how time is calculated, what was and was not verified, and the Windows checklist.

- `npm run test:engine` runs the engine tests (Node 22+, uses `node:sqlite`); `npm run test:renderer` runs the React tests; `npm test` runs both.
- Native modules: `better-sqlite3` (rebuilt for Electron by `postinstall`) and `koffi` (prebuilt). See the status document for packaging notes.
- Mimi measures computer activity and the foreground app only. Data stays on this computer.
