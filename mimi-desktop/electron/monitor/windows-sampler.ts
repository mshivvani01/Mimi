import { identifyApp } from './app-identity';
import type { Sample } from './types';

export interface Sampler {
  /** null when the sampler works; otherwise a human-readable reason it cannot (never silently faked). */
  unavailableReason(): string | null;
  sample(): Sample;
}

// Win32 constants
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000; // least privilege: enough for QueryFullProcessImageNameW only

/**
 * Real Windows sampler using user32/kernel32 through koffi (prebuilt N-API FFI, no compiler needed):
 *  - GetForegroundWindow + GetWindowThreadProcessId + OpenProcess(LIMITED) + QueryFullProcessImageNameW -> exe name
 *  - GetLastInputInfo + GetTickCount -> milliseconds since last keyboard/mouse input (system-wide)
 *
 * NOT collected: window titles, screenshots, keystrokes, document/browser contents. The full executable path is
 * read into a local variable and reduced to a file name immediately.
 *
 * Verified only by typecheck in the sandbox this was written in (Linux). See docs/PHASE-01-STATUS.md for Windows steps.
 */
export class WindowsSampler implements Sampler {
  private api: WinApi | null = null;
  private loadError: string | null = null;

  constructor(platform: NodeJS.Platform = process.platform, loader: () => WinApi = loadWinApi) {
    if (platform !== 'win32') {
      this.loadError = `Foreground/idle detection is only implemented for Windows (this is ${platform}).`;
      return;
    }
    try {
      this.api = loader();
    } catch (err) {
      this.loadError = `Could not load the Windows activity API (koffi): ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  unavailableReason(): string | null {
    return this.loadError;
  }

  sample(): Sample {
    if (!this.api) return { ok: false, error: this.loadError ?? 'sampler unavailable' };
    try {
      const idleMs = this.api.idleMs();
      if (idleMs === null) return { ok: false, error: 'GetLastInputInfo failed' };
      const exe = this.api.foregroundExe();
      if (exe === 'none') return { ok: true, foreground: null, idleMs };
      return { ok: true, foreground: identifyApp(exe), idleMs };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

/** What the native layer must provide. Kept tiny so tests can fake it. */
export interface WinApi {
  /** ms since last input, or null if the call failed. Handles the 49.7-day tick wrap. */
  idleMs(): number | null;
  /** 'none' = no foreground window; null = window exists but process could not be identified (e.g. elevated). */
  foregroundExe(): string | null | 'none';
}

export function loadWinApi(): WinApi {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');

  const LASTINPUTINFO = koffi.struct('LASTINPUTINFO', { cbSize: 'uint32_t', dwTime: 'uint32_t' });
  const GetForegroundWindow = user32.func('void* __stdcall GetForegroundWindow()');
  const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(void* hWnd, _Out_ uint32_t* lpdwProcessId)');
  const GetLastInputInfo = user32.func('bool __stdcall GetLastInputInfo(_Inout_ LASTINPUTINFO* plii)');
  const GetTickCount = kernel32.func('uint32_t __stdcall GetTickCount()');
  const OpenProcess = kernel32.func('void* __stdcall OpenProcess(uint32_t dwDesiredAccess, bool bInheritHandle, uint32_t dwProcessId)');
  const QueryFullProcessImageNameW = kernel32.func('bool __stdcall QueryFullProcessImageNameW(void* hProcess, uint32_t dwFlags, _Out_ uint16_t* lpExeName, _Inout_ uint32_t* lpdwSize)');
  const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void* hProcess)');

  return {
    idleMs() {
      const info = { cbSize: koffi.sizeof(LASTINPUTINFO), dwTime: 0 };
      if (!GetLastInputInfo(info)) return null;
      return (GetTickCount() - info.dwTime) >>> 0; // unsigned subtraction survives tick-count wrap
    },
    foregroundExe() {
      const hwnd = GetForegroundWindow();
      if (!hwnd) return 'none';
      const pid = [0];
      GetWindowThreadProcessId(hwnd, pid);
      if (!pid[0]) return null;
      const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid[0]);
      if (!h) return null; // access denied for elevated/protected processes: reported as "Unidentified app"
      try {
        const buf = new Uint16Array(1024);
        const size = [buf.length];
        if (!QueryFullProcessImageNameW(h, 0, buf, size)) return null;
        return Buffer.from(buf.buffer, 0, Math.min(size[0], buf.length) * 2).toString('utf16le');
      } finally {
        CloseHandle(h);
      }
    },
  };
}
