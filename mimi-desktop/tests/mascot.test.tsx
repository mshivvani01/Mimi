import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Mascot } from '../src/components/Mascot';
import { POSES } from '../src/mascot/poses';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import manifest from '../src/assets/mascot-manifest.json';

describe('Mascot', () => {
  it.each(POSES)('renders the %s pose with a local fallback', (pose) => {
    const { container } = render(<Mascot pose={pose} size={120} />);
    const root = container.querySelector('.mascot') as HTMLElement;
    expect(root.dataset.pose).toBe(pose);
    expect(root.querySelector('svg, img')).not.toBeNull();
    expect(root.style.width).toBe('120px');
  });

  it('does not animate when animated=false', () => {
    const { container } = render(<Mascot animated={false} />);
    expect(container.querySelector('.mascot--animated')).toBeNull();
  });

  it('manifest lists every pose and matches the PNG files that actually exist', () => {
    expect(Object.keys(manifest.poses).sort()).toEqual([...POSES].sort());
    for (const entry of Object.values(manifest.poses) as { file: string; png: boolean; width: number; height: number }[]) {
      const file = path.resolve(__dirname, '../src/assets/mascot', entry.file);
      expect(existsSync(file)).toBe(entry.png);
      if (entry.png) {
        const buf = readFileSync(file);
        expect(buf.subarray(1, 4).toString()).toBe('PNG');
        expect(buf.readUInt32BE(16)).toBe(entry.width);
        expect(buf.readUInt32BE(20)).toBe(entry.height);
        expect(buf[25]).toBe(6); // color type 6 = RGBA (real alpha channel)
      }
    }
  });

  it('uses the bundled PNG when one exists', () => {
    const { container } = render(<Mascot pose="wave" />);
    expect((container.querySelector('.mascot') as HTMLElement).dataset.source).toBe('png');
  });
});
