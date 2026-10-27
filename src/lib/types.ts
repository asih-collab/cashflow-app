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
export type TransactionSource = 'manual' | 'recurring' | 'shortcut' | 'csv' | 'receipt';

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

/** 改善アドバイス（F23）への反応。月 1 回の見直しに使う */
export interface AdviceFeedback {
  id: string;
  /** どの予算期間のアドバイスか */
  period_start: string;
  rule: string;
  advice_key: string;
  useful: boolean;
  /** 出ていた文言（見直しのとき、どの言い方が役に立ったかを見るため） */
  title: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * 当てにする資産（預金・NISA の残高など）。category_id を付けると、その中分類の記録（as_of より後）と
 * 毎月の自動記録の分だけ増えていく（例: 積立 NISA を続けながら、必要な時に引き出す）
 */
export interface GoalAsset {
  name: string;
  /** as_of の日の残高 */
  amount: number;
  category_id?: string;
  /** 残高を確認した日（YYYY-MM-DD） */
  as_of?: string;
}

/** 貯金の目標（旅行資金など）。入金は goal の中分類（category_id）の記録として数える */
export interface Goal {
  id: string;
  name: string;
  /** 目標額 */
  target: number;
  /** 入金を記録する中分類（貯蓄・投資の下に目標ごとに作る） */
  category_id: string;
  /** 当てにする資産（NISA の残高など。値動きがあるものは目安） */
  assets: GoalAsset[];
  /** ボーナスなどからの入金の予定。入金したら done */
  extras: { month: string; amount: number; done: boolean }[];
  /** ◯月から毎月の入金を増やす予定（リボ完済後など） */
  increases: { from: string; amount: number }[];
  /** 鍵付き: 端末の鍵を開くまで、名前・金額を見せない（ほかの画面では alias で表示） */
  is_private?: boolean;
  /** 鍵付きのときに、ほかの画面で使う名前（例: 貯金） */
  alias?: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** 節約のチャレンジ（飲み会は月 2 回まで、ギャンブルは月 1 万円まで など）。予算期間ごとに数える */
export interface Challenge {
  id: string;
  name: string;
  kind: 'count' | 'amount';
  /** 対象の中分類 */
  category_ids: string[];
  /** 上限（回数 or 円） */
  limit: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type SyncTable = 'categories' | 'payment_methods' | 'transactions' | 'settings' | 'recurring_rules' | 'budgets' | 'debts' | 'advice_feedback' | 'goals' | 'challenges';

export interface Session {
  access_token: string;
  refresh_token: string;
  /** UNIX 秒 */
  expires_at: number;
  user: { id: string; email: string | null };
}
