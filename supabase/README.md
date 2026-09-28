# Supabase の設定

このディレクトリには、Supabase プロジェクトに反映する内容を置く。秘密情報（トークン・secret key）は置かない。

| ファイル | 内容 |
|---|---|
| `migrations/0001_init.sql` | 段階 1 のテーブル（categories / payment_methods / transactions / settings）、同期用トリガー、Row Level Security |
| `migrations/0002_signup_allowlist.sql` | 許可したメールアドレス以外の新規登録を拒否するトリガー（本人専用のため） |
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
