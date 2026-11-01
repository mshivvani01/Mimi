import { describe, expect, it } from 'vitest';
import { isAllowedRequestUrl, isTrustedAppUrl, sanitizeDevServerUrl } from '../electron/security';

const prod = { rendererFileUrl: 'file:///C:/Program%20Files/Mimi/resources/app.asar/dist/index.html' };
const dev = { devServerUrl: 'http://localhost:5173', rendererFileUrl: prod.rendererFileUrl };

describe('sanitizeDevServerUrl', () => {
  it('ignores the dev URL in packaged builds', () => {
    expect(sanitizeDevServerUrl('http://localhost:5173', true)).toBeUndefined();
  });
  it('accepts loopback only', () => {
    expect(sanitizeDevServerUrl('http://localhost:5173', false)).toBe('http://localhost:5173');
    expect(sanitizeDevServerUrl('http://127.0.0.1:5173/x', false)).toBe('http://127.0.0.1:5173');
    expect(sanitizeDevServerUrl('https://evil.example', false)).toBeUndefined();
    expect(sanitizeDevServerUrl('file:///etc/passwd', false)).toBeUndefined();
    expect(sanitizeDevServerUrl('not a url', false)).toBeUndefined();
    expect(sanitizeDevServerUrl(undefined, false)).toBeUndefined();
  });
});

describe('isTrustedAppUrl', () => {
  it('production: only the exact built index.html', () => {
    expect(isTrustedAppUrl(prod.rendererFileUrl, prod)).toBe(true);
    expect(isTrustedAppUrl(prod.rendererFileUrl + '#/settings', prod)).toBe(true);
    expect(isTrustedAppUrl('file:///C:/Users/me/evil.html', prod)).toBe(false);
    expect(isTrustedAppUrl('https://example.com', prod)).toBe(false);
    expect(isTrustedAppUrl('http://localhost:5173', prod)).toBe(false);
    expect(isTrustedAppUrl('garbage', prod)).toBe(false);
  });
  it('dev: only the dev server origin', () => {
    expect(isTrustedAppUrl('http://localhost:5173/', dev)).toBe(true);
    expect(isTrustedAppUrl('http://localhost:5174/', dev)).toBe(false);
    expect(isTrustedAppUrl('http://localhost.evil.com:5173/', dev)).toBe(false);
    expect(isTrustedAppUrl(prod.rendererFileUrl, dev)).toBe(false);
  });
});

describe('isAllowedRequestUrl', () => {
  it('production allows local bundle and data URIs, blocks the network', () => {
    expect(isAllowedRequestUrl('file:///app/dist/assets/index.js', prod)).toBe(true);
    expect(isAllowedRequestUrl('data:image/png;base64,AAAA', prod)).toBe(true);
    expect(isAllowedRequestUrl('https://fonts.googleapis.com/css', prod)).toBe(false);
    expect(isAllowedRequestUrl('http://localhost:5173/', prod)).toBe(false);
    expect(isAllowedRequestUrl('ws://localhost:5173/', prod)).toBe(false);
  });
  it('dev additionally allows the dev server and its HMR socket', () => {
    expect(isAllowedRequestUrl('http://localhost:5173/src/main.tsx', dev)).toBe(true);
    expect(isAllowedRequestUrl('ws://localhost:5173/?token=x', dev)).toBe(true);
    expect(isAllowedRequestUrl('https://example.com/x.js', dev)).toBe(false);
  });
});
