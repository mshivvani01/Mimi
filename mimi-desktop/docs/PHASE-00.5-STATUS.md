# Phase 00.5 status (improvement pass on Phase 00)

Environment: Linux sandbox, Node 22, running as root. Electron 33 binary was downloaded and run under Xvfb (virtual display). **This is not Windows.**
Phase 00 files (app, dashboard, settings, architecture, tests, `PHASE-00-STATUS.md`) are preserved; the delivered Phase 00 zip matched the working tree byte-for-byte before changes began. Phase 01 has not been started.

## Done
1. **Mascot artwork**: all 8 transparent RGBA PNGs generated and integrated (see `MASCOT-DESIGN.md`). Visually reviewed on a contact sheet and in the running app. Cream-white chubby cat, violet eyes, pink bow, lavender collar with heart charm, consistent across poses.
2. **Manifest**: now generated from the files actually written (dimensions, bytes, hash); a test checks it against disk.
3. **App icon**: `build/icon.ico` + `build/icon.png`; wired into the window and the electron-builder config.
4. **Electron security** (details below).
5. **Tests**: 24 (was 17). Added `tests/security.test.ts`, a real-PNG manifest check, and a PNG-is-used check.
6. **Launch tested** in development and in built mode (see table).

## Security changes
- `electron/security.ts` (pure, unit-tested): exact-URL trust instead of "any `file://`". Production trusts only the built `index.html`; dev trusts only the dev-server origin.
- Dev server URL is **ignored in packaged builds** and must be loopback (`localhost`, `127.0.0.1`, `[::1]`); verified at runtime that `VITE_DEV_SERVER_URL=https://evil.example` is ignored.
- IPC sender must be the app's own window, its **main frame** (no sub-frames), at a trusted URL; the channel also rejects unexpected arguments.
- All outbound requests from the renderer are cancelled unless they are the local bundle, data/blob URIs, or (dev only) the dev server and HMR socket. All web permission requests are denied.
- Added `will-redirect` guard, `will-attach-webview` block, `webviewTag: false`, `webSecurity: true`, `allowRunningInsecureContent: false`, `nodeIntegrationInSubFrames: false`, DevTools disabled in packaged builds. Kept context isolation, sandbox, no Node integration.
- Dev-only smoke-test hook (`MIMI_SMOKE_TEST=1`) in `main.ts`; inactive when packaged.

## Commands and results
| Check | Result |
|---|---|
| `npm install` (+ `@resvg/resvg-js`) | Passed |
| `npm run assets:mascot` | Passed, 8 PNGs written, all RGBA with transparent corners |
| `npm run typecheck` | Passed |
| `npm test` | Passed, 24/24 |
| `npm run build` | Passed (PNGs bundled into `dist/assets`) |
| Dev launch: Vite + Electron under Xvfb with `MIMI_SMOKE_TEST=1` | Passed: IPC returned app info, dashboard rendered, renderer has no `require`/`process` |
| Built-mode launch (`file://`) | Passed, same results, and all images loaded (`naturalWidth > 0`) |
| Unsafe dev URL launch | Passed: URL ignored, built app loaded instead |
| Screenshot of the real window | Captured: `docs/screenshot-home.png` |

## Could NOT be checked
- **Windows**: nothing was run on Windows (no Windows startup, taskbar, installer behaviour, or DPI scaling checks).
- **`npm run package`** (NSIS installer): not run; it needs Windows or Wine. The icon in an installed build is therefore unverified.
- **`npm run dev`** exactly as written (concurrently + wait-on): its two halves were run separately (Vite, then Electron with the dev URL). Not run as one command.
- Electron was run with `--no-sandbox --disable-gpu` because the container runs as root without a GPU; that flag is a container workaround, not part of the app. The window-level renderer sandbox stays on.
- Non-fatal Chromium log noise (IPv6 socket, D-Bus) appeared in the container.
- No linter is configured. Hover/click interactions in the real window were not exercised beyond the load smoke test.

## Known limitations
- Artwork is stylised vector-rendered, not an AI-generated or true 3D render.
- Pose animation (blink, wave, tail) only affects the vector fallback.
- Settings page tabs were covered by unit tests, not visually reviewed in Electron.

## Next (not started)
Phase 01. Optionally replace the PNGs with painted/3D-rendered art, and build and test the installer on Windows.
