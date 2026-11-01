export const POSES = ['master', 'idle', 'happy', 'wave', 'drink', 'stretch', 'encourage', 'rest'] as const;
export type PoseName = (typeof POSES)[number];

export const POSE_LABELS: Record<PoseName, string> = {
  master: 'Mimi, front-facing',
  idle: 'Mimi relaxing',
  happy: 'Mimi smiling happily',
  wave: 'Mimi waving hello',
  drink: 'Mimi drinking water',
  stretch: 'Mimi stretching',
  encourage: 'Mimi cheering you on',
  rest: 'Mimi resting',
};
