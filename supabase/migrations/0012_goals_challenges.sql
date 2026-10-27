-- 貯金の目標（旅行資金など）と、節約のチャレンジ（回数・金額の上限）
create table if not exists public.goals (
  id            uuid not null,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null,
  target        integer not null check (target >= 0),
  category_id   uuid not null,
  assets        jsonb not null default '[]'::jsonb,   -- [{name, amount}] 当てにする資産（NISA の残高など）
  extras        jsonb not null default '[]'::jsonb,   -- [{month, amount, done}] ボーナスなどからの入金の予定
  increases     jsonb not null default '[]'::jsonb,   -- [{from, amount}] ◯月から毎月の入金を増やす
  is_active     boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  synced_at     timestamptz not null default now(),
  deleted_at    timestamptz,
  primary key (user_id, id)
);
create index if not exists goals_user_synced_idx on public.goals (user_id, synced_at);

create table if not exists public.challenges (
  id            uuid not null,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null,
  kind          text not null check (kind in ('count','amount')),
  category_ids  jsonb not null default '[]'::jsonb,
  "limit"       integer not null check ("limit" >= 0),
  is_active     boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  synced_at     timestamptz not null default now(),
  deleted_at    timestamptz,
  primary key (user_id, id)
);
create index if not exists challenges_user_synced_idx on public.challenges (user_id, synced_at);

do $$
declare t text;
begin
  foreach t in array array['goals','challenges'] loop
    execute format('drop trigger if exists set_synced_at on public.%I', t);
    execute format('create trigger set_synced_at before insert or update on public.%I for each row execute function public.tg_set_synced_at()', t);
    execute format('drop trigger if exists reject_stale_update on public.%I', t);
    execute format('create trigger reject_stale_update before update on public.%I for each row execute function public.tg_reject_stale_update()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists own_select on public.%I', t);
    execute format('drop policy if exists own_insert on public.%I', t);
    execute format('drop policy if exists own_update on public.%I', t);
    execute format('drop policy if exists own_delete on public.%I', t);
    execute format('create policy own_select on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('create policy own_insert on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t);
    execute format('create policy own_update on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('create policy own_delete on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
