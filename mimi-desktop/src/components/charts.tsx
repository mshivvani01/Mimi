import { formatDuration, weekdayShort } from '../lib/format';
import type { DayTotals, TimelineBlock } from '../types/mimi';

/** Daily active-time bars computed purely from real stored totals (no placeholder values). */
export function DayBars({ days, highlight, label }: { days: DayTotals[]; highlight?: string; label: string }) {
  const max = Math.max(1, ...days.map((d) => d.activeMs));
  return (
    <div className="bars" role="img" aria-label={label}>
      {days.map((d) => (
        <div key={d.date} className={`bars__col ${d.date === highlight ? 'is-today' : ''}`} title={`${d.date}: ${formatDuration(d.activeMs)} active`}>
          <div className="bars__bar" style={{ height: `${Math.max(d.activeMs > 0 ? 4 : 0, (d.activeMs / max) * 100)}%` }} />
          <span>{days.length <= 7 ? weekdayShort(d.date) : d.date.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

/** A 24-hour strip of today's measured blocks. Gaps are time Mimi did not measure (paused, asleep, locked, off). */
export function TimelineStrip({ blocks, date }: { blocks: TimelineBlock[]; date: string }) {
  const [y, m, d] = date.split('-').map(Number);
  const start = new Date(y, m - 1, d).getTime();
  const end = new Date(y, m - 1, d + 1).getTime();
  const span = end - start;
  return (
    <div>
      <div className="timeline" role="img" aria-label="Today's measured activity by time of day">
        {blocks.map((b, i) => {
          const left = ((Math.max(b.startTs, start) - start) / span) * 100;
          const width = Math.max(0.15, ((Math.min(b.endTs, end) - Math.max(b.startTs, start)) / span) * 100);
          return <span key={i} className={`timeline__block timeline__block--${b.kind}`} style={{ left: `${left}%`, width: `${width}%` }} title={`${b.kind}${b.appName ? ` · ${b.appName}` : ''}`} />;
        })}
      </div>
      <div className="timeline__axis" aria-hidden="true"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>12am</span></div>
      <p className="legend"><i className="swatch swatch--active" /> Active <i className="swatch swatch--idle" /> Idle <i className="swatch swatch--unknown" /> Unknown · blank = not measured</p>
    </div>
  );
}
