import { useId } from 'react';
import type { PoseName } from '../mascot/poses';

/**
 * Mimi's original artwork, drawn in code as layered SVG with soft 3D-toy shading (radial gradients,
 * glossy eyes, blurred rim/ambient highlights). `scripts/generate-mascot.tsx` renders every pose from
 * this single source into the transparent PNGs in src/assets/mascot/, so poses stay consistent.
 * It is also the runtime fallback when a PNG is missing. See docs/MASCOT-DESIGN.md.
 */
const C = { cream: '#FFF3E2', creamEdge: '#E9D5BD', belly: '#FFFAF2', blush: '#F7A8C4', blushDeep: '#E8809F', nose: '#F28BA8', lav: '#CDB8F0', lavDeep: '#A68BE0', eye: '#7C5CD6', eyeDark: '#3E2A8A', blue: '#A9D8F5', blueEdge: '#8CC4E8' };

function Arm({ d, end }: { d: string; end: [number, number] }) {
  return (
    <g>
      <path d={d} stroke={C.creamEdge} strokeWidth={29} strokeLinecap="round" fill="none" />
      <path d={d} stroke={C.cream} strokeWidth={24} strokeLinecap="round" fill="none" />
      <path d={d} stroke="#FFFFFF" strokeWidth={5} strokeLinecap="round" fill="none" opacity={0.4} transform="translate(-4 -4)" />
      <circle cx={end[0]} cy={end[1]} r={4.5} fill={C.blush} opacity={0.75} />
    </g>
  );
}

