export type Page = 'home' | 'insights' | 'settings';

const ITEMS: { id: Page; label: string; icon: JSX.Element }[] = [
  { id: 'home', label: 'Home', icon: <path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" /> },
  { id: 'insights', label: 'Insights', icon: <path d="M5 20V11M12 20V5M19 20v-6" /> },
  { id: 'settings', label: 'Settings', icon: <><circle cx="12" cy="12" r="3.2" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></> },
];

export function Navigation({ page, onChange }: { page: Page; onChange: (p: Page) => void }) {
  return (
    <nav className="nav" aria-label="Main">
      <div className="nav__brand" aria-hidden="true">Mimi</div>
      {ITEMS.map((item) => (
        <button key={item.id} type="button" className="nav__item" aria-current={page === item.id ? 'page' : undefined} onClick={() => onChange(item.id)}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{item.icon}</svg>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
