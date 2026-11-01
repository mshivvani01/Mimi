import type { ReactNode } from 'react';

export function Card({ title, badge, tone = 'cream', children, className = '' }: { title: string; badge?: string; tone?: 'cream' | 'lavender' | 'mint' | 'blue' | 'blush'; children: ReactNode; className?: string }) {
  return (
    <section className={`card card--${tone} ${className}`}>
      <header className="card__head">
        <h2>{title}</h2>
        {badge && <span className="badge">{badge}</span>}
      </header>
      {children}
    </section>
  );
}

export function Toggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="row">
      <div className="row__text">
        <label htmlFor={id}>{label}</label>
        {hint && <p>{hint}</p>}
      </div>
      <input id={id} type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </div>
  );
}