function Sparkle({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return <path d="M0 -8 L2 -2 L8 0 L2 2 L0 8 L-2 2 L-8 0 L-2 -2Z" transform={`translate(${x} ${y}) scale(${s})`} fill="#FFD9A8" stroke="#F2B97A" strokeWidth={0.8} />;
}

const HEART = 'M0 9 C-14 -1 -8 -10 0 -3 C8 -10 14 -1 0 9Z';

export function MimiArt({ pose }: { pose: PoseName }) {
  const uid = useId().replace(/:/g, '');
  const eyes: 'open' | 'happy' | 'closed' = pose === 'happy' || pose === 'wave' || pose === 'stretch' ? 'happy' : pose === 'rest' ? 'closed' : 'open';
  const smile = pose === 'happy' || pose === 'wave' || pose === 'encourage' || pose === 'stretch';

  let arms: JSX.Element;
  switch (pose) {
    case 'happy':
      arms = (<><Arm d="M112 198 Q86 214 84 238" end={[84, 238]} /><Arm d="M188 198 Q214 214 216 238" end={[216, 238]} /></>);
      break;
    case 'wave':
      arms = (<><Arm d="M112 198 Q96 228 108 250" end={[108, 250]} /><g className="mimi-wave-arm"><Arm d="M188 198 Q226 180 232 128" end={[232, 128]} /></g></>);
      break;
    case 'drink':
      arms = (<><Arm d="M112 200 Q110 236 138 240" end={[138, 240]} /><Arm d="M188 200 Q190 236 162 240" end={[162, 240]} /></>);
      break;
    case 'stretch':
      arms = (<><Arm d="M112 198 Q60 170 52 112" end={[52, 112]} /><Arm d="M188 198 Q240 170 248 112" end={[248, 112]} /></>);
      break;
    case 'encourage':
      arms = (<><Arm d="M112 198 Q84 224 112 238" end={[112, 238]} /><Arm d="M188 198 Q226 190 226 150" end={[226, 150]} /></>);
      break;
    case 'rest':
      arms = (<><Arm d="M112 204 Q130 242 160 234" end={[160, 234]} /><Arm d="M188 204 Q170 242 140 234" end={[140, 234]} /></>);
      break;
    default:
      arms = (<><Arm d="M112 198 Q96 228 108 250" end={[108, 250]} /><Arm d="M188 198 Q204 228 192 250" end={[192, 250]} /></>);
  }

  const f = (n: string) => `url(#${uid}-${n})`;
  return (
    <svg viewBox="0 0 300 320" xmlns="http://www.w3.org/2000/svg" role="img" aria-label={`Mimi, ${pose} pose`} className="mimi-art">
      <defs>
        <radialGradient id={`${uid}-fur`} cx="36%" cy="26%" r="90%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="28%" stopColor="#FFF9F0" />
          <stop offset="68%" stopColor="#FFEBD4" />
          <stop offset="100%" stopColor="#EFD2B3" />
        </radialGradient>
        <radialGradient id={`${uid}-earin`} cx="50%" cy="70%" r="70%">
          <stop offset="0%" stopColor="#FFD3E2" />
          <stop offset="100%" stopColor="#F5A3C0" />
        </radialGradient>
        <radialGradient id={`${uid}-eye`} cx="50%" cy="30%" r="85%">
          <stop offset="0%" stopColor="#C2A8FF" />
          <stop offset="50%" stopColor="#7C5CD6" />
          <stop offset="100%" stopColor="#40279A" />
        </radialGradient>
        <linearGradient id={`${uid}-bow`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFD0E1" />
          <stop offset="100%" stopColor="#F083AB" />
        </linearGradient>
        <linearGradient id={`${uid}-collar`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#EADFFF" />
          <stop offset="100%" stopColor="#B093EA" />
        </linearGradient>
        <linearGradient id={`${uid}-charm`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFB3CC" />
          <stop offset="100%" stopColor="#EC6F9A" />
        </linearGradient>
        <filter id={`${uid}-soft`} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4" /></filter>
        <filter id={`${uid}-soft2`} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9" /></filter>
      </defs>

      {/* soft contact shadow */}
      <ellipse cx="150" cy="305" rx="84" ry="10" fill="#6B4FA8" opacity={0.22} filter={f('soft')} />

      {/* tail */}
      <g className="mimi-tail">
        <path d="M210 266 C262 266 276 212 250 196 C238 190 228 202 240 210" stroke="#EAD3B8" strokeWidth={24} strokeLinecap="round" fill="none" />
        <path d="M210 266 C262 266 276 212 250 196 C238 190 228 202 240 210" stroke={f('fur')} strokeWidth={19} strokeLinecap="round" fill="none" />
        <path d="M212 262 C255 260 268 218 250 202" stroke="#FFFFFF" strokeWidth={5} strokeLinecap="round" fill="none" opacity={0.6} />
      </g>

      {/* body */}
      <ellipse cx="150" cy="232" rx="68" ry="60" fill={f('fur')} stroke="#E7CFB3" strokeWidth={2} strokeOpacity={0.7} />
      <ellipse cx="150" cy="248" rx="40" ry="34" fill="#FFFBF5" opacity={0.9} filter={f('soft')} />
      <ellipse cx="112" cy="208" rx="22" ry="30" fill="#FFFFFF" opacity={0.55} filter={f('soft')} />
      <path d="M200 192 Q222 232 196 280" stroke="#E2BE98" strokeWidth={10} fill="none" opacity={0.35} filter={f('soft')} strokeLinecap="round" />
      <ellipse cx="150" cy="190" rx="60" ry="14" fill="#D9B48E" opacity={0.35} filter={f('soft')} />
      {[118, 182].map((x) => (
        <g key={x}>
          <ellipse cx={x} cy="288" rx="25" ry="14" fill={f('fur')} stroke="#E7CFB3" strokeWidth={2} strokeOpacity={0.7} />
          <ellipse cx={x - 4} cy="283" rx="11" ry="4" fill="#FFFFFF" opacity={0.6} filter={f('soft')} />
        </g>
      ))}

      {pose === 'drink' && (
        <g>
          <rect x="132" y="206" width="36" height="52" rx="8" fill="#EAF6FD" fillOpacity={0.9} stroke="#8CC4E8" strokeWidth={2.5} />
          <rect x="135" y="224" width="30" height="31" rx="6" fill="#A9D8F5" />
          <rect x="138" y="210" width="4" height="40" rx="2" fill="#FFFFFF" opacity={0.7} />
          <path d="M160 206 L171 182" stroke="#F28BB0" strokeWidth={4.5} strokeLinecap="round" />
        </g>
      )}

      {arms}

      {/* ears */}
      {[false, true].map((mirror) => (
        <g key={String(mirror)} transform={mirror ? 'translate(300 0) scale(-1 1)' : undefined}>
          <path d="M78 98 C70 66 74 42 88 36 C100 32 120 48 128 62 Z" fill={f('fur')} stroke="#E7CFB3" strokeWidth={2} strokeOpacity={0.7} strokeLinejoin="round" />
          <path d="M88 84 C84 66 86 53 92 49 C100 49 110 57 115 66 Z" fill={f('earin')} />
          <path d="M84 70 C82 56 86 46 91 41" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" fill="none" opacity={0.6} />
        </g>
      ))}

      {/* head */}
      <ellipse cx="150" cy="120" rx="80" ry="68" fill={f('fur')} stroke="#E7CFB3" strokeWidth={2} strokeOpacity={0.7} />
      <path d="M206 70 Q236 118 200 172" stroke="#E2BE98" strokeWidth={12} fill="none" opacity={0.3} filter={f('soft')} strokeLinecap="round" />
      <ellipse cx="116" cy="78" rx="38" ry="15" fill="#FFFFFF" opacity={0.75} filter={f('soft')} />

      {/* bow */}
      <g>
        <path d="M96 54 C72 34 60 58 76 72 C86 77 94 66 96 54Z" fill={f('bow')} stroke="#E27AA3" strokeWidth={2} strokeLinejoin="round" />
        <path d="M96 54 C120 38 130 60 116 74 C106 78 98 68 96 54Z" fill={f('bow')} stroke="#E27AA3" strokeWidth={2} strokeLinejoin="round" />
        <path d="M82 52 C76 54 74 60 77 64" stroke="#FFFFFF" strokeWidth={2.5} strokeLinecap="round" fill="none" opacity={0.7} />
        <circle cx="96" cy="57" r="7.5" fill={f('bow')} stroke="#E27AA3" strokeWidth={2} />
        <circle cx="94" cy="54.5" r="2.4" fill="#FFFFFF" opacity={0.8} />
      </g>

      {/* collar + charm */}
      <path d="M104 181 Q150 202 196 181" stroke="#9A7BDC" strokeWidth={15} strokeLinecap="round" fill="none" />
      <path d="M104 181 Q150 202 196 181" stroke={f('collar')} strokeWidth={11} strokeLinecap="round" fill="none" />
      <path d="M110 179 Q150 197 190 179" stroke="#FFFFFF" strokeWidth={2.5} strokeLinecap="round" fill="none" opacity={0.6} />
      <circle cx="150" cy="195" r="2.6" fill="#E9C46A" />
      <g transform="translate(150 209) scale(1.15)">
        <path d={HEART} fill={f('charm')} stroke="#FFFFFF" strokeWidth={1.6} strokeLinejoin="round" />
        <ellipse cx="-4.5" cy="-2.2" rx="3" ry="1.7" fill="#FFFFFF" opacity={0.85} transform="rotate(-30 -4.5 -2.2)" />
      </g>

      {/* face */}
      <ellipse cx="96" cy="144" rx="15" ry="9" fill="#F7A1BD" opacity={0.55} filter={f('soft')} />
      <ellipse cx="204" cy="144" rx="15" ry="9" fill="#F7A1BD" opacity={0.55} filter={f('soft')} />
      {eyes === 'open' && (
        <g className="mimi-eyes">
          {[118, 182].map((x) => (
            <g key={x}>
              <ellipse cx={x} cy="118" rx="17" ry="21" fill={f('eye')} />
              <ellipse cx={x} cy="122" rx="9.5" ry="12" fill="#2A1670" opacity={0.85} />
              <path d={`M${x - 15} 112 Q${x} 92 ${x + 15} 112`} stroke="#2A1670" strokeWidth={3} fill="none" opacity={0.45} strokeLinecap="round" />
              <ellipse cx={x} cy="132" rx="9" ry="4" fill="#C9B3FF" opacity={0.55} filter={f('soft')} />
              <ellipse cx={x + 5} cy="110" rx="6" ry="6.5" fill="#FFFFFF" />
              <circle cx={x - 6} cy="127" r="3" fill="#FFFFFF" opacity={0.95} />
              <circle cx={x + 9} cy="123" r="1.6" fill="#FFFFFF" opacity={0.8} />
            </g>
          ))}
        </g>
      )}
      {eyes === 'happy' && (
        <g stroke="#3E2A8A" strokeWidth={5.5} strokeLinecap="round" fill="none">
          <path d="M102 122 Q118 100 134 122" />
          <path d="M166 122 Q182 100 198 122" />
        </g>
      )}
      {eyes === 'closed' && (
        <g stroke="#3E2A8A" strokeWidth={5} strokeLinecap="round" fill="none">
          <path d="M103 118 Q118 131 133 118" />
          <path d="M167 118 Q182 131 197 118" />
        </g>
      )}
      <path d="M144 134 Q150 131 156 134 Q153 141 150 142 Q147 141 144 134Z" fill="#F28BA8" />
      <ellipse cx="148" cy="134.2" rx="2.2" ry="1" fill="#FFFFFF" opacity={0.8} />
      {smile ? (
        <>
          <path d="M139 147 Q150 163 161 147 Z" fill="#E4607F" stroke="#C94F73" strokeWidth={2} strokeLinejoin="round" />
          <path d="M145 155 Q150 159 155 155 Q150 151 145 155Z" fill="#FF9DB6" />
        </>
      ) : (
        <path d="M150 142 Q150 150 142 150 M150 142 Q150 150 158 150" stroke="#C94F73" strokeWidth={3} strokeLinecap="round" fill="none" />
      )}
      <g stroke="#E2C9AA" strokeWidth={2} strokeLinecap="round" opacity={0.9}>
        <path d="M84 134 L62 130" /><path d="M84 142 L62 146" />
        <path d="M216 134 L238 130" /><path d="M216 142 L238 146" />
      </g>

      {/* pose extras */}
      {pose === 'master' && (<><Sparkle x={52} y={70} /><Sparkle x={256} y={92} s={0.7} /></>)}
      {pose === 'encourage' && (
        <>
          <Sparkle x={252} y={118} s={0.9} />
          <Sparkle x={262} y={150} s={0.6} />
          <g className="mimi-float-heart"><path d={HEART} transform="translate(246 82) scale(0.9)" fill={f('charm')} /></g>
        </>
      )}
      {pose === 'stretch' && (
        <g stroke="#A68BE0" strokeWidth={3} strokeLinecap="round" opacity={0.7}>
          <path d="M34 130 L28 150" /><path d="M266 130 L272 150" />
        </g>
      )}
      {pose === 'rest' && (
        <g stroke="#A68BE0" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d="M224 50 H242 L224 68 H243" />
          <path d="M248 32 H260 L248 44 H261" opacity={0.8} strokeWidth={3.2} />
          <path d="M266 18 H274 L266 26 H275" opacity={0.6} strokeWidth={2.6} />
        </g>
      )}
    </svg>
  );
}
