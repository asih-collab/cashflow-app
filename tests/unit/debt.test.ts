import { describe, expect, it } from 'vitest';
import { daysSinceBalance, debtOverview, debtPlan, monthLabel, monthlyInterest, planDebt, totalPlan } from '../../src/lib/debt';
import type { Debt } from '../../src/lib/types';

const T = '2026-10-24T00:00:00.000Z';
function debt(p: Partial<Debt>): Debt {
  return { id: p.name ?? 'x', name: 'x', balance: 0, balance_date: '2026-10-24', monthly_payment: 0, annual_rate: 15, history: [], is_active: true, sort_order: 0, created_at: T, updated_at: T, deleted_at: null, ...p };
}

describe('リボ・分割の返済計画（F08）', () => {
  it('手数料は 残高 × 年率 ÷ 12（円未満は四捨五入）', () => {
    expect(monthlyInterest(120000, 15)).toBe(1500);
    expect(monthlyInterest(100000, 0)).toBe(0);
  });
  it('手数料 0 なら 残高 ÷ 返済額 の月数で終わり、確認した月の翌月から返す', () => {
    const p = planDebt(100000, 10000, 0, '2026-10');
    expect(p.months).toBe(10);
    expect(p.payoffMonth).toBe('2027-08');
    expect(p.totalInterest).toBe(0);
    expect(p.schedule[0]).toEqual({ month: '2026-10', balance: 100000 });
    expect(p.schedule.at(-1)).toEqual({ month: '2027-08', balance: 0 });
  });
  it('手数料があると月数が延び、手数料の合計が出る', () => {
    const p = planDebt(100000, 10000, 15, '2026-10');
    expect(p.months).toBe(11);
    expect(p.totalInterest).toBeGreaterThan(6000);
    expect(p.totalInterest).toBeLessThan(8000);
  });
  it('返済額が手数料以下なら終わらない（null）', () => {
    expect(planDebt(1000000, 12500, 15, '2026-10').months).toBeNull();
    expect(planDebt(1000000, 10000, 15, '2026-10').payoffMonth).toBeNull();
  });
  it('残高 0 なら完済済み', () => {
    expect(planDebt(0, 10000, 15, '2026-10').months).toBe(0);
  });
  it('debtPlan は残高を確認した月を起点にする', () => {
    expect(debtPlan(debt({ balance: 30000, monthly_payment: 10000, annual_rate: 0, balance_date: '2026-09-30' })).payoffMonth).toBe('2026-12');
  });
});

describe('合計の推移と上乗せ', () => {
  const a = debt({ name: 'A', balance: 300000, monthly_payment: 30000, annual_rate: 15 });
  const b = debt({ name: 'B', balance: 200000, monthly_payment: 20000, annual_rate: 18 });
  it('上乗せなしは、それぞれの計画の長い方で終わる', () => {
    const t = totalPlan([a, b]);
    expect(t.payoffMonth).toBe([debtPlan(a).payoffMonth!, debtPlan(b).payoffMonth!].sort().at(-1));
    expect(t.totalInterest).toBe(debtPlan(a).totalInterest + debtPlan(b).totalInterest);
    expect(t.schedule[0]!.balance).toBe(500000);
  });
  it('上乗せすると早く終わり、手数料が減る', () => {
    const base = totalPlan([a, b]);
    const more = totalPlan([a, b], 10000);
    expect(more.months!).toBeLessThan(base.months!);
    expect(more.totalInterest).toBeLessThan(base.totalInterest);
  });
  it('上乗せは年率の高い方から返す（同じ上乗せでも逆順より手数料が少ない）', () => {
    const highFirst = totalPlan([a, b], 10000).totalInterest;
    const lowFirst = totalPlan([debt({ ...a, annual_rate: 18 }), debt({ ...b, annual_rate: 15 })], 10000).totalInterest;
    // 残高の大きい A を高金利にすると、A を先に返す計算になる。どちらも上乗せなしより少ない
    expect(highFirst).toBeLessThan(totalPlan([a, b]).totalInterest);
    expect(lowFirst).toBeLessThan(totalPlan([debt({ ...a, annual_rate: 18 }), debt({ ...b, annual_rate: 15 })]).totalInterest);
  });
  it('どれかが手数料に追いつかないと、上乗せなしでは終わらない', () => {
    expect(totalPlan([a, debt({ name: 'C', balance: 1000000, monthly_payment: 5000 })]).months).toBeNull();
  });
  it('削除・停止したものは数えない。登録がなければ空', () => {
    expect(totalPlan([debt({ ...a, deleted_at: T })]).schedule).toEqual([]);
  });
});

