import { describe, expect, it } from 'vitest';
import { decodeHandoff, encodeHandoff } from '../../src/lib/handoff';

describe('ログイン情報の引き継ぎ文字列', () => {
  const s = { access_token: 'a.b.c', refresh_token: 'rt-123', expires_at: 1900000000, user: { id: 'u1', email: 'a@example.com' } };
  it('往復できる', () => {
    const t = encodeHandoff(s);
    expect(t.startsWith('cf1.')).toBe(true);
    expect(t).not.toContain('+');
    expect(decodeHandoff(t)).toEqual(s);
    expect(decodeHandoff('  ' + t + '\n')).toEqual(s);
  });
  it('壊れた入力は null', () => {
    expect(decodeHandoff('hello')).toBeNull();
    expect(decodeHandoff('cf1.@@@')).toBeNull();
    expect(decodeHandoff('')).toBeNull();
  });
});
