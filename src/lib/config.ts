export interface AppConfig {
  supabaseUrl: string;
  supabaseKey: string;
  /** GitHub Pages のパス（Service Worker の登録などに使う） */
  base: string;
  version: string;
}

export function loadConfig(): AppConfig {
  const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env ?? {};
  return {
    supabaseUrl: (env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, ''),
    supabaseKey: env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
    base: env.BASE_URL ?? '/',
    version: env.VITE_APP_VERSION ?? 'dev',
  };
}

export function isSupabaseConfigured(c: AppConfig): boolean {
  return c.supabaseUrl.length > 0 && c.supabaseKey.length > 0;
}
