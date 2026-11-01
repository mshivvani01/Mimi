import { app, BrowserWindow, ipcMain, powerMonitor, session, type IpcMainInvokeEvent } from 'electron';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isAllowedRequestUrl, isTrustedAppUrl, sanitizeDevServerUrl, type TrustConfig } from './security';
import { openBetterSqlite } from './db/better-sqlite-adapter';
import { ActivityRepository } from './db/repository';
import { openDatabase } from './db/sqlite';
import { MonitorService } from './monitor/service';
import { validateClearConfirmation, validateInsightsDays } from './monitor/validation';
import { WindowsSampler } from './monitor/windows-sampler';

const rendererIndex = path.join(__dirname, '..', 'dist', 'index.html');
const trust: TrustConfig = {
  // Ignored entirely in packaged builds, and only loopback addresses are accepted.
  devServerUrl: sanitizeDevServerUrl(process.env.VITE_DEV_SERVER_URL, app.isPackaged),
  rendererFileUrl: pathToFileURL(rendererIndex).toString(),
};
const smokeTest = !app.isPackaged && process.env.MIMI_SMOKE_TEST === '1';

let mainWindow: BrowserWindow | null = null;
let monitor: MonitorService | null = null;

/** Open the local SQLite database and start the monitoring service. Independent of any window. */
function startMonitoring(): MonitorService {
  const dbFile = path.join(app.getPath('userData'), 'mimi-activity.db');
  const opened = openDatabase(dbFile, path.join(__dirname, 'db', 'migrations'), openBetterSqlite);
  const svc = new MonitorService({
    repo: opened.db ? new ActivityRepository(opened.db) : null,
    database: { ok: opened.ok, message: opened.message, recoveredFromCorruption: opened.recoveredFromCorruption },
    sampler: new WindowsSampler(),
  });
  svc.start();
  // Windows sleep/wake and lock/unlock. Missed events are still handled by the tracker's gap and clock-jump rules.
  powerMonitor.on('suspend', () => svc.onSuspend());
  powerMonitor.on('resume', () => svc.onResume());
  powerMonitor.on('lock-screen', () => svc.onLock());
  powerMonitor.on('unlock-screen', () => svc.onUnlock());
  return svc;
}

function showOrCreateWindow(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = createMainWindow();
  mainWindow.on('closed', () => { mainWindow = null; });
}

/** Only the main frame of our own window, showing our own page, may use IPC. */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  if (!mainWindow || event.sender !== mainWindow.webContents) return false;
  if (event.senderFrame !== mainWindow.webContents.mainFrame) return false;
  return isTrustedAppUrl(event.senderFrame.url, trust);
}

function hardenSession(): void {
  const ses = session.defaultSession;
  // Mimi needs no web permissions (camera, mic, notifications, etc.).
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  // Block every request that is not the app's own bundle (nothing remote is ever loaded).
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !isAllowedRequestUrl(details.url, trust) }));
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: '#FFF8EE',
    title: 'Mimi',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: !app.isPackaged,
    },
  });

  win.once('ready-to-show', () => win.show());

  const guardNavigation = (event: { preventDefault: () => void }, url: string) => {
    if (!isTrustedAppUrl(url, trust)) event.preventDefault();
  };
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', guardNavigation);
  win.webContents.on('will-redirect', guardNavigation);
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  if (trust.devServerUrl) void win.loadURL(trust.devServerUrl);
  else void win.loadFile(rendererIndex);
  return win;
}

ipcMain.handle('mimi:get-app-info', (event, ...args: unknown[]) => {
  if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
  if (args.length > 0) throw new Error('mimi:get-app-info takes no arguments');
  return { name: app.getName(), version: app.getVersion(), platform: process.platform };
});

/** Register a trusted-sender-only handler with strict argument validation done by `run`. */
function handleMonitor(channel: string, run: (svc: MonitorService, ...args: unknown[]) => unknown, maxArgs: number): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    if (args.length > maxArgs) throw new Error(`${channel} received unexpected arguments`);
    if (!monitor) throw new Error('Monitoring service is not ready');
    return run(monitor, ...args);
  });
}
handleMonitor('mimi:monitor:get-snapshot', (svc) => svc.getSnapshot(), 0);
handleMonitor('mimi:monitor:set-paused', (svc, paused) => {
  if (typeof paused !== 'boolean') throw new Error('paused must be a boolean');
  return svc.setPaused(paused);
}, 1);
handleMonitor('mimi:monitor:update-settings', (svc, patch) => svc.updateSettings(patch), 1);
handleMonitor('mimi:monitor:get-insights', (svc, days) => svc.getInsights(validateInsightsDays(days)), 1);
handleMonitor('mimi:monitor:clear-history', (svc, confirmation) => {
  validateClearConfirmation(confirmation);
  return svc.clearHistory();
}, 1);
handleMonitor('mimi:app:quit', () => { setImmediate(() => app.quit()); return true; }, 0);

// Single instance: a later phase will focus the existing window / tray instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
  app.on('second-instance', () => {
    if (app.isReady()) showOrCreateWindow();
  });
  app.whenReady().then(() => {
    hardenSession();
    monitor = startMonitoring(); // before any window exists: monitoring does not depend on the dashboard
    showOrCreateWindow();
    app.on('activate', () => showOrCreateWindow());

    // Development-only launch check (never active in packaged builds): MIMI_SMOKE_TEST=1 npm run dev
    if (smokeTest) {
      mainWindow.webContents.once('did-finish-load', async () => {
        try {
          const wc = mainWindow!.webContents;
          const info = await wc.executeJavaScript('window.mimi.getAppInfo()');
          const snapshotState = await wc.executeJavaScript('window.mimi.monitor.getSnapshot().then((s) => s.state)');
          const heading = await wc.executeJavaScript("document.querySelector('h1')?.textContent ?? null");
          const rendered = await wc.executeJavaScript("document.querySelectorAll('.mascot img, .mascot svg').length");
          const imagesLoaded = await wc.executeJavaScript('Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0)');
          const shot = process.env.MIMI_SMOKE_SCREENSHOT;
          if (shot) {
            await new Promise((r) => setTimeout(r, 500));
            writeFileSync(shot, (await wc.capturePage()).toPNG());
          }
          const nodeLeak = await wc.executeJavaScript("typeof require !== 'undefined' || typeof process !== 'undefined'");
          console.log('SMOKE_RESULT ' + JSON.stringify({ info, snapshotState, heading, mascotNodes: rendered, imagesLoaded, rendererHasNode: nodeLeak }));
          app.exit(0);
        } catch (err) {
          console.error('SMOKE_FAILED', err);
          app.exit(1);
        }
      });
    }
  });
  // Closing the dashboard keeps monitoring alive (the service lives in this process) unless the user turned that off.
  // There is no tray yet (Phase 02); until then "Quit Mimi" in Settings, or Task Manager, ends the process.
  app.on('window-all-closed', () => {
    if (!monitor || !monitor.getSettings().keepRunningWhenClosed) app.quit();
  });
  app.on('before-quit', () => { monitor?.stop(); });
}
