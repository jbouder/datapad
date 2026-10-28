import { describe, expect, it } from 'vitest';
import { newId } from '#shared/ids';

describe('newId', () => {
  it('is 16 base-36 characters, different every time', () => {
    const ids = Array.from({ length: 2000 }, newId);
    for (const id of ids) expect(id).toMatch(/^[0-9a-z]{16}$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses every character about as often', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i += 1) {
      for (const c of newId()) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    expect(counts.size).toBe(36);
    // 64,000 draws: about 1,778 each. Modulo bias put 0-3 near 2,000.
    for (const n of counts.values()) {
      expect(n).toBeGreaterThan(1550);
      expect(n).toBeLessThan(2000);
    }
  });
});
