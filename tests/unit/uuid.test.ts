import { describe, expect, it } from 'vitest';
import { nowIso, uuid } from '../../src/lib/uuid';

describe('uuid / nowIso', () => {
  it('uuid は v4 形式で重複しない', () => {
    const ids = new Set(Array.from({ length: 200 }, () => uuid()));
    expect(ids.size).toBe(200);
    expect([...ids][0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('nowIso は連続して呼んでも必ず増える', () => {
    const a = nowIso();
    const b = nowIso();
    const c = nowIso();
    expect(b > a).toBe(true);
    expect(c > b).toBe(true);
  });
});
