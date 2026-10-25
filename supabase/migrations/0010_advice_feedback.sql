-- 段階 3.5: 改善アドバイス（F23）への反応（役に立った / 立たない）。月 1 回の見直しに使う（04 の 6 章）
-- 見直しで使うのは管理者（本人）の行だけ。知人の行は本人の同意なしに分析しない
create table if not exists public.advice_feedback (
  id            uuid not null,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period_start  date not null,
  rule          text not null,
  advice_key    text not null,
  useful        boolean not null,
  title         text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  synced_at     timestamptz not null default now(),
  deleted_at    timestamptz,
  primary key (user_id, id)
);
create index if not exists advice_feedback_user_synced_idx on public.advice_feedback (user_id, synced_at);

drop trigger if exists set_synced_at on public.advice_feedback;
create trigger set_synced_at before insert or update on public.advice_feedback for each row execute function public.tg_set_synced_at();
drop trigger if exists reject_stale_update on public.advice_feedback;
create trigger reject_stale_update before update on public.advice_feedback for each row execute function public.tg_reject_stale_update();
alter table public.advice_feedback enable row level security;
drop policy if exists own_select on public.advice_feedback;
drop policy if exists own_insert on public.advice_feedback;
drop policy if exists own_update on public.advice_feedback;
drop policy if exists own_delete on public.advice_feedback;
create policy own_select on public.advice_feedback for select to authenticated using (user_id = (select auth.uid()));
create policy own_insert on public.advice_feedback for insert to authenticated with check (user_id = (select auth.uid()));
create policy own_update on public.advice_feedback for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_delete on public.advice_feedback for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.advice_feedback from anon;
grant select, insert, update, delete on public.advice_feedback to authenticated;
