import './app.css';
import { loadConfig, isSupabaseConfigured } from './lib/config';
import { Db } from './lib/db';
import { AppStore } from './lib/store';
import { SupabaseClient } from './lib/supabase';
import { Syncer, type SessionStore } from './lib/sync';
import type { Session } from './lib/types';
import { parseHash, type AppContext } from './ui/context';
import { clear, h } from './ui/dom';
import { toast } from './ui/toast';
import { renderHome } from './ui/views/home';
import { renderAdd } from './ui/views/add';
import { renderSettings } from './ui/views/settings';
import { renderCategories } from './ui/views/categories';
import { renderLogin } from './ui/views/login';
import { ONBOARDED_KEY, showOnboarding } from './ui/views/onboarding';
import { renderHandoff } from './ui/views/handoff';
import { renderBudget } from './ui/views/budget';
import { renderRecurring } from './ui/views/recurring';
import { renderSummary } from './ui/views/summary';
import { renderHistory } from './ui/views/history';
import { isIOS, isStandalone } from './ui/install';
import { icon } from './ui/icons';

const SESSION_KEY = 'cf.session';

const sessions: SessionStore = {
  get() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  },
  set(s) {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  },
};

async function boot(): Promise<void> {
  const config = loadConfig();
  const db = new Db();
  const client = isSupabaseConfigured(config) ? new SupabaseClient(config.supabaseUrl, config.supabaseKey) : null;
  const store = new AppStore(db);
  const syncer = new Syncer(db, client, sessions, () => navigator.onLine, (t) => store.onPulled(t));
  store.attachSyncer(syncer);
  await syncer.loadLastSyncedAt();
  await store.init();

  const ctx: AppContext = {
    config, store, syncer, sessions, client,
    navigate(path: string) {
      const target = '#' + (path.startsWith('/') ? path : '/' + path);
      if (location.hash === target) render();
      else location.hash = target;
    },
    busy: { entering: false },
  };

  // マジックリンクからの着地（#access_token=...）
  const fromLink = SupabaseClient.sessionFromHash(location.hash);
  if (fromLink) {
    if (isIOS() && !isStandalone()) {
      // iPhone の Safari で開いた: ホーム画面のアプリに引き継ぐか、このまま Safari で使うかを選んでもらう
      ctx.pendingSession = fromLink;
      history.replaceState(null, '', location.pathname + location.search + '#/handoff');
    } else {
      sessions.set(fromLink);
      await syncer.resetCursors();
      history.replaceState(null, '', location.pathname + location.search + '#/');
      toast('ログインしました。同期を始めます。');
    }
  } else if (location.hash.includes('error_description=')) {
    const p = new URLSearchParams(location.hash.slice(1));
    toast(`ログインできませんでした: ${p.get('error_description') ?? ''}`, { durationMs: 6000 });
    history.replaceState(null, '', location.pathname + location.search + '#/login');
  }

  // 起動時の画面（設定）。ハッシュが無いときだけ
  if (!location.hash || location.hash === '#' || location.hash === '#/') {
    if (location.hash !== '#/' && store.settings.start_screen === 'add') history.replaceState(null, '', location.pathname + location.search + '#/add');
  }

  const view = document.getElementById('view')!;
  const tabbar = document.getElementById('tabbar')!;

  function renderTabs(path: string): void {
    clear(tabbar);
    const tab = (href: string, ico: 'home' | 'add' | 'settings' | 'list' | 'chart', label: string, active: boolean, extra = '') =>
      h('a', { href, class: (active ? 'active ' : '') + extra, 'data-testid': `tab-${href.slice(2) || 'home'}` }, icon(ico), label);
    tabbar.append(
      tab('#/', 'home', 'ホーム', path === '/'),
      tab('#/history', 'list', '履歴', path === '/history' || path === '/edit'),
      tab('#/add', 'add', '記録', path === '/add', 'add'),
      tab('#/summary', 'chart', 'サマリ', path === '/summary' || path === '/budget'),
      tab('#/settings', 'settings', '設定', ['/settings', '/categories', '/login', '/handoff', '/recurring'].includes(path)),
    );
  }

  function render(): void {
    const route = parseHash(location.hash);
    ctx.route = route;
    ctx.busy.entering = false;
    let el: HTMLElement;
    switch (route.path) {
      case '/add': el = renderAdd(ctx, route); break;
      case '/edit': el = renderAdd(ctx, route); break;
      case '/settings': el = renderSettings(ctx); break;
      case '/categories': el = renderCategories(ctx); break;
      case '/login': el = renderLogin(ctx); break;
      case '/handoff': el = renderHandoff(ctx); break;
      case '/budget': el = renderBudget(ctx, route); break;
      case '/recurring': el = renderRecurring(ctx, route); break;
      case '/summary': el = renderSummary(ctx, route); break;
      case '/history': el = renderHistory(ctx, route); break;
      default: el = renderHome(ctx);
    }
    clear(view);
    view.appendChild(el);
    renderTabs(route.path);
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', render);
  // データや同期状態が変わったら、入力中でない画面だけ描き直す
  const rerenderIfIdle = () => {
    if (['/add', '/edit', '/login', '/handoff', '/budget', '/recurring'].includes(ctx.route?.path ?? '')) return;
    render();
  };
  store.subscribe(rerenderIfIdle);
  let lastStatus = '';
  syncer.subscribe((s) => {
    const key = `${s.status}:${s.pending}:${s.lastSyncedAt}`;
    if (key !== lastStatus) {
      lastStatus = key;
      rerenderIfIdle();
    }
  });

  render();

  if (!localStorage.getItem(ONBOARDED_KEY)) showOnboarding(ctx);

  // 同期のきっかけ: 起動時、通信復帰、画面復帰、5 分ごと
  void syncer.sync();
  window.addEventListener('online', () => void syncer.sync());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void store.applyRecurring(); // 月が変わっていたら、その月の固定費・給料を記録
    void syncer.sync();
  });
  setInterval(() => void syncer.sync(), 5 * 60 * 1000);

  registerServiceWorker(ctx);
}

function registerServiceWorker(ctx: AppContext): void {
  if (!('serviceWorker' in navigator)) return;
  if ((import.meta as unknown as { env: { DEV?: boolean } }).env.DEV) return;
  const base = ctx.config.base.endsWith('/') ? ctx.config.base : ctx.config.base + '/';
  navigator.serviceWorker.register(`${base}sw.js`).then((reg) => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) {
          toast('新しいバージョンに更新しました', { durationMs: 2500 });
        }
      });
    });
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !navigator.serviceWorker.controller) return;
    reloaded = true;
    // 入力中なら邪魔しない。次に開き直したときに新しい版になる
    if (!ctx.busy.entering) location.reload();
  });
}

void boot().catch((e) => {
  const view = document.getElementById('view');
  if (view) view.textContent = `起動に失敗しました: ${e instanceof Error ? e.message : String(e)}`;
});
