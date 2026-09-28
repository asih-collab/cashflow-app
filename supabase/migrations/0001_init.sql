-- 段階 1（記録できる）のスキーマ。
-- 方針: 端末（IndexedDB）を正とするローカルファースト。全行に
--   updated_at … 端末が付ける更新時刻（衝突時は新しい方を採用）
--   synced_at  … サーバーが付ける到着時刻（差分取得のカーソル）
--   deleted_at … 論理削除
-- を持たせる。Row Level Security で「自分の行しか読めない」を DB 側で強制する。

-- ---------------------------------------------------------------
-- 共通トリガー
-- ---------------------------------------------------------------
create or replace function public.tg_set_synced_at()
returns trigger language plpgsql as $$
begin
  new.synced_at := now();
  return new;
end $$;

-- 端末の updated_at が既存より古い場合は更新を捨てる（新しい方を採用）
create or replace function public.tg_reject_stale_update()
returns trigger language plpgsql as $$
begin
  if new.updated_at < old.updated_at then
    return null;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------
-- categories（大分類・中分類）
-- ---------------------------------------------------------------
create table if not exists public.categories (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  parent_id   uuid references public.categories(id),
  kind        text not null default 'variable' check (kind in ('variable','semi_fixed','fixed')),
  sort_order  integer not null default 0,
  use_count   integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  synced_at   timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists categories_user_synced_idx on public.categories (user_id, synced_at);

-- ---------------------------------------------------------------
-- payment_methods（支払い手段）
-- ---------------------------------------------------------------
create table if not exists public.payment_methods (
  id              uuid primary key,
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name            text not null,
  type            text not null default 'card' check (type in ('card','qr','bank','cash')),
  withdrawal_day  integer check (withdrawal_day between 1 and 31),
  closing_day     integer check (closing_day between 1 and 31),
  sort_order      integer not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  synced_at       timestamptz not null default now(),
  deleted_at      timestamptz
);
create index if not exists payment_methods_user_synced_idx on public.payment_methods (user_id, synced_at);

-- ---------------------------------------------------------------
-- transactions（取引）
-- ---------------------------------------------------------------
create table if not exists public.transactions (
  id                 uuid primary key,
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date               date not null,
  amount             integer not null check (amount >= 0),
  type               text not null default 'expense' check (type in ('expense','income')),
  category_id        uuid references public.categories(id),
  payment_method_id  uuid references public.payment_methods(id),
  memo               text not null default '',
  source             text not null default 'manual' check (source in ('manual','recurring','shortcut','csv')),
  recurring_rule_id  uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  synced_at          timestamptz not null default now(),
  deleted_at         timestamptz
);
create index if not exists transactions_user_synced_idx on public.transactions (user_id, synced_at);
create index if not exists transactions_user_date_idx on public.transactions (user_id, date);

-- ---------------------------------------------------------------
-- settings（利用者ごとに 1 行）
-- ---------------------------------------------------------------
create table if not exists public.settings (
  user_id                 uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  month_start_day         integer not null default 1 check (month_start_day between 1 and 28),
  last_payment_method_id  uuid,
  start_screen            text not null default 'add' check (start_screen in ('add','home')),
  save_on_category_tap    boolean not null default false,
  updated_at              timestamptz not null default now(),
  synced_at               timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- トリガー
-- ---------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['categories','payment_methods','transactions','settings'] loop
    execute format('drop trigger if exists set_synced_at on public.%I', t);
    execute format('create trigger set_synced_at before insert or update on public.%I for each row execute function public.tg_set_synced_at()', t);
    execute format('drop trigger if exists reject_stale_update on public.%I', t);
    execute format('create trigger reject_stale_update before update on public.%I for each row execute function public.tg_reject_stale_update()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------
-- Row Level Security: 自分の行だけ
-- ---------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['categories','payment_methods','transactions','settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists own_select on public.%I', t);
    execute format('drop policy if exists own_insert on public.%I', t);
    execute format('drop policy if exists own_update on public.%I', t);
    execute format('drop policy if exists own_delete on public.%I', t);
    execute format('create policy own_select on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('create policy own_insert on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t);
    execute format('create policy own_update on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('create policy own_delete on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- anon（未ログイン）には一切の権限を与えない
revoke all on all tables in schema public from anon;
