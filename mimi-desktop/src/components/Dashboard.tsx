import { useState } from 'react';
import { Mascot } from './Mascot';
import { Card } from './ui';
import { DayBars } from './charts';
import { QUOTES } from '../lib/quotes';
import { STATE_LABEL, formatDuration, goalProgress } from '../lib/format';
import type { MimiSettings } from '../lib/settings';
import type { MonitorData } from '../lib/useMonitor';

export function greetingFor(hour: number): string {
  if (hour < 5) return 'Still up?';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function Dashboard({ settings, monitor, now = new Date() }: { settings: MimiSettings; monitor: MonitorData; now?: Date }) {
  const [quoteIndex, setQuoteIndex] = useState(0);
  const { snapshot, insights, available, error } = monitor;
  const R = 44;
  const C = 2 * Math.PI * R;

  const activeMs = snapshot?.today.activeMs ?? 0;
  const goalMs = snapshot?.goalMs ?? 0;
  const progress = goalProgress(activeMs, goalMs);
  const remaining = Math.max(0, goalMs - activeMs);
  const isNew = !!insights && !insights.hasAnyData;
  const state = snapshot?.state;

  let bubble: string;
  if (!available) bubble = "I can only watch your screen time inside the Mimi desktop app. In a plain browser there's nothing for me to measure.";
  else if (!snapshot) bubble = 'Checking in with my monitoring helper...';
  else if (state === 'unsupported') bubble = "I can't measure screen time on this computer yet, so I'm not guessing.";
  else if (state === 'error') bubble = "I'm having trouble saving to my notebook, so today's numbers may be incomplete.";
  else if (state === 'paused') bubble = "Monitoring is paused, so I'm not counting anything right now. Resume it in Settings whenever you like.";
  else if (isNew) bubble = "I'm Mimi! I've just started measuring your computer activity. Numbers appear here as you use your computer.";
  else bubble = 'I measure computer activity and which app is in front. I can\'t tell if you\'re really looking at the screen, so treat these numbers as a guide.';

  return (
    <div className="page dashboard">
      <section className="stage">
        <div className="stage__copy">
          <h1>{greetingFor(now.getHours())}, friend!</h1>
          <p className="stage__bubble">{bubble}</p>
        </div>
        <Mascot pose="wave" size={250} />
      </section>

      {error && <p className="notice area-notice" role="alert">Could not read monitoring data: {error}</p>}
      {snapshot?.database.recoveredFromCorruption && <p className="notice area-notice" role="status">{snapshot.database.message}</p>}
      {snapshot && !snapshot.database.ok && <p className="notice area-notice" role="alert">{snapshot.database.message}</p>}

      <Card title="Screen time today" badge={available ? 'Measured' : 'Unavailable'} tone="lavender" className="area-time">
        {!available ? (
          <p className="muted">No monitoring engine is connected in this environment, so no numbers are shown.</p>
        ) : !snapshot ? (
          <p className="muted">Loading...</p>
        ) : (
          <>
            <p className="big" aria-label="Active screen time today">{formatDuration(activeMs)}</p>
            <p className="muted">
              {isNew && activeMs === 0
                ? 'Nothing recorded yet. This fills in as you use your computer.'
                : `Active computer time. Idle ${formatDuration(snapshot.today.idleMs)} (not counted).`}
            </p>
            {insights && insights.hasAnyData && <DayBars days={insights.days} highlight={snapshot.today.date} label="Active computer time over the last 7 days" />}
          </>
        )}
      </Card>

      <Card title="Daily goal" badge={available ? 'Measured' : 'Unavailable'} tone="mint" className="area-progress">
        {snapshot ? (
          <>
            <div className="ring">
              <svg viewBox="0 0 100 100" width="120" height="120" role="img" aria-label={`${progress}% of the daily screen-time goal used`}>
                <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,.75)" strokeWidth="10" />
                <circle cx="50" cy="50" r={R} fill="none" stroke="#5FBF9A" strokeWidth="10" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - progress / 100)} transform="rotate(-90 50 50)" />
              </svg>
              <strong>{progress}%</strong>
            </div>
            <p className="muted" data-testid="goal-remaining">
              {remaining > 0 ? `${formatDuration(remaining)} left of your ${formatDuration(goalMs)} goal.` : `You've reached your ${formatDuration(goalMs)} goal for today.`}
            </p>
          </>
        ) : (
          <p className="muted">{available ? 'Loading...' : 'Needs the desktop app.'}</p>
        )}
      </Card>

      <Card title="Right now" badge="Live" tone="blue" className="area-now">
        {snapshot ? (
          <>
            <p className="status" data-testid="monitor-status"><span className={`dot dot--${snapshot.state}`} aria-hidden="true" /> {STATE_LABEL[snapshot.state] ?? snapshot.state}</p>
            <p className="muted" data-testid="current-app">
              {snapshot.currentApp ? `In front: ${snapshot.currentApp.appName}` : snapshot.state === 'running' ? 'No foreground app identified right now.' : 'No app being measured.'}
            </p>
            {snapshot.stateDetail && snapshot.state !== 'running' && <p className="muted">{snapshot.stateDetail}</p>}
          </>
        ) : (
          <p className="muted">{available ? 'Loading...' : 'Needs the desktop app.'}</p>
        )}
      </Card>

      <Card title="Break reminder" badge="Preview" tone="blue" className="area-break">
        <div className="preview">
          <Mascot pose="stretch" size={92} animated={false} />
          <p>"Time for a stretch! Roll your shoulders and look at something far away."</p>
        </div>
        <p className="muted">Planned: every {settings.breakReminderMinutes} min of active use. Reminders are not running yet.</p>
      </Card>

      <Card title="Water reminder" badge="Preview" tone="blush" className="area-water">
        <div className="preview">
          <Mascot pose="drink" size={92} animated={false} />
          <p>"Sip, sip! A little water keeps you sparkly."</p>
        </div>
        <p className="muted">Planned: every {settings.waterReminderMinutes} min. Reminders are not running yet.</p>
      </Card>

      <figure className="quote area-quote">
        <blockquote>{QUOTES[quoteIndex]}</blockquote>
        <button type="button" className="btn" onClick={() => setQuoteIndex((i) => (i + 1) % QUOTES.length)}>Show another</button>
      </figure>
    </div>
  );
}
