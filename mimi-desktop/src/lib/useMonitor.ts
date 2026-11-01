import { useCallback, useEffect, useRef, useState } from 'react';
import type { InsightsResult, MimiMonitorApi, MonitorSnapshot } from '../types/mimi';

export const POLL_MS = 5000;

export function getMonitorApi(): MimiMonitorApi | null {
  return typeof window !== 'undefined' ? window.mimi?.monitor ?? null : null;
}

export interface MonitorData {
  /** false when running outside the Electron app (plain browser): there is no monitoring engine to ask. */
  available: boolean;
  snapshot: MonitorSnapshot | null;
  insights: InsightsResult | null;
  error: string | null;
  refresh: () => Promise<void>;
  api: MimiMonitorApi | null;
}

/** Single source of truth for the renderer: everything comes from the main-process monitoring service. */
export function useMonitor(days = 7, pollMs = POLL_MS): MonitorData {
  const api = getMonitorApi();
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null);
  const [insights, setInsights] = useState<InsightsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const [s, i] = await Promise.all([api.getSnapshot(), api.getInsights(days)]);
      if (!alive.current) return;
      setSnapshot(s);
      setInsights(i);
      setError(null);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Could not reach the monitoring service');
    }
  }, [api, days]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    if (!api) return () => { alive.current = false; };
    const t = setInterval(() => void refresh(), pollMs);
    return () => { alive.current = false; clearInterval(t); };
  }, [api, refresh, pollMs]);

  return { available: !!api, snapshot, insights, error, refresh, api };
}
