-- 段階 3: リボ・分割の残高（F08）
create table if not exists public.debts (
  id               uuid not null,
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name             text not null,
  balance          integer not null default 0 check (balance >= 0),
  balance_date     date not null,
  monthly_payment  integer not null default 0 check (monthly_payment >= 0),
  annual_rate      numeric(5,2) not null default 15 check (annual_rate >= 0),
  history          jsonb not null default '[]'::jsonb,  -- [{date, balance}] 古い順
  is_active        boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  synced_at        timestamptz not null default now(),
  deleted_at       timestamptz,
  primary key (user_id, id)
);
create index if not exists debts_user_synced_idx on public.debts (user_id, synced_at);

drop trigger if exists set_synced_at on public.debts;
create trigger set_synced_at before insert or update on public.debts for each row execute function public.tg_set_synced_at();
drop trigger if exists reject_stale_update on public.debts;
create trigger reject_stale_update before update on public.debts for each row execute function public.tg_reject_stale_update();
alter table public.debts enable row level security;
drop policy if exists own_select on public.debts;
drop policy if exists own_insert on public.debts;
drop policy if exists own_update on public.debts;
drop policy if exists own_delete on public.debts;
create policy own_select on public.debts for select to authenticated using (user_id = (select auth.uid()));
create policy own_insert on public.debts for insert to authenticated with check (user_id = (select auth.uid()));
create policy own_update on public.debts for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_delete on public.debts for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.debts from anon;
grant select, insert, update, delete on public.debts to authenticated;
