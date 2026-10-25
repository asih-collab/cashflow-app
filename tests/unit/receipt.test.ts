import { describe, expect, it } from 'vitest';
import { findDate, normalize, parseReceipt } from '../../src/lib/receipt';
import { SAMPLES, TODAY } from './receipts.corpus';

describe('レシートの読み取り: サンプル全体の成功率', () => {
  const results = SAMPLES.map((s) => ({ s, r: parseReceipt(s.text, TODAY) }));
  const rate = (ok: number) => Math.round((ok / SAMPLES.length) * 1000) / 10;
  const totalOk = results.filter(({ s, r }) => r.total === s.total).length;
  const dateOk = results.filter(({ s, r }) => r.date === s.date).length;
  const withStore = results.filter(({ s }) => s.store);
  const storeOk = withStore.filter(({ s, r }) => r.store === s.store).length;
  const withPay = results.filter(({ s }) => s.payment !== undefined);
  const payOk = withPay.filter(({ s, r }) => r.payment === s.payment).length;

  it(`合計金額: ${SAMPLES.length} 件中の正解率（目標 95% 以上）`, () => {
    const wrong = results.filter(({ s, r }) => r.total !== s.total).map(({ s, r }) => `${s.name}: ${r.total} (期待 ${s.total}) 候補 ${r.candidates.join(',')}`);
    expect(wrong, wrong.join('\n')).toEqual([]);
    expect(rate(totalOk)).toBeGreaterThanOrEqual(95);
  });
  it('日付の正解率（目標 95% 以上）', () => {
    const wrong = results.filter(({ s, r }) => r.date !== s.date).map(({ s, r }) => `${s.name}: ${r.date} (期待 ${s.date})`);
    expect(wrong, wrong.join('\n')).toEqual([]);
    expect(rate(dateOk)).toBeGreaterThanOrEqual(95);
  });
  it('お店の名前の正解率（目標 90% 以上）', () => {
    const wrong = withStore.filter(({ s, r }) => r.store !== s.store).map(({ s, r }) => `${s.name}: ${r.store} (期待 ${s.store})`);
    expect(storeOk / withStore.length, wrong.join('\n')).toBeGreaterThanOrEqual(0.9);
  });
  it('支払い方法の正解率（目標 90% 以上）', () => {
    const wrong = withPay.filter(({ s, r }) => r.payment !== s.payment).map(({ s, r }) => `${s.name}: ${r.payment} (期待 ${s.payment})`);
    expect(payOk / withPay.length, wrong.join('\n')).toBeGreaterThanOrEqual(0.9);
  });
  it('合計が当たったものは、確からしさが low にならない（low は見直しを促す表示）', () => {
    const lowButRight = results.filter(({ s, r }) => r.total === s.total && r.confidence === 'low').map(({ s }) => s.name);
    expect(lowButRight.length / SAMPLES.length).toBeLessThan(0.15);
  });
});

describe('レシートの読み取り: 部品', () => {
  it('読み違いをそろえる', () => {
    expect(normalize('合計　￥１，２３４')).toBe('合計 ¥1,234');
    expect(normalize('\\5OO')).toBe('¥500');
    expect(normalize('¥1, 234')).toBe('¥1,234');
  });
  it('日付: 未来すぎる日付や存在しない日付は使わない', () => {
    expect(findDate('2027/12/31', TODAY)).toBeNull();
    expect(findDate('2026/02/30', TODAY)).toBeNull();
    expect(findDate('2026/10/26', TODAY)).toBe('2026-10-26'); // 翌日までは許す（時差・日付の変わり目）
  });
  it('何も読めない文字でも落ちない', () => {
    const r = parseReceipt('ありがとうございました', TODAY);
    expect(r.total).toBeNull();
    expect(r.confidence).toBe('low');
    expect(parseReceipt('', TODAY).total).toBeNull();
  });
});

/** 列が分かれた形に作り替える: 各行の末尾の金額を外し、金額を同じ順で後ろにまとめる（iPhone の文字認識で起きやすい形） */
function columnSplit(text: string): string {
  const labels: string[] = [];
  const amounts: string[] = [];
  for (const line of text.split('\n')) {
    const m = /^(.*?\S)\s+((?:¥|\\\\|￥)?\s?[\d,，.０-９]+(?:円|-)?)$/.exec(line);
    if (m && !/\d{4}[/年.-]|\d{1,2}:\d{2}|TEL|電話|T\d{13}/.test(line)) { labels.push(m[1]!); amounts.push(m[2]!); } else labels.push(line);
  }
  return [...labels, ...amounts].join('\n');
}
/** 文字認識の読み違いをまねる: ¥ を \ に、カンマの後に空白、全角数字 */
function noisy(text: string, i: number): string {
  if (i % 3 === 0) return text.replace(/¥/g, '\\');
  if (i % 3 === 1) return text.replace(/,(\d{3})/g, ', $1');
  return text.replace(/\d/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xfee0));
}

describe('レシートの読み取り: 作り替えたサンプルでの頑健さ', () => {
  it('列が分かれた形に作り替えても、合計金額の正解率 90% 以上', () => {
    const res = SAMPLES.map((s) => ({ s, r: parseReceipt(columnSplit(s.text), TODAY) }));
    const ok = res.filter(({ s, r }) => r.total === s.total).length;
    const wrong = res.filter(({ s, r }) => r.total !== s.total).map(({ s, r }) => `${s.name}: ${r.total} (期待 ${s.total})`);
    expect(ok / SAMPLES.length, `${ok}/${SAMPLES.length}\n${wrong.join('\n')}`).toBeGreaterThanOrEqual(0.9);
  });
  it('読み違いを混ぜても、合計金額と日付の正解率 95% 以上', () => {
    const res = SAMPLES.map((s, i) => ({ s, r: parseReceipt(noisy(s.text, i), TODAY) }));
    const ok = res.filter(({ s, r }) => r.total === s.total && r.date === s.date).length;
    const wrong = res.filter(({ s, r }) => r.total !== s.total || r.date !== s.date).map(({ s, r }) => `${s.name}: ${r.total} ${r.date}`);
    expect(ok / SAMPLES.length, `${ok}/${SAMPLES.length}\n${wrong.join('\n')}`).toBeGreaterThanOrEqual(0.95);
  });
});
