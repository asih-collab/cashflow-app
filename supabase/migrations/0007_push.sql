-- 段階 3: 通知（F09 の C 記録リマインド・E 月末振り返り）
-- 端末ごとの購読（ホーム画面に追加したアプリで「通知をオンにする」を押すと 1 行入る）
create table if not exists public.push_subscriptions (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  reminder    boolean not null default true,  -- C. 21 時に記録ゼロの日だけ
  review      boolean not null default true,  -- E. 予算期間の最終日 20 時
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, endpoint)
);
alter table public.push_subscriptions enable row level security;
drop policy if exists own_select on public.push_subscriptions;
drop policy if exists own_insert on public.push_subscriptions;
drop policy if exists own_update on public.push_subscriptions;
drop policy if exists own_delete on public.push_subscriptions;
create policy own_select on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy own_insert on public.push_subscriptions for insert to authenticated with check (user_id = (select auth.uid()));
create policy own_update on public.push_subscriptions for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_delete on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.push_subscriptions from anon;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- 送った通知の記録（同じ通知を同じ日に 2 回送らない）。Edge Function（service role）だけが使う
create table if not exists public.notification_log (
  user_id  uuid not null references auth.users(id) on delete cascade,
  kind     text not null,
  key      text not null,               -- 対象の日（YYYY-MM-DD、日本時間）
  sent_at  timestamptz not null default now(),
  primary key (user_id, kind, key)
);
alter table public.notification_log enable row level security;
revoke all on public.notification_log from anon, authenticated;

-- 通知用の公開鍵（VAPID）。アプリが購読するときに読む。秘密鍵は Edge Function のシークレットにだけ置く
create table if not exists private.app_config (
  key    text primary key,
  value  text not null
);
create or replace function public.push_public_key()
returns text language sql stable security definer set search_path = '' as $$
  select value from private.app_config where key = 'vapid_public_key'
$$;
revoke all on function public.push_public_key() from public, anon;
grant execute on function public.push_public_key() to authenticated;
