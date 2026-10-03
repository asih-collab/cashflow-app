// アプリのデータ層。画面はここだけを通してデータを読み書きする。

import type { Db } from './db';
import { seedCategories, orderedSubcategories, incomeSubcategories } from './categories';
import { nowIso, uuid } from './uuid';
import { toDateString } from './period';
import type { Budget, Category, PaymentMethod, PaymentMethodType, RecurringRule, Settings, SyncTable, Transaction } from './types';
import { dueRecurringTransactions, monthKey, postingDate } from './recurring';
import { budgetId } from './budget';
import type { Syncer } from './sync';

export interface NewTransaction {
  amount: number;
  categoryId: string | null;
  date?: string;
  paymentMethodId?: string | null;
  memo?: string;
  source?: Transaction['source'];
  type?: Transaction['type'];
}

/** 初期データ（カテゴリ・支払い手段）に付ける固定の時刻 */
export const SEED_TS = '2000-01-01T00:00:00.000Z';

const DEFAULT_SETTINGS: Settings = {
  month_start_day: 1,
  last_payment_method_id: null,
  start_screen: 'add',
  save_on_category_tap: false,
  updated_at: '1970-01-01T00:00:00.000Z',
};

export function seedPaymentMethods(now: string): PaymentMethod[] {
  const mk = (id: string, name: string, type: PaymentMethodType, sort_order: number): PaymentMethod => ({
    id, name, type, withdrawal_day: null, closing_day: null, sort_order, is_active: true, created_at: now, updated_at: now, deleted_at: null,
  });
  return [
    mk('22222222-0001-4000-8000-000000000001', 'クレジットカード', 'card', 0),
    mk('22222222-0001-4000-8000-000000000002', 'PayPay', 'qr', 1),
    mk('22222222-0001-4000-8000-000000000003', '口座引落', 'bank', 2),
    mk('22222222-0001-4000-8000-000000000004', '現金', 'cash', 3),
  ];
}

