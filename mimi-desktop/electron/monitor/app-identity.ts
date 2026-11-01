import type { ForegroundApp } from './types';

const KNOWN: Record<string, string> = {
  'chrome.exe': 'Google Chrome',
  'msedge.exe': 'Microsoft Edge',
  'firefox.exe': 'Firefox',
  'brave.exe': 'Brave',
  'opera.exe': 'Opera',
  'code.exe': 'Visual Studio Code',
  'devenv.exe': 'Visual Studio',
  'explorer.exe': 'File Explorer',
  'winword.exe': 'Microsoft Word',
  'excel.exe': 'Microsoft Excel',
  'powerpnt.exe': 'Microsoft PowerPoint',
  'outlook.exe': 'Microsoft Outlook',
  'onenote.exe': 'Microsoft OneNote',
  'teams.exe': 'Microsoft Teams',
  'ms-teams.exe': 'Microsoft Teams',
  'slack.exe': 'Slack',
  'discord.exe': 'Discord',
  'spotify.exe': 'Spotify',
  'notepad.exe': 'Notepad',
  'cmd.exe': 'Command Prompt',
  'powershell.exe': 'Windows PowerShell',
  'windowsterminal.exe': 'Windows Terminal',
  'mimi.exe': 'Mimi',
  'electron.exe': 'Mimi (development)',
};

export const UNIDENTIFIED_APP: ForegroundApp = { appId: 'unidentified', appName: 'Unidentified app' };

/**
 * Reduce an executable path to the minimum we keep: the lower-cased file name and a friendly name.
 * The directory part is discarded immediately and never stored or sent anywhere.
 */
export function identifyApp(exePathOrName: string | null | undefined): ForegroundApp {
  if (!exePathOrName) return UNIDENTIFIED_APP;
  const base = exePathOrName.split(/[\\/]/).pop()?.trim() ?? '';
  if (!base) return UNIDENTIFIED_APP;
  const id = base.toLowerCase().slice(0, 128);
  if (KNOWN[id]) return { appId: id, appName: KNOWN[id] };
  const stem = id.replace(/\.exe$/, '');
  const words = stem.split(/[^a-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1));
  return { appId: id, appName: words.length ? words.join(' ') : id };
}