describe('表示用', () => {
  it('monthLabel', () => expect(monthLabel('2027-03')).toBe('2027年3月'));
  it('daysSinceBalance', () => expect(daysSinceBalance(debt({ balance_date: '2026-09-20' }), new Date(2026, 9, 25))).toBe(35));
});

describe('まとめ（ホーム・サマリ用）', () => {
  it('合計・毎月の返済・そのうちの手数料と元金・年の手数料', () => {
    const o = debtOverview([
      debt({ name: 'A', balance: 120000, monthly_payment: 10000 }),
      debt({ name: 'B', balance: 240000, monthly_payment: 20000, history: [{ date: '2026-09-25', balance: 260000 }, { date: '2026-10-24', balance: 240000 }] }),
    ])!;
    expect(o.total).toBe(360000);
    expect(o.monthly).toBe(30000);
    expect(o.interestNow).toBe(1500 + 3000);
    expect(o.principalNow).toBe(25500);
    expect(o.yearlyFee).toBe(54000);
    expect(o.payoffMonth).toBeTruthy();
    expect(o.changeSinceLast).toBe(-20000);
  });
  it('登録がなければ null。手数料が返済額を超えても元金はマイナスにしない', () => {
    expect(debtOverview([])).toBeNull();
    const o = debtOverview([debt({ balance: 1000000, monthly_payment: 5000 })])!;
    expect(o.principalNow).toBe(0);
    expect(o.totalInterest).toBeNull();
  });
});

describe('一括返済の予定（ボーナスなど）', () => {
  it('予定の月の返済のあとに残高から引き、完済が早まり手数料が減る', () => {
    const without = planDebt(300000, 30000, 15, '2026-10');
    const withLump = planDebt(300000, 30000, 15, '2026-10', [{ month: '2026-12', amount: 100000 }]);
    expect(withLump.months!).toBeLessThan(without.months!);
    expect(withLump.totalInterest).toBeLessThan(without.totalInterest);
    // 11 月は通常どおり、12 月に 10 万円減る
    const nov = withLump.schedule.find((p) => p.month === '2026-11')!.balance;
    const dec = withLump.schedule.find((p) => p.month === '2026-12')!.balance;
    expect(nov - dec).toBe(30000 - monthlyInterest(nov, 15) + 100000);
  });
  it('返済額が手数料以下でも、一括返済で終わる場合がある。済んだ予定は数えない', () => {
    expect(planDebt(100000, 1000, 15, '2026-10', [{ month: '2026-11', amount: 101000 }]).months).toBe(1);
    expect(planDebt(100000, 1000, 15, '2026-10', [{ month: '2026-11', amount: 100000 }]).months).toBe(2); // 手数料 1,250 の分が翌月に残る
    const d = debt({ balance: 100000, monthly_payment: 10000, annual_rate: 0, balance_date: '2026-10-25', lumps: [{ month: '2026-12', amount: 50000, done: true }] });
    expect(debtPlan(d).months).toBe(10);
  });
  it('起点より前の月で済んでいない予定は、最初の月に引く', () => {
    expect(planDebt(100000, 10000, 0, '2026-10', [{ month: '2026-09', amount: 50000 }]).months).toBe(5);
  });
  it('合計の推移にも入る。withLumps = false で「しなかった場合」', () => {
    const a = debt({ name: 'A', balance: 900000, monthly_payment: 30000, balance_date: '2026-10-25', lumps: [{ month: '2026-12', amount: 300000, done: false }] });
    const b = debt({ name: 'B', balance: 550000, monthly_payment: 20000, balance_date: '2026-10-25' });
    const withLump = totalPlan([a, b]);
    const without = totalPlan([a, b], 0, false);
    expect(withLump.months!).toBeLessThan(without.months!);
    expect(withLump.totalInterest).toBeLessThan(without.totalInterest);
  });
});
