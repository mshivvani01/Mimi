import { useEffect, useState } from 'react';
import { MimiArt } from './MimiArt';
import { POSE_LABELS, type PoseName } from '../mascot/poses';

// Local PNGs (if present) are bundled by Vite; nothing is fetched from a remote server.
const pngs = import.meta.glob('../assets/mascot/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export function pngUrlFor(pose: PoseName): string | undefined {
  return pngs[`../assets/mascot/mimi-${pose}.png`];
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export interface MascotProps {
  pose?: PoseName;
  /** Width in px; height follows the 15:16 aspect ratio. */
  size?: number;
  /** Idle float, blink, and tail sway. Always off when the user prefers reduced motion. */
  animated?: boolean;
  className?: string;
}

export function Mascot({ pose = 'idle', size = 220, animated = true, className = '' }: MascotProps) {
  const reduced = usePrefersReducedMotion();
  const [failed, setFailed] = useState(false);
  const url = failed ? undefined : pngUrlFor(pose);
  const moving = animated && !reduced;

  return (
    <div
      className={`mascot ${moving ? 'mascot--animated' : ''} ${className}`}
      style={{ width: size, height: Math.round((size * 16) / 15) }}
      data-pose={pose}
      data-source={url ? 'png' : 'svg-fallback'}
    >
      {url ? <img src={url} alt={POSE_LABELS[pose]} draggable={false} onError={() => setFailed(true)} /> : <MimiArt pose={pose} />}
    </div>
  );
}
