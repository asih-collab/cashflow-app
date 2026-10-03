-- 段階 2: 予算（F05）と毎月の自動計上ルール（F06）
create table if not exists public.recurring_rules (
  id                 uuid not null,
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name               text not null,
  amount             integer not null check (amount >= 0),
  type               text not null default 'expense' check (type in ('expense','income')),
  category_id        uuid,
  payment_method_id  uuid,
  day_of_month       integer not null default 1 check (day_of_month between 1 and 31),
  start_month        text not null,           -- 'YYYY-MM'
  end_month          text,                    -- 'YYYY-MM'（含む）。null なら無期限
  needs_review       boolean not null default false, -- 準固定費（光熱費など）: 仮の金額で計上し、あとで直す
  is_active          boolean not null default true,
  sort_order         integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  synced_at          timestamptz not null default now(),
  deleted_at         timestamptz,
  primary key (user_id, id)
);
create index if not exists recurring_rules_user_synced_idx on public.recurring_rules (user_id, synced_at);

create table if not exists public.budgets (
  id            uuid not null,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period_start  date not null,               -- 予算期間の初日
  category_id   uuid not null,               -- 大分類
  amount        integer not null check (amount >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  synced_at     timestamptz not null default now(),
  deleted_at    timestamptz,
  primary key (user_id, id)
);
create index if not exists budgets_user_synced_idx on public.budgets (user_id, synced_at);

do $$
declare t text;
begin
  foreach t in array array['recurring_rules','budgets'] loop
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
  end loop;
end $$;
revoke all on public.recurring_rules, public.budgets from anon;
