-- ===========================================================================
-- Checker schedule: Supabase pg_cron + pg_net call POST /api/checks/run every
-- 5 minutes. Replaces the GitHub Actions `schedule:` trigger, which fired only
-- a handful of times a day (the `monitor` workflow keeps `workflow_dispatch`
-- for manual runs).
--
-- Same pattern as 20261124200000_watchdog_cron.sql, and does not depend on it
-- having been applied: the extensions and the `private` schema are created
-- here too if missing. Secrets come from Supabase Vault at run time:
--   monitor_base_url     e.g. https://monitor.9expert.app
--   monitor_cron_secret  same value as CRON_SECRET in Vercel
-- Until both exist the job runs and does nothing.
--
-- Safe to run more than once.
-- ===========================================================================

-- Supabase convention: pg_cron in pg_catalog, pg_net in extensions.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- A schema PostgREST does not expose, for internal functions.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- private.call_monitor_checker() — one fire-and-forget POST.
--
-- security definer so the cron job can read vault.decrypted_secrets; the
-- search_path is empty and every name is schema-qualified. Returns the
-- pg_net request id, or null when a secret is missing.
--
-- Timeout: the route's maxDuration is 60 s (its own run deadline is 45 s), so
-- 65 s leaves room for the response without pg_net giving up first.
-- ---------------------------------------------------------------------------
create or replace function private.call_monitor_checker()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base       text;
  v_secret     text;
  v_request_id bigint;
begin
  select decrypted_secret into v_base
  from vault.decrypted_secrets
  where name = 'monitor_base_url'
  limit 1;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'monitor_cron_secret'
  limit 1;

  if coalesce(v_base, '') = '' or coalesce(v_secret, '') = '' then
    return null;
  end if;

  -- Header name must match src/lib/auth.ts → hasValidCronSecret ('x-cron-secret').
  select net.http_post(
    url                  := rtrim(v_base, '/') || '/api/checks/run',
    headers              := jsonb_build_object(
                              'x-cron-secret', v_secret,
                              'content-type', 'application/json'
                            ),
    body                 := '{}'::jsonb,
    timeout_milliseconds := 65000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function private.call_monitor_checker() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Schedule: every 5 minutes. Unschedule first so re-running this file never
-- leaves two jobs.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'monitor-checker') then
    perform cron.unschedule('monitor-checker');
  end if;
end;
$$;

select cron.schedule(
  'monitor-checker',
  '*/5 * * * *',
  $$select private.call_monitor_checker()$$
);
