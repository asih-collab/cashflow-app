import { describe, expect, it } from 'vitest';
import { guessCategory, guessPaymentMethod } from '../../src/lib/receiptGuess';
import { seedCategories } from '../../src/lib/categories';
import type { PaymentMethod, Transaction } from '../../src/lib/types';

const cats = seedCategories('x');
const name = (id: string | undefined) => cats.find((c) => c.id === id)?.name;
const pm = (id: string, n: string, type: PaymentMethod['type']): PaymentMethod => ({ id, name: n, type, withdrawal_day: null, closing_day: null, sort_order: 0, is_active: true, created_at: 'x', updated_at: 'x', deleted_at: null });

describe('レシート: カテゴリと支払い手段の推測', () => {
  it('お店の種類から中分類を推測する', () => {
    expect(name(guessCategory('セブン-イレブン', '', cats, [])?.id)).toBe('コンビニ');
    expect(name(guessCategory('スターバックス', '', cats, [])?.id)).toBe('カフェ');
    expect(name(guessCategory('すき家', '', cats, [])?.id)).toBe('外食');
    expect(name(guessCategory('まいばすけっと', '', cats, [])?.id)).toBe('食料品');
    expect(name(guessCategory('マツモトキヨシ', '', cats, [])?.id)).toBe('日用雑貨');
    expect(name(guessCategory(null, '領収書\n運賃 ¥2,300', cats, [])?.id)).toBe('タクシー');
    expect(guessCategory('謎の店', '', cats, [])).toBeNull();
  });
  it('同じお店で前に記録したカテゴリを優先する（覚える）', () => {
    const date = cats.find((c) => c.name === 'デート')!;
    const past: Transaction = { id: 't', date: '2026-10-01', amount: 3000, type: 'expense', category_id: date.id, payment_method_id: null, memo: 'スターバックス', source: 'receipt', recurring_rule_id: null, created_at: '2026-10-01T00:00:00Z', updated_at: 'x', deleted_at: null };
    expect(name(guessCategory('スターバックス', '', cats, [past])?.id)).toBe('デート');
  });
  it('支払い方法を、この人の支払い手段に当てはめる', () => {
    const methods = [pm('c', 'クレジットカード', 'card'), pm('p', 'PayPay', 'qr'), pm('s', 'Suica', 'card'), pm('m', '現金', 'cash')];
    expect(guessPaymentMethod('card', methods)?.id).toBe('c');
    expect(guessPaymentMethod('paypay', methods)?.id).toBe('p');
    expect(guessPaymentMethod('ic', methods)?.id).toBe('s');
    expect(guessPaymentMethod('cash', methods)?.id).toBe('m');
    expect(guessPaymentMethod(null, methods)).toBeNull();
  });
});
