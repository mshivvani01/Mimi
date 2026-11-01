/**
 * Pure URL / IPC trust decisions (no Electron imports, so they are unit-testable).
 * Rule of thumb: allow exactly the app's own renderer, nothing broader.
 */

export interface TrustConfig {
  /** Dev server origin, e.g. http://localhost:5173. Must be undefined in packaged builds. */
  devServerUrl?: string;
  /** file:// URL of the built renderer index.html. */
  rendererFileUrl: string;
}

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** Only loopback http(s) origins are acceptable as a dev server. */
export function sanitizeDevServerUrl(raw: string | undefined, isPackaged: boolean): string | undefined {
  if (!raw || isPackaged) return undefined;
  const u = parse(raw);
  if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:')) return undefined;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return undefined;
  return u.origin;
}

/** True only for the app's own page: the dev server origin, or exactly the built index.html (hash/query ignored). */
export function isTrustedAppUrl(url: string, cfg: TrustConfig): boolean {
  const u = parse(url);
  if (!u) return false;
  if (cfg.devServerUrl) return u.origin === new URL(cfg.devServerUrl).origin;
  const app = parse(cfg.rendererFileUrl);
  return !!app && u.protocol === 'file:' && u.pathname === app.pathname;
}

/** Network requests the renderer may make: its own bundle, data URIs, and (dev only) the dev server + HMR socket; devtools: only occurs when DevTools is enabled (dev). */
export function isAllowedRequestUrl(url: string, cfg: TrustConfig): boolean {
  const u = parse(url);
  if (!u) return false;
  if (['data:', 'blob:', 'devtools:'].includes(u.protocol)) return true;
  if (u.protocol === 'file:') return true;
  if (cfg.devServerUrl) {
    const dev = new URL(cfg.devServerUrl);
    return u.host === dev.host && ['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol);
  }
  return false;
}
