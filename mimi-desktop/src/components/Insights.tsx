import { useState } from 'react';
import { Card } from './ui';
import { DayBars, TimelineStrip } from './charts';
import { Mascot } from './Mascot';
import { formatDuration } from '../lib/format';
import type { MonitorData } from '../lib/useMonitor';

export function Insights({ monitor, onRangeChange, range }: { monitor: MonitorData; range: number; onRangeChange: (days: number) => void }) {
  const { insights, available, error } = monitor;
  const [showAll, setShowAll] = useState(false);

  if (!available) {
    return (
      <div className="page">
        <h1 className="page__title">Insights</h1>
        <Card title="Unavailable" badge="Needs desktop app" tone="cream">
          <p className="muted">Insights come from Mimi's local monitoring engine, which only runs inside the desktop app. Nothing is shown here instead of made-up numbers.</p>
        </Card>
      </div>
    );
  }
  if (!insights) {
    return (
      <div className="page">
        <h1 className="page__title">Insights</h1>
        <p className="muted">{error ? `Could not load insights: ${error}` : 'Loading...'}</p>
      </div>
    );
  }

  const totalActive = insights.days.reduce((s, d) => s + d.activeMs, 0);
  const totalIdle = insights.days.reduce((s, d) => s + d.idleMs, 0);
  const measured = totalActive + totalIdle;
  const activePct = measured > 0 ? Math.round((totalActive / measured) * 100) : 0;
  const apps = showAll ? insights.apps : insights.apps.slice(0, 6);
  const topMax = Math.max(1, ...insights.apps.map((a) => a.activeMs));

  return (
    <div className="page">
      <h1 className="page__title">Insights</h1>
      <div className="row">
        <div className="row__text"><label htmlFor="range">Show the last</label></div>
        <select id="range" value={range} onChange={(e) => onRangeChange(Number(e.target.value))}>
          <option value={7}>7 days</option>
          <option value={14}>14 days</option>
          <option value={30}>30 days</option>
        </select>
      </div>

      {!insights.hasAnyData ? (
        <Card title="Nothing measured yet" tone="cream">
          <div className="preview">
            <Mascot pose="rest" size={110} />
            <p>No activity has been recorded yet. Use your computer for a bit with monitoring on, and your history will appear here.</p>
          </div>
        </Card>
      ) : (
        <>
          <Card title={`Active computer time, last ${range} days`} badge="Measured" tone="lavender">
            <p className="big">{formatDuration(totalActive)}</p>
            <p className="muted">Total across {range} days. Daily average {formatDuration(totalActive / range)}.</p>
            <DayBars days={insights.days} highlight={insights.timelineDate} label={`Active computer time per day, last ${range} days`} />
          </Card>

          <Card title="Active versus idle" badge="Measured" tone="mint">
            <div className="split" role="img" aria-label={`${activePct}% active, ${100 - activePct}% idle`}>
              <span className="split__a" style={{ width: `${activePct}%` }} />
            </div>
            <p className="muted">Active {formatDuration(totalActive)} · Idle {formatDuration(totalIdle)}. Idle means no keyboard or mouse input past your threshold; it is never counted as screen time.</p>
          </Card>

          <Card title="Apps" badge="Measured" tone="blue">
            {insights.apps.length === 0 ? <p className="muted">No foreground app time recorded yet.</p> : (
              <ul className="applist">
                {apps.map((a) => (
                  <li key={a.appId}>
                    <span className="applist__name">{a.appName}</span>
                    <span className="applist__bar"><i style={{ width: `${(a.activeMs / topMax) * 100}%` }} /></span>
                    <span className="applist__time">{formatDuration(a.activeMs)}</span>
                  </li>
                ))}
              </ul>
            )}
            {insights.apps.length > 6 && <button type="button" className="btn" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show fewer' : 'Show all'}</button>}
          </Card>

          <Card title="Today's timeline" badge="Measured" tone="blush">
            <TimelineStrip blocks={insights.timeline} date={insights.timelineDate} />
          </Card>
        </>
      )}
      <p className="muted about">Mimi measures computer activity and the foreground app. It cannot know whether you are actually looking at the screen.</p>
    </div>
  );
}
