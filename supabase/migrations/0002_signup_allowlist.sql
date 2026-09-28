-- 本人専用アプリのため、許可したメールアドレス以外の新規登録を DB 側で拒否する。
-- 許可リストの中身（本人のメールアドレス）はリポジトリに含めず、運用者が直接 insert する。
--   insert into private.allowed_emails (email) values ('<本人のメール>');
create schema if not exists private;

create table if not exists private.allowed_emails (
  email text primary key
);
revoke all on schema private from anon, authenticated;
revoke all on private.allowed_emails from anon, authenticated;

create or replace function private.check_signup_allowed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.allowed_emails a where lower(a.email) = lower(new.email)) then
    raise exception 'signup not allowed for this address' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists check_signup_allowed on auth.users;
create trigger check_signup_allowed
  before insert on auth.users
  for each row execute function private.check_signup_allowed();
