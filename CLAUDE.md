# cashflow-app — Claude Code 向けの案内

個人向け支出管理・キャッシュフロー最適化アプリ。利用者は本人 1 名（iPhone の Safari / ホーム画面に追加した PWA）。
要件は非公開リポジトリ `asih-collab/Cash-Flow-Optimization` の `docs/requirements/` にある（00〜07）。**このリポジトリは公開なので、家計の数字・メールアドレス・鍵・トークンを絶対に含めない。**

## 構成

| 層 | 技術 | 場所 |
|---|---|---|
| UI | HTML / CSS / TypeScript（フレームワークなし、依存最小） | `src/ui/`（`views/` に画面、`dom.ts` は小さなヘルパー） |
| ロジック | 純粋な TypeScript（テスト対象） | `src/lib/`（`period` 予算期間、`stats` 集計、`categories` 初期セットと並び、`store` データ操作、`sync` 同期、`supabase` 最小クライアント、`db` IndexedDB） |
| オフライン | 自前の Service Worker | `src/sw.js`（テンプレート）→ `scripts/build-sw.mjs` が `dist/sw.js` を生成 |
| データ | IndexedDB（端末が正）+ Supabase（Postgres, RLS） | `supabase/migrations/`、`supabase/README.md` |
| 公開 | GitHub Pages（`main` への push で GitHub Actions が test → build → deploy） | `.github/workflows/deploy.yml` |
| ルーティング | ハッシュ（`#/` ホーム、`#/add` 記録、`#/settings` 設定、`#/categories`、`#/login`）。`#/add?amount=1200&cat=デート` で値を渡せる（ショートカット用） | `src/main.ts` |

公開 URL: `https://asih-collab.github.io/cashflow-app/`（`vite.config.ts` の `base` と一致させる）

## コマンド

```bash
npm ci                 # 依存の入手（.npmrc で legacy-peer-deps）
npm run dev            # 開発サーバー（Service Worker は無効）
npm run typecheck      # 型チェック
npm run test:unit      # vitest（tests/unit）。予算期間・集計・カテゴリ順・同期・ストア
npm run test:e2e       # ビルド（--mode e2e。vite.config.ts のダミー接続先）→ Playwright（iPhone 14 のビューポート、Chromium）
npm test               # 上 2 つ
npm run build          # 本番ビルド（dist/）。VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY を環境変数で渡す
npm run icons          # アイコン PNG を作り直す（通常は不要）
```

Playwright は `@playwright/test` 1.56 系に固定。ローカルに Chromium が無い場合は `npx playwright install chromium`。
CI では `.github/workflows/deploy.yml` の `test` ジョブが同じことを行う。テストが落ちると公開されない。

## 環境変数（ビルド時）

| 変数 | 内容 | どこで設定するか |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` | GitHub の Variables `SUPABASE_URL` / ローカルは `.env.local`（`.env*` は全て gitignore） |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key（公開前提の鍵。それでもリポジトリには置かない） | GitHub の Variables `SUPABASE_PUBLISHABLE_KEY` / ローカルは `.env.local`（gitignore 済み） |

未設定でもビルド・動作はする（端末内のみに保存、ログイン画面に注意書きが出る）。値をリポジトリに置くことは環境の保護機能で拒否されるため、GitHub の Variables に本人が登録する。

## Supabase

- 反映手順とスキーマの説明は `supabase/README.md`
- Management API は `api.supabase.com`。プロジェクトの `*.supabase.co` には Claude のクラウド環境から直接つなげない（テストはフェイクで行う）
- Auth はメールのマジックリンク。無料プラン + 標準メール送信ではメール文面を変えられず 6 桁コードを載せられない。ホーム画面に追加した PWA は Safari と保存領域が別なので、Safari 着地時に `#/handoff` で「ログイン情報をコピー」→ PWA の `#/login` で貼り付け（`src/lib/handoff.ts`）。コード入力欄は文面にコードがある場合（独自 SMTP 設定時）用
- 新規登録は `private.allowed_emails` にあるメールだけ（本人専用）

## 設計上の決まり

- **記録は 3 タップ**（金額 → 中分類 → 保存）。これを超える入力は「詳細」に隠す。日付は今日、支払い手段は前回と同じ
- 金額は整数円。集計は発生日（使った日）ベース
- 端末内 IndexedDB が正。保存は即時、同期はあとから（`outbox` に未送信を残す）。衝突は `updated_at` が新しい方
- 初期データ（カテゴリ・支払い手段）は固定 UUID・固定の古い時刻。別端末で先に使っていた場合にそちらが勝つため
- 削除は論理削除（`deleted_at`）
- 段階 1 では予算なし。ホームは「今月の変動費合計 + 中分類別内訳」

## 作業の記録

- 決定と変更は `docs/決定記録.md` に追記する
- 利用者向けの説明は `docs/使い方.md`（平易な日本語）
- 要件そのものを変える場合は、非公開リポジトリ側の該当ドキュメントの「決定事項と理由」にも追記する

## ロードマップ（07_MVPスコープ.md より）

段階 1（本リポジトリの現状）: F01 クイック記録、F04 カテゴリ、F02 ホーム（合計版）、F10 ログインと同期、ホーム画面追加の案内
段階 2: F05 予算、F06 固定支出の自動計上、F07 月次サマリ、F11 編集・過去日付
段階 3: F09 通知、F08 リボ残高、iOS ショートカット、PWA の仕上げ