export class AppStore {
  categories: Category[] = [];
  paymentMethods: PaymentMethod[] = [];
  transactions: Transaction[] = [];
  recurringRules: RecurringRule[] = [];
  budgets: Budget[] = [];
  settings: Settings = { ...DEFAULT_SETTINGS };
  private listeners = new Set<() => void>();
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly db: Db, private syncer: Syncer | null = null) {}

  attachSyncer(s: Syncer): void {
    this.syncer = s;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  async init(): Promise<void> {
    await this.reload();
    // 初期データの時刻は固定の古い値にする。別の端末で先に使っていた場合、そちらの変更（使用回数など）が必ず勝つようにするため
    const now = SEED_TS;
    // 初期セットのうち、まだ持っていないものを足す（あとから追加した初期カテゴリ、例: 収入 にも対応）
    const have = new Set(this.categories.map((c) => c.id));
    const missing = seedCategories(now).filter((c) => !have.has(c.id));
    if (missing.length > 0) {
      await this.db.putMany('categories', missing);
      for (const c of missing) await this.syncer?.markDirty('categories', c.id, c.updated_at);
    }
    if (this.paymentMethods.length === 0) {
      const seeds = seedPaymentMethods(now);
      await this.db.putMany('payment_methods', seeds);
      for (const p of seeds) await this.syncer?.markDirty('payment_methods', p.id, p.updated_at);
    }
    await this.reload();
    await this.applyRecurring();
  }

  async reload(): Promise<void> {
    this.categories = await this.db.getAll<Category>('categories');
    this.paymentMethods = await this.db.getAll<PaymentMethod>('payment_methods');
    this.transactions = await this.db.getAll<Transaction>('transactions');
    this.recurringRules = await this.db.getAll<RecurringRule>('recurring_rules');
    this.budgets = await this.db.getAll<Budget>('budgets');
    this.settings = { ...DEFAULT_SETTINGS, ...((await this.db.get<Settings>('settings', 'me')) ?? {}) };
    this.emit();
  }

  /** 同期で取り込んだ変更を反映する（別の端末で追加されたルールの計上もここで行う） */
  async onPulled(tables: SyncTable[]): Promise<void> {
    await this.reload();
    if (tables.includes('recurring_rules')) await this.applyRecurring();
  }

  // ---- 毎月の自動計上（F06） -------------------------------------------------

  get activeRules(): RecurringRule[] {
    return this.recurringRules.filter((r) => !r.deleted_at).sort((a, b) => a.sort_order - b.sort_order || a.day_of_month - b.day_of_month);
  }

  /** まだ計上していない月の分を計上する。何度呼んでも二重には計上しない */
  async applyRecurring(today = new Date()): Promise<Transaction[]> {
    const existing = new Set(this.transactions.map((t) => t.id));
    const due = dueRecurringTransactions(this.recurringRules, existing, today, nowIso());
    if (due.length === 0) return [];
    await this.db.putMany('transactions', due);
    for (const t of due) await this.syncer?.markDirty('transactions', t.id, t.updated_at);
    this.transactions.push(...due);
    this.emit();
    this.requestSync();
    return due;
  }

  async saveRule(input: Omit<RecurringRule, 'id' | 'created_at' | 'updated_at' | 'deleted_at' | 'sort_order' | 'start_month' | 'end_month' | 'is_active'> & Partial<Pick<RecurringRule, 'id' | 'start_month' | 'end_month' | 'is_active'>>): Promise<RecurringRule> {
    const now = nowIso();
    const existing = input.id ? this.recurringRules.find((r) => r.id === input.id) : undefined;
    const { id: _id, ...fields } = input;
    const rule: RecurringRule = existing
      ? { ...existing, ...fields, id: existing.id, amount: Math.max(0, Math.trunc(input.amount)), updated_at: now }
      : {
          ...fields,
          id: uuid(), sort_order: this.recurringRules.length, start_month: input.start_month ?? monthKey(new Date()), end_month: input.end_month ?? null,
          is_active: input.is_active ?? true, created_at: now, updated_at: now, deleted_at: null,
          amount: Math.max(0, Math.trunc(input.amount)),
        };
    await this.save('recurring_rules', rule);
    if (!existing) this.recurringRules.push(rule);
    else Object.assign(existing, rule);
    // 今月まだ計上していなければ計上。すでに計上済みの今月分は、金額などを新しいルールに合わせる（手で直していない場合）
    await this.applyRecurring();
    if (existing) await this.syncRulePostingThisMonth(rule);
    this.emit();
    this.requestSync();
    return rule;
  }

  private async syncRulePostingThisMonth(rule: RecurringRule): Promise<void> {
    const m = monthKey(new Date());
    const t = this.transactions.find((x) => x.recurring_rule_id === rule.id && x.date.startsWith(m) && !x.deleted_at);
    if (!t || t.created_at !== t.updated_at) return; // 手で直した記録はそのまま
    Object.assign(t, {
      amount: rule.amount, type: rule.type, category_id: rule.category_id,
      payment_method_id: rule.type === 'income' ? null : rule.payment_method_id,
      date: postingDate(m, rule.day_of_month), memo: rule.name,
    });
    t.updated_at = t.created_at = nowIso();
    await this.save('transactions', t);
  }

  /** ルールを止める（今後の月は計上しない。計上済みの記録は残す） */
  async deleteRule(id: string): Promise<void> {
    const r = this.recurringRules.find((x) => x.id === id);
    if (!r) return;
    const now = nowIso();
    r.deleted_at = now;
    r.updated_at = now;
    await this.save('recurring_rules', r);
    this.emit();
    this.requestSync();
  }

  // ---- 予算（F05） ------------------------------------------------------------

  budgetsFor(periodStart: string): Budget[] {
    return this.budgets.filter((b) => b.period_start === periodStart && !b.deleted_at);
  }

  async setBudget(categoryId: string, periodStart: string, amount: number): Promise<void> {
    const id = budgetId(categoryId, periodStart);
    const now = nowIso();
    const v = Math.max(0, Math.trunc(amount) || 0);
    let b = this.budgets.find((x) => x.id === id);
    if (b) {
      Object.assign(b, { amount: v, updated_at: now, deleted_at: v > 0 ? null : now });
    } else {
      if (v === 0) return;
      b = { id, period_start: periodStart, category_id: categoryId, amount: v, created_at: now, updated_at: now, deleted_at: null };
      this.budgets.push(b);
    }
    await this.save('budgets', b);
    this.emit();
    this.requestSync();
  }

  /** 前の期間の予算を写す（すでに入っている大分類は上書きしない） */
  async copyBudgets(fromStart: string, toStart: string): Promise<number> {
    const from = this.budgetsFor(fromStart);
    const to = new Set(this.budgetsFor(toStart).map((b) => b.category_id));
    let n = 0;
    for (const b of from) {
      if (to.has(b.category_id)) continue;
      await this.setBudget(b.category_id, toStart, b.amount);
      n++;
    }
    return n;
  }

  private async save<T extends { updated_at: string }>(table: SyncTable, row: T, key?: string): Promise<void> {
    if (table === 'settings') await this.db.put(table, row, 'me');
    else await this.db.put(table, row);
    await this.syncer?.markDirty(table, key ?? String((row as unknown as { id: string }).id), row.updated_at);
  }

  requestSync(delayMs = 400): void {
    if (!this.syncer) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void this.syncer?.sync();
    }, delayMs);
  }

  // ---- 取引 ---------------------------------------------------------------

  get activePaymentMethods(): PaymentMethod[] {
    return this.paymentMethods.filter((p) => p.is_active && !p.deleted_at).sort((a, b) => a.sort_order - b.sort_order);
  }

  /** 前回と同じ支払い手段（なければ先頭） */
  get defaultPaymentMethodId(): string | null {
    const id = this.settings.last_payment_method_id;
    if (id && this.paymentMethods.some((p) => p.id === id && p.is_active && !p.deleted_at)) return id;
    return this.activePaymentMethods[0]?.id ?? null;
  }

  get quickCategories(): Category[] {
    return orderedSubcategories(this.categories);
  }

  get incomeCategories(): Category[] {
    return incomeSubcategories(this.categories);
  }

  async addTransaction(input: NewTransaction): Promise<Transaction> {
    const now = nowIso();
    const t: Transaction = {
      id: uuid(),
      date: input.date ?? toDateString(new Date()),
      amount: Math.max(0, Math.trunc(input.amount)),
      type: input.type ?? 'expense',
      category_id: input.categoryId,
      payment_method_id: input.paymentMethodId === undefined ? this.defaultPaymentMethodId : input.paymentMethodId,
      memo: input.memo ?? '',
      source: input.source ?? 'manual',
      recurring_rule_id: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    await this.save('transactions', t);
    this.transactions.push(t);

    if (t.category_id) {
      const c = this.categories.find((x) => x.id === t.category_id);
      if (c) {
        c.use_count += 1;
        c.updated_at = now;
        await this.save('categories', c);
      }
    }
    if (t.payment_method_id && t.payment_method_id !== this.settings.last_payment_method_id) {
      await this.updateSettings({ last_payment_method_id: t.payment_method_id }, false);
    }
    this.emit();
    this.requestSync();
    return t;
  }

  /** 記録を修正する。カテゴリが変わったら使用回数も付け替える。前回の支払い手段は変えない */
  async updateTransaction(id: string, patch: Partial<Pick<Transaction, 'amount' | 'category_id' | 'date' | 'payment_method_id' | 'memo' | 'type'>>): Promise<Transaction | undefined> {
    const t = this.transactions.find((x) => x.id === id);
    if (!t || t.deleted_at) return undefined;
    const now = nowIso();
    const oldCat = t.category_id;
    if (patch.amount !== undefined) patch.amount = Math.max(0, Math.trunc(patch.amount));
    Object.assign(t, patch, { updated_at: now });
    await this.save('transactions', t);
    if (patch.category_id !== undefined && patch.category_id !== oldCat) {
      const before = oldCat ? this.categories.find((x) => x.id === oldCat) : undefined;
      if (before && before.use_count > 0) { before.use_count -= 1; before.updated_at = now; await this.save('categories', before); }
      const after = t.category_id ? this.categories.find((x) => x.id === t.category_id) : undefined;
      if (after) { after.use_count += 1; after.updated_at = now; await this.save('categories', after); }
    }
    this.emit();
    this.requestSync();
    return t;
  }

  async deleteTransaction(id: string): Promise<void> {
    const t = this.transactions.find((x) => x.id === id);
    if (!t || t.deleted_at) return;
    const now = nowIso();
    t.deleted_at = now;
    t.updated_at = now;
    await this.save('transactions', t);
    const c = t.category_id ? this.categories.find((x) => x.id === t.category_id) : undefined;
    if (c && c.use_count > 0) {
      c.use_count -= 1;
      c.updated_at = now;
      await this.save('categories', c);
    }
    this.emit();
    this.requestSync();
  }

  async restoreTransaction(id: string): Promise<void> {
    const t = this.transactions.find((x) => x.id === id);
    if (!t || !t.deleted_at) return;
    const now = nowIso();
    t.deleted_at = null;
    t.updated_at = now;
    await this.save('transactions', t);
    const c = t.category_id ? this.categories.find((x) => x.id === t.category_id) : undefined;
    if (c) {
      c.use_count += 1;
      c.updated_at = now;
      await this.save('categories', c);
    }
    this.emit();
    this.requestSync();
  }

  get liveTransactions(): Transaction[] {
    return this.transactions.filter((t) => !t.deleted_at);
  }

  // ---- カテゴリ -----------------------------------------------------------

  async updateCategory(id: string, patch: Partial<Pick<Category, 'name' | 'is_active' | 'sort_order'>>): Promise<void> {
    const c = this.categories.find((x) => x.id === id);
    if (!c) return;
    Object.assign(c, patch, { updated_at: nowIso() });
    await this.save('categories', c);
    this.emit();
    this.requestSync();
  }

  async addSubcategory(parentId: string, name: string): Promise<Category> {
    const parent = this.categories.find((x) => x.id === parentId);
    const now = nowIso();
    const c: Category = {
      id: uuid(),
      name: name.trim(),
      parent_id: parentId,
      kind: parent?.kind ?? 'variable',
      sort_order: 1000 + this.categories.length,
      use_count: 0,
      is_active: true,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    await this.save('categories', c);
    this.categories.push(c);
    this.emit();
    this.requestSync();
    return c;
  }

  // ---- 支払い手段 ---------------------------------------------------------

  async addPaymentMethod(name: string, type: PaymentMethodType): Promise<PaymentMethod> {
    const now = nowIso();
    const p: PaymentMethod = {
      id: uuid(), name: name.trim(), type, withdrawal_day: null, closing_day: null,
      sort_order: this.paymentMethods.length, is_active: true, created_at: now, updated_at: now, deleted_at: null,
    };
    await this.save('payment_methods', p);
    this.paymentMethods.push(p);
    this.emit();
    this.requestSync();
    return p;
  }

  async updatePaymentMethod(id: string, patch: Partial<Pick<PaymentMethod, 'name' | 'is_active' | 'type'>>): Promise<void> {
    const p = this.paymentMethods.find((x) => x.id === id);
    if (!p) return;
    Object.assign(p, patch, { updated_at: nowIso() });
    await this.save('payment_methods', p);
    this.emit();
    this.requestSync();
  }

  // ---- 設定 ---------------------------------------------------------------

  async updateSettings(patch: Partial<Omit<Settings, 'updated_at'>>, emit = true): Promise<void> {
    this.settings = { ...this.settings, ...patch, updated_at: nowIso() };
    await this.save('settings', this.settings, 'me');
    if (emit) {
      this.emit();
      this.requestSync();
    }
  }

  // ---- 書き出し -----------------------------------------------------------

  exportJson(): string {
    return JSON.stringify(
      { exported_at: nowIso(), categories: this.categories, payment_methods: this.paymentMethods, transactions: this.transactions, settings: this.settings },
      null,
      2,
    );
  }
}
