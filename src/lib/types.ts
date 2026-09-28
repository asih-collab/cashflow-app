// データモデル（06_データモデルと画面.md に対応）。金額は整数円。

export type CategoryKind = 'variable' | 'semi_fixed' | 'fixed';

export interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  kind: CategoryKind;
  sort_order: number;
  use_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type PaymentMethodType = 'card' | 'qr' | 'bank' | 'cash';

export interface PaymentMethod {
  id: string;
  name: string;
  type: PaymentMethodType;
  withdrawal_day: number | null;
  closing_day: number | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type TransactionType = 'expense' | 'income';
export type TransactionSource = 'manual' | 'recurring' | 'shortcut' | 'csv';

export interface Transaction {
  id: string;
  /** 使った日（YYYY-MM-DD）。発生日ベース */
  date: string;
  amount: number;
  type: TransactionType;
  category_id: string | null;
  payment_method_id: string | null;
  memo: string;
  source: TransactionSource;
  recurring_rule_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Settings {
  /** 予算期間の開始日。1 なら暦月、25 なら給料日基準 */
  month_start_day: number;
  last_payment_method_id: string | null;
  start_screen: 'add' | 'home';
  save_on_category_tap: boolean;
  updated_at: string;
}

export type SyncTable = 'categories' | 'payment_methods' | 'transactions' | 'settings';

export interface Session {
  access_token: string;
  refresh_token: string;
  /** UNIX 秒 */
  expires_at: number;
  user: { id: string; email: string | null };
}
