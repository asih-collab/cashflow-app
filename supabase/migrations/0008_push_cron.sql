-- 段階 3: 通知を毎日決まった時刻に送る（pg_cron + pg_net で Edge Function `notify` を呼ぶ）
-- 呼び先の URL と合言葉は Vault に置く（リポジトリには書かない）。scripts/setup-push.mjs が作る:
--   notify_url          https://<ref>.supabase.co/functions/v1/notify
--   notify_cron_secret  Edge Function のシークレット CRON_SECRET と同じ値
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function private.call_notify(kind text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  u text := (select decrypted_secret from vault.decrypted_secrets where name = 'notify_url');
  s text := (select decrypted_secret from vault.decrypted_secrets where name = 'notify_cron_secret');
begin
  if u is null or s is null then
    raise notice 'notify_url / notify_cron_secret が Vault にありません';
    return null;
  end if;
  return net.http_post(
    url := u,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', s),
    body := jsonb_build_object('kind', kind),
    timeout_milliseconds := 30000
  );
end $$;
revoke all on function private.call_notify(text) from public, anon, authenticated;

-- 時刻は UTC。20:00 JST = 11:00 UTC、21:00 JST = 12:00 UTC
select cron.unschedule(jobid) from cron.job where jobname in ('notify-review', 'notify-reminder');
select cron.schedule('notify-review', '0 11 * * *', $$select private.call_notify('review')$$);
select cron.schedule('notify-reminder', '0 12 * * *', $$select private.call_notify('reminder')$$);
