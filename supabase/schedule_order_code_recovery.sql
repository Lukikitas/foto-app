-- Run after the migration, after enabling pg_cron/pg_net and creating these Vault
-- secrets: foto_app_url, foto_app_anon_key, foto_app_recovery_secret.
-- The secret must match ORDER_RECOVERY_CRON_SECRET in the Edge Function.
create or replace function public.dispatch_order_code_recovery()
returns void language plpgsql security definer set search_path = public
as $$
declare
  settings public.order_recovery_settings%rowtype;
  local_now timestamp;
  local_day date;
  project_url text;
  anon_key text;
  runner_secret text;
begin
  select * into settings from public.order_recovery_settings where id = true;
  if not settings.enabled then return; end if;
  local_now := now() at time zone 'America/Argentina/Buenos_Aires';
  local_day := local_now::date;
  if local_now::time < settings.start_time then return; end if;
  if exists (
    select 1 from public.order_recovery_runs
    where day = local_day and status in ('complete', 'quota_exhausted')
  ) then return; end if;
  select decrypted_secret into project_url from vault.decrypted_secrets where name = 'foto_app_url';
  select decrypted_secret into anon_key from vault.decrypted_secrets where name = 'foto_app_anon_key';
  select decrypted_secret into runner_secret from vault.decrypted_secrets where name = 'foto_app_recovery_secret';
  if project_url is null or anon_key is null or runner_secret is null then
    raise exception 'Order recovery Vault secrets are missing';
  end if;
  perform net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/order-code-recovery',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', anon_key,
      'Authorization', 'Bearer ' || anon_key,
      'x-recovery-secret', runner_secret
    ),
    body := '{"action":"scheduled"}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;
revoke execute on function public.dispatch_order_code_recovery() from public, anon, authenticated;
grant execute on function public.dispatch_order_code_recovery() to postgres;
select cron.schedule(
  'foto-app-order-code-recovery',
  '* * * * *',
  'select public.dispatch_order_code_recovery()'
);
