// データモデル（06_データモデルと画面.md に対応）。金額は整数円。

export type CategoryKind = 'variable' | 'semi_fixed' | 'fixed' | 'income';

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

export interface RecurringRule {
  id: string;
  name: string;
  amount: number;
  type: TransactionType;
  category_id: string | null;
  payment_method_id: string | null;
  /** 毎月何日に計上するか（月末より大きい日は月末） */
  day_of_month: number;
  /** 'YYYY-MM' この月から計上 */
  start_month: string;
  /** 'YYYY-MM' この月まで（含む）。null なら無期限 */
  end_month: string | null;
  /** 準固定費（光熱費など）: 仮の金額で計上し、あとで直す */
  needs_review: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Budget {
  id: string;
  /** 予算期間の初日（YYYY-MM-DD） */
  period_start: string;
  /** 大分類の ID */
  category_id: string;
  amount: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** リボ・分割の残高（F08）。カード 1 枚（または分割 1 件）ごと */
export interface Debt {
  id: string;
  name: string;
  /** balance_date 時点の残高 */
  balance: number;
  /** 残高を確認した日（YYYY-MM-DD） */
  balance_date: string;
  /** 毎月の返済額（手数料込み） */
  monthly_payment: number;
  /** 手数料の年率（%）。例: 15 */
  annual_rate: number;
  /** これまでに確認した残高（推移の表示用。古い順） */
  history: { date: string; balance: number }[];
  /** 一括返済の予定（ボーナスなど）。month は 'YYYY-MM'。返したら done（古いデータでは無いことがある） */
  lumps?: { month: string; amount: number; done: boolean }[];
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type SyncTable = 'categories' | 'payment_methods' | 'transactions' | 'settings' | 'recurring_rules' | 'budgets' | 'debts';

export interface Session {
  access_token: string;
  refresh_token: string;
  /** UNIX 秒 */
  expires_at: number;
  user: { id: string; email: string | null };
}
