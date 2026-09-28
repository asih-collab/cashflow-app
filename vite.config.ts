import { defineConfig } from 'vitest/config';

// GitHub Pages では https://<owner>.github.io/cashflow-app/ に配置されるため base を固定する。
export default defineConfig(({ mode }) => ({
  base: '/cashflow-app/',
  // 自動テスト（--mode e2e）ではダミーの接続先を埋め込む。テスト側でネットワークを差し替えるため実在しない。
  // 本番の接続先は GitHub Actions の環境変数（VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY）から入る。
  define: mode === 'e2e'
    ? { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://supabase.test'), 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('test-publishable-key') }
    : {},
  build: {
    target: 'es2020',
    sourcemap: false,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
}));
