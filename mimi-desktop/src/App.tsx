import { useEffect, useState } from 'react';
import { Navigation, type Page } from './components/Navigation';
import { Dashboard } from './components/Dashboard';
import { Insights } from './components/Insights';
import { Settings } from './components/Settings';
import { loadSettings, saveSettings, type MimiSettings } from './lib/settings';
import { useMonitor } from './lib/useMonitor';

export default function App() {
  const [page, setPage] = useState<Page>('home');
  const [range, setRange] = useState(7);
  const [settings, setSettings] = useState<MimiSettings>(() => loadSettings());
  useEffect(() => saveSettings(settings), [settings]);
  // One polling hook = one source of truth for Home, Insights and Settings (data lives in the main process / SQLite).
  const monitor = useMonitor(range);

  return (
    <div className="shell">
      <Navigation page={page} onChange={setPage} />
      <main className="content">
        {page === 'home' && <Dashboard settings={settings} monitor={monitor} />}
        {page === 'insights' && <Insights monitor={monitor} range={range} onRangeChange={setRange} />}
        {page === 'settings' && <Settings settings={settings} onChange={setSettings} monitor={monitor} />}
      </main>
    </div>
  );
}
