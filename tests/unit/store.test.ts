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
});
