# Supabase の設定

このディレクトリには、Supabase プロジェクトに反映する内容を置く。秘密情報（トークン・secret key）は置かない。

| ファイル | 内容 |
|---|---|
| `migrations/0001_init.sql` | 段階 1 のテーブル（categories / payment_methods / transactions / settings）、同期用トリガー、Row Level Security |
| `migrations/0002_signup_allowlist.sql` | 許可したメールアドレス以外の新規登録を拒否するトリガー（利用者は管理者が許可した人だけ） |
| `migrations/0004_income_categories.sql` | カテゴリの種別に「収入」を追加 |
| `migrations/0005_budgets_recurring.sql` | 予算（`budgets`）と毎月の自動計上ルール（`recurring_rules`）。RLS 付き |
| `migrations/0003_per_user_keys.sql` | 主キーを (user_id, id) にして複数利用者に対応（初期データの固定 UUID が利用者間で衝突しないように） |
| `auth-config.json` | Auth の設定（サイト URL、リダイレクト許可、6 桁コード入りのメール文面）。**メール文面は無料プラン + 標準メール送信では反映できない**（API が 400）。独自 SMTP を設定した場合に有効になる |
| `../scripts/supabase-apply.sh` | 上記を Management API で反映するスクリプト |

## 反映の手順

1. `SUPABASE_PROJECT_REF=<ref> scripts/supabase-apply.sh` を実行する（トークンは環境変数 `SUPABASE_ACCESS_TOKEN`、または Claude の環境ではプロキシが自動付与）。2026-09-28 にスキーマ 2 本とサイト URL・リダイレクト許可は反映済み
2. 本人のメールアドレスを許可リストに入れる（SQL Editor か Management API の `database/query` で）
   ```sql
   insert into private.allowed_emails (email) values ('<本人のメールアドレス>');
   ```
3. GitHub リポジトリの Variables に `SUPABASE_URL`（`https://<ref>.supabase.co`）と `SUPABASE_PUBLISHABLE_KEY`（Project Settings > API Keys の Publishable key）を登録する

## 設計メモ

- 全テーブルに `updated_at`（端末が付ける）と `synced_at`（サーバーが付ける）を持つ。差分取得は `synced_at`、衝突解決は `updated_at` で行う
- `reject_stale_update` トリガーにより、古い `updated_at` の更新はサーバー側で捨てられる（新しい方を採用）
- `anon` ロールには何の権限も無い。ログイン済み（`authenticated`）かつ `user_id = auth.uid()` の行だけ読み書きできる
- 削除は `deleted_at` による論理削除

## 利用者を増やす

- 許可リストに追加: `insert into private.allowed_emails (email) values ('...');`
- 削除（登録済みのアカウントは残る）: `delete from private.allowed_emails where email = '...';`
- 利用者一覧: Supabase ダッシュボードの Authentication > Users

## 外部メール送信（独自 SMTP）の設定

標準のメール送信は 1 時間に 2 通まで・文面の変更不可。複数人で使うなら独自 SMTP を設定する。ドメインを持っていなくても使える Brevo（無料枠 300 通/日）を想定。

1. Brevo でアカウントを作り、送信元メールアドレス（自分の Gmail でよい）を認証する
2. Brevo の SMTP & API 画面で SMTP キーを発行する
3. Supabase ダッシュボード > Project Settings > Authentication > SMTP Settings で「Enable Custom SMTP」を有効にし、次を入れる
   - Sender email: 認証したアドレス / Sender name: 家計
   - Host: `smtp-relay.brevo.com` / Port: `587` / Username: Brevo のログインメール / Password: SMTP キー
4. 保存後、`scripts/supabase-apply.sh` を再実行すると `auth-config.json` のメール文面（6 桁コード入り）が反映される
5. アプリ側のログイン画面をコード入力優先に切り替える（`src/ui/views/login.ts`。文面にコードが載るようになった後）

Gmail の「アプリパスワード」（smtp.gmail.com:465）でも動くが、Gmail 側の送信上限と規約に注意。
