import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { goalStatus, monthlyFor } from '../../src/lib/goal';
import { challengeAfter, challengeStatus, formatChallenge } from '../../src/lib/challenge';
import { preSpend } from '../../src/lib/preSpend';
import { seedCategories } from '../../src/lib/categories';
import { periodFor, shiftPeriod } from '../../src/lib/period';
import { Db } from '../../src/lib/db';
import { AppStore } from '../../src/lib/store';
import type { Budget, Challenge, Goal, RecurringRule, Transaction } from '../../src/lib/types';

const cats = seedCategories('x');
const id = (name: string) => cats.find((c) => c.name === name)!.id;
const GOAL_CAT = 'aaaaaaaa-0000-4000-8000-000000000001';
let n = 0;
const tx = (date: string, amount: number, category_id: string, extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`, date, amount, type: 'expense', category_id, payment_method_id: null, memo: '', source: 'manual', recurring_rule_id: null,
  created_at: 'x', updated_at: 'x', deleted_at: null, ...extra,
});
const rule = (amount: number, start = '2026-11', category_id = GOAL_CAT, extra: Partial<RecurringRule> = {}): RecurringRule => ({
  id: `r${++n}`, name: 'r', amount, type: 'expense', category_id, payment_method_id: null, day_of_month: 25, start_month: start, end_month: null,
  needs_review: false, is_active: true, sort_order: 0, created_at: 'x', updated_at: 'x', deleted_at: null, ...extra,
});
const goal = (p: Partial<Goal> = {}): Goal => ({
  id: 'g', name: '旅行資金', target: 1_000_000, category_id: GOAL_CAT, assets: [], extras: [], increases: [], is_active: true, sort_order: 0,
  created_at: 'x', updated_at: 'x', deleted_at: null, ...p,
});
const TODAY = new Date(2026, 9, 27);

describe('貯金の目標', () => {
  const bonus = ['2026-12', '2027-06', '2027-12'].map((month) => ({ month, amount: 100_000, done: false }));
  it('毎月 5 万円（先取り 2 本）とボーナスから 10 万 × 3 回 → 2027 年 12 月に 100 万円', () => {
    const s = goalStatus(goal({ extras: bonus }), [], [rule(20_000), rule(30_000)], TODAY);
    expect(s.total).toBe(0);
    expect(s.monthlyNow).toBe(0); // 先取りは 11 月から
    expect(s.reachMonth).toBe('2027-12');
    expect(s.monthsLeft).toBe(14);
    expect(s.nextExtra).toEqual({ month: '2026-12', amount: 100_000 });
  });
  it('当てにする資産（30 万円）を入れると 2027 年 8 月', () => {
    const s = goalStatus(goal({ extras: bonus, assets: [{ name: '預金', amount: 300_000 }] }), [], [rule(20_000), rule(30_000)], TODAY);
    expect(s.total).toBe(300_000);
    expect(s.reachMonth).toBe('2027-08');
  });
  it('入金した分（目標の中分類の記録）は貯まった額に入る。先の日付の記録は見込みにだけ入る', () => {
    const t = [tx('2026-10-20', 100_000, GOAL_CAT), tx('2026-10-30', 50_000, GOAL_CAT, { source: 'recurring' })];
    const s = goalStatus(goal({ target: 150_000 }), t, [], TODAY);
    expect(s.saved).toBe(100_000);
    expect(s.reachMonth).toBe('2026-10');
  });
  it('「◯月から毎月増やす」は、その月から見込みに入る', () => {
    const g = goal({ increases: [{ from: '2028-01', amount: 60_000 }] });
    expect(monthlyFor(g, [rule(30_000)], '2027-12')).toBe(30_000);
    expect(monthlyFor(g, [rule(30_000)], '2028-01')).toBe(90_000);
  });
  it('入金が少なすぎると 10 年以内には届かない', () => {
    expect(goalStatus(goal(), [], [rule(1_000)], TODAY).reachMonth).toBeNull();
  });
  it('見込みに一時金を足すと早まる（黒字を回したとき）', () => {
    const base = goalStatus(goal({ extras: bonus }), [], [rule(50_000)], TODAY).reachMonth!;
    const more = goalStatus(goal({ extras: bonus }), [], [rule(50_000)], TODAY, 200_000).reachMonth!;
    expect(more < base).toBe(true);
  });
});

describe('節約のチャレンジ', () => {
  const period = periodFor(TODAY, 25);
  const drink: Challenge = { id: 'c', name: '飲み会は月 2 回まで', kind: 'count', category_ids: [id('飲み会')], limit: 2, is_active: true, sort_order: 0, created_at: 'x', updated_at: 'x', deleted_at: null };
  const gamble: Challenge = { ...drink, id: 'c2', name: 'ギャンブルは月 1 万円まで', kind: 'amount', category_ids: [id('ゲーム')], limit: 10_000 };
  it('予算期間の中だけを数える', () => {
    const t = [tx('2026-10-24', 5000, id('飲み会')), tx('2026-10-26', 8000, id('飲み会')), tx('2026-10-27', 3000, id('ゲーム'))];
    expect(challengeStatus(drink, t, period).used).toBe(1);
    expect(formatChallenge(challengeStatus(gamble, t, period), 'amount')).toBe('¥3,000 / ¥10,000');
  });
  it('この記録を足したら（上限ちょうどは「上限」、超えたら「超過」）', () => {
    const t = [tx('2026-10-26', 8000, id('飲み会'))];
    const s = challengeAfter(drink, t, period, id('飲み会'), 5000)!;
    expect([s.used, s.reached, s.over]).toEqual([2, true, false]);
    expect(challengeAfter(drink, [...t, tx('2026-10-27', 1, id('飲み会'))], period, id('飲み会'), 5000)!.over).toBe(true);
    expect(challengeAfter(drink, t, period, id('外食'), 5000)).toBeNull();
  });
});

describe('使う前に見せる', () => {
  const period = periodFor(TODAY, 25);
  const budgets: Budget[] = [{ id: 'b', period_start: '2026-10-25', category_id: id('交際費'), amount: 55_000, created_at: 'x', updated_at: 'x', deleted_at: null }];
  const salary = rule(540_000, '2026-10', id('給与'), { type: 'income' });
  it('予算の残り（前 → 後）・今日の目安・チャレンジ・手取りで何時間分', () => {
    const drink: Challenge = { id: 'c', name: '飲み会', kind: 'count', category_ids: [id('飲み会')], limit: 2, is_active: true, sort_order: 0, created_at: 'x', updated_at: 'x', deleted_at: null };
    const ps = preSpend({
      transactions: [tx('2026-10-26', 10_000, id('飲み会'))], categories: cats, budgets, challenges: [drink], rules: [salary],
      period, prev: shiftPeriod(period, 1, 25), today: TODAY, categoryId: id('飲み会'), amount: 6_750, date: '2026-10-27',
    });
    expect(ps.budget).toEqual({ name: '交際費', before: 45_000, after: 38_250 });
    expect(ps.allowanceLeft).toBe(Math.floor(45_000 / 29) - 6_750);
    expect(ps.challenges[0]).toMatchObject({ text: '2 / 2 回', reached: true, over: false });
    expect(ps.hours).toBe(2); // 540,000 ÷ 160 = 3,375 円/時
  });
  it('固定費・収入・3,000 円未満では「何時間分」を出さない', () => {
    const base = { transactions: [], categories: cats, budgets, challenges: [], rules: [salary], period, prev: shiftPeriod(period, 1, 25), today: TODAY, date: '2026-10-27' };
    expect(preSpend({ ...base, categoryId: id('家賃'), amount: 130_000 }).hours).toBeNull();
    expect(preSpend({ ...base, categoryId: id('カフェ'), amount: 500 }).hours).toBeNull();
  });
});

describe('ストア: 目標とチャレンジ', () => {
  it('目標を作ると「貯蓄・投資」の下に中分類と、来月からの先取りの自動記録ができる。予定の入金を「入金した」で記録', async () => {
    const s = new AppStore(new Db(new IDBFactory(), 'goal'));
    await s.init();
    const g = await s.createGoal({ name: '旅行資金', target: 1_000_000, monthly: 20_000 });
    const cat = s.categories.find((c) => c.id === g.category_id)!;
    expect(cat.name).toBe('旅行資金');
    expect(cat.parent_id).toBe('11111111-0014-4000-8000-000000000000');
    expect(cat.kind).toBe('fixed');
    const r = s.goalRules(g);
    expect(r).toHaveLength(1);
    expect(r[0]!.amount).toBe(20_000);
    expect(r[0]!.start_month > new Date().toISOString().slice(0, 7)).toBe(true);
    // 今月分は記録されない（来月から）
    expect(s.liveTransactions.filter((t) => t.category_id === g.category_id)).toHaveLength(0);
    const month = new Date().toISOString().slice(0, 7);
    await s.updateGoal(g.id, { extras: [{ month, amount: 100_000, done: false }] });
    expect(s.dueGoalExtras()).toHaveLength(1);
    await s.completeGoalExtra(g.id, month);
    expect(s.dueGoalExtras()).toHaveLength(0);
    expect(s.liveTransactions.find((t) => t.category_id === g.category_id)?.amount).toBe(100_000);
    const c = await s.saveChallenge({ name: '飲み会', kind: 'count', category_ids: [id('飲み会')], limit: 2 });
    expect(s.activeChallenges.map((x) => x.id)).toEqual([c.id]);
    await s.deleteChallenge(c.id);
    expect(s.activeChallenges).toHaveLength(0);
  });
});
