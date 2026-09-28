import { describe, expect, it } from 'vitest';
import { yen, group } from '../../src/lib/money';

describe('yen', () => {
  it('桁区切り', () => {
    expect(yen(0)).toBe('¥0');
    expect(yen(1200)).toBe('¥1,200');
    expect(yen(1234567)).toBe('¥1,234,567');
  });
  it('負数', () => {
    expect(yen(-1200)).toBe('-¥1,200');
  });
  it('小数は切り捨て（整数円で扱う）', () => {
    expect(yen(99.9)).toBe('¥99');
    expect(group(1000.5)).toBe('1,000');
  });
});
