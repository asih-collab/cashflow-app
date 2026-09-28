import { describe, expect, it } from 'vitest';
import { periodFor, inPeriod, toDateString } from '../../src/lib/period';

describe('periodFor（暦月）', () => {
  it('9 月 28 日 → 9/1〜9/30、残り 3 日', () => {
    const p = periodFor(new Date(2026, 8, 28), 1);
    expect(p).toMatchObject({ start: '2026-09-01', end: '2026-09-30', label: '9月', daysLeft: 3, totalDays: 30 });
  });
  it('2 月（うるう年でない）', () => {
    const p = periodFor(new Date(2026, 1, 10), 1);
    expect(p).toMatchObject({ start: '2026-02-01', end: '2026-02-28', totalDays: 28, daysLeft: 19 });
  });
  it('12 月 → 翌年 1 月をまたがない', () => {
    const p = periodFor(new Date(2026, 11, 31), 1);
    expect(p).toMatchObject({ start: '2026-12-01', end: '2026-12-31', daysLeft: 1 });
  });
});

describe('periodFor（給料日基準 25 日）', () => {
  it('9 月 28 日 → 9/25〜10/24', () => {
    const p = periodFor(new Date(2026, 8, 28), 25);
    expect(p).toMatchObject({ start: '2026-09-25', end: '2026-10-24', label: '9/25〜10/24', daysLeft: 27, totalDays: 30 });
  });
  it('9 月 10 日 → 8/25〜9/24', () => {
    const p = periodFor(new Date(2026, 8, 10), 25);
    expect(p).toMatchObject({ start: '2026-08-25', end: '2026-09-24', daysLeft: 15, totalDays: 31 });
  });
  it('1 月 3 日 → 前年 12/25〜1/24', () => {
    const p = periodFor(new Date(2027, 0, 3), 25);
    expect(p).toMatchObject({ start: '2026-12-25', end: '2027-01-24' });
  });
  it('開始日は 1〜28 に丸める', () => {
    expect(periodFor(new Date(2026, 8, 28), 31).start).toBe('2026-09-28');
    expect(periodFor(new Date(2026, 8, 28), 0).start).toBe('2026-09-01');
  });
});

describe('inPeriod / toDateString', () => {
  it('境界を含む', () => {
    const p = periodFor(new Date(2026, 8, 28), 1);
    expect(inPeriod('2026-09-01', p)).toBe(true);
    expect(inPeriod('2026-09-30', p)).toBe(true);
    expect(inPeriod('2026-08-31', p)).toBe(false);
    expect(inPeriod('2026-10-01', p)).toBe(false);
  });
  it('toDateString はゼロ埋め', () => {
    expect(toDateString(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
