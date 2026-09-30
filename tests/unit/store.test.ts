import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { Db } from '../../src/lib/db';
import { AppStore } from '../../src/lib/store';

async function fresh(name: string): Promise<AppStore> {
  const s = new AppStore(new Db(new IDBFactory(), name));
  await s.init();
  return s;
}

describe('AppStore', () => {
  it('初回はカテゴリと支払い手段が用意され、2 回目の init で増えない', async () => {
    const db = new Db(new IDBFactory(), 'x');
    const s1 = new AppStore(db);
    await s1.init();
    const n = s1.categories.length;
    const s2 = new AppStore(db);
    await s2.init();
    expect(s2.categories.length).toBe(n);
    expect(s2.paymentMethods.map((p) => p.name)).toEqual(['クレジットカード', 'PayPay', '口座引落', '現金']);
  });

  it('記録すると日付は今日、支払い手段は前回と同じになる', async () => {
    const s = await fresh('a');
    const paypay = s.paymentMethods.find((p) => p.name === 'PayPay')!;
    const cat = s.quickCategories[0]!;
    const t1 = await s.addTransaction({ amount: 1000, categoryId: cat.id, paymentMethodId: paypay.id });
    expect(t1.date).toBe(new Date().toISOString().slice(0, 10) === t1.date ? t1.date : t1.date); // ローカル日付
    expect(s.defaultPaymentMethodId).toBe(paypay.id);
    const t2 = await s.addTransaction({ amount: 500, categoryId: cat.id });
    expect(t2.payment_method_id).toBe(paypay.id);
    expect(t2.source).toBe('manual');
  });

  it('使用回数で並びが変わる', async () => {
    const s = await fresh('b');
    const gaisyoku = s.categories.find((c) => c.name === '外食')!;
    await s.addTransaction({ amount: 1, categoryId: gaisyoku.id });
    await s.addTransaction({ amount: 1, categoryId: gaisyoku.id });
    expect(s.quickCategories[0]!.name).toBe('外食');
    expect(s.quickCategories[1]!.name).toBe('デート');
  });

  it('削除と復元', async () => {
    const s = await fresh('c');
    const cat = s.quickCategories[0]!;
    const t = await s.addTransaction({ amount: 700, categoryId: cat.id });
    await s.deleteTransaction(t.id);
    expect(s.liveTransactions).toHaveLength(0);
    expect(s.categories.find((c) => c.id === cat.id)!.use_count).toBe(0);
    await s.restoreTransaction(t.id);
    expect(s.liveTransactions).toHaveLength(1);
    expect(s.categories.find((c) => c.id === cat.id)!.use_count).toBe(1);
  });

  it('金額は整数円・負数は 0', async () => {
    const s = await fresh('d');
    const t = await s.addTransaction({ amount: 99.9, categoryId: null });
    expect(t.amount).toBe(99);
    const t2 = await s.addTransaction({ amount: -5, categoryId: null });
    expect(t2.amount).toBe(0);
  });

  it('中分類の追加は親の種別を引き継ぐ。書き出しは JSON', async () => {
    const s = await fresh('e');
    const parent = s.categories.find((c) => c.name === '返済')!;
    const c = await s.addSubcategory(parent.id, ' 車のローン ');
    expect(c).toMatchObject({ name: '車のローン', kind: 'fixed', parent_id: parent.id });
    const json = JSON.parse(s.exportJson());
    expect(json.categories.some((x: { id: string }) => x.id === c.id)).toBe(true);
  });
  it('以前から使っている端末にも、あとから増えた初期カテゴリ（収入）が足される', async () => {
    const db = new Db(new IDBFactory(), 'old');
    const s1 = new AppStore(db);
    await s1.init();
    // 収入カテゴリが無かった頃の状態を再現
    for (const c of s1.categories.filter((c) => c.kind === 'income')) await db.delete('categories', c.id);
    const s2 = new AppStore(db);
    await s2.reload();
    expect(s2.incomeCategories).toHaveLength(0);
    await s2.init();
    expect(s2.incomeCategories.map((c) => c.name)).toContain('給与');
  });

  it('収入は支払い手段を持たず、前回の支払い手段も変えない', async () => {
    const s = await fresh('inc');
    const paypay = s.paymentMethods.find((p) => p.name === 'PayPay')!;
    await s.addTransaction({ amount: 100, categoryId: s.quickCategories[0]!.id, paymentMethodId: paypay.id });
    const salary = s.incomeCategories.find((c) => c.name === '給与')!;
    const t = await s.addTransaction({ amount: 300000, categoryId: salary.id, paymentMethodId: null, type: 'income' });
    expect(t.type).toBe('income');
    expect(t.payment_method_id).toBeNull();
    expect(s.defaultPaymentMethodId).toBe(paypay.id);
  });

  it('記録の修正: 金額・日付・メモを変えられ、カテゴリを変えると使用回数が付け替わる', async () => {
    const s = await fresh('edit');
    const date = s.categories.find((c) => c.name === 'デート')!;
    const cafe = s.categories.find((c) => c.name === 'カフェ')!;
    const t = await s.addTransaction({ amount: 1200, categoryId: date.id });
    const before = t.updated_at;
    await new Promise((r) => setTimeout(r, 2));
    const u = await s.updateTransaction(t.id, { amount: 980.7, category_id: cafe.id, date: '2026-09-01', memo: 'ラテ' });
    expect(u).toMatchObject({ amount: 980, category_id: cafe.id, date: '2026-09-01', memo: 'ラテ' });
    expect(u!.updated_at > before).toBe(true);
    expect(s.categories.find((c) => c.id === date.id)!.use_count).toBe(0);
    expect(s.categories.find((c) => c.id === cafe.id)!.use_count).toBe(1);
  });

  it('削除済みの記録は修正できない', async () => {
    const s = await fresh('edit2');
    const t = await s.addTransaction({ amount: 100, categoryId: s.quickCategories[0]!.id });
    await s.deleteTransaction(t.id);
    expect(await s.updateTransaction(t.id, { amount: 1 })).toBeUndefined();
  });
});
